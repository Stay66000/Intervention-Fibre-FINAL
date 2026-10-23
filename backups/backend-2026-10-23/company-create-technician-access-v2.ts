import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function makePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const specials = "!@#$%*-_";
  const all = upper + lower + digits + specials;
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let out = upper[bytes[0] % upper.length] + lower[bytes[1] % lower.length] + digits[bytes[2] % digits.length] + specials[bytes[3] % specials.length];
  for (let i = 4; i < bytes.length; i++) out += all[bytes[i] % all.length];
  return out.split("").sort(() => Math.random() - 0.5).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Non authentifié" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Session invalide" }, 401);

    const callerId = userData.user.id;
    const { data: membership, error: memberErr } = await admin
      .from("company_members")
      .select("company_id,role,status,companies!inner(status,name)")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .eq("status", "active")
      .maybeSingle();

    if (memberErr || !membership) return json({ error: "Réservé au patron de la société" }, 403);
    const company = Array.isArray((membership as any).companies) ? (membership as any).companies[0] : (membership as any).companies;
    if (!company || company.status !== "active") return json({ error: "Société suspendue" }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const employmentType = String(body.employment_type || "auto").trim().toLowerCase();
    const hidePrices = employmentType === "salaried" ? Boolean(body.hide_prices) : false;

    if (!email || !email.includes("@")) return json({ error: "E-mail invalide" }, 400);
    if (!firstName) return json({ error: "Prénom requis" }, 400);
    if (!["auto", "salaried"].includes(employmentType)) return json({ error: "Statut technicien invalide" }, 400);

    const { data: existingProfile } = await admin.from("profiles").select("id,email").eq("email", email).maybeSingle();
    if (existingProfile) {
      return json({ error: "Ce compte existe déjà. Utilise l’invitation par code pour qu’il accepte ou refuse la société." }, 409);
    }

    const tempPassword = makePassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });

    if (createErr || !created.user) return json({ error: createErr?.message || "Création du compte impossible" }, 400);

    const newId = created.user.id;
    try {
      const { error: profileErr } = await admin.from("profiles").upsert({
        id: newId,
        email,
        first_name: firstName,
        last_name: lastName || null,
        role: "technician",
        active: true,
        onboarding_completed: true,
        company_id: membership.company_id,
      }, { onConflict: "id" });
      if (profileErr) throw profileErr;

      const { error: cmErr } = await admin.from("company_members").upsert({
        company_id: membership.company_id,
        user_id: newId,
        role: "technician",
        status: "active",
        employment_type: employmentType,
        hide_prices: hidePrices,
      }, { onConflict: "company_id,user_id" });
      if (cmErr) throw cmErr;

      await admin.from("company_invites")
        .update({ status: "cancelled" })
        .eq("company_id", membership.company_id)
        .eq("email", email)
        .eq("status", "pending");

      return json({
        ok: true,
        company_name: company.name,
        email,
        temporary_password: tempPassword,
        user_id: newId,
        employment_type: employmentType,
        hide_prices: hidePrices,
      });
    } catch (dbErr) {
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      throw dbErr;
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
