import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROD_ORIGIN = "https://intervention-fibre-final.pages.dev";

function allowedOrigin(req: Request) {
  const origin = req.headers.get("Origin") || "";
  if (!origin) return "";
  try {
    const u = new URL(origin);
    const okProd = origin === PROD_ORIGIN;
    const okPreview = u.protocol === "https:" && u.hostname.endsWith(".intervention-fibre-final.pages.dev");
    const okLocal = ["localhost", "127.0.0.1"].includes(u.hostname) && ["http:", "https:"].includes(u.protocol);
    return okProd || okPreview || okLocal ? origin : "";
  } catch {
    return "";
  }
}

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || PROD_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, origin = PROD_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = allowedOrigin(req);
  if (!origin) return json({ error: "Origine non autorisée" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Non authentifié" }, 401, origin);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Session invalide" }, 401, origin);

    const callerId = userData.user.id;
    const { data: membership, error: memberErr } = await admin
      .from("company_members")
      .select("company_id,role,status,companies!inner(status,name)")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .eq("status", "active")
      .maybeSingle();

    if (memberErr || !membership) return json({ error: "Réservé à l’Admin Société" }, 403, origin);
    const company = Array.isArray((membership as any).companies)
      ? (membership as any).companies[0]
      : (membership as any).companies;
    if (!company || company.status !== "active") return json({ error: "Société suspendue" }, 403, origin);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const firstName = String(body.first_name || "").trim();
    const lastName = String(body.last_name || "").trim();
    const employmentType = String(body.employment_type || "auto").trim().toLowerCase();
    const hidePrices = employmentType === "salaried" ? Boolean(body.hide_prices) : false;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "E-mail invalide" }, 400, origin);
    if (!firstName || firstName.length > 80) return json({ error: "Prénom invalide" }, 400, origin);
    if (lastName.length > 80) return json({ error: "Nom invalide" }, 400, origin);
    if (!["auto", "salaried"].includes(employmentType)) return json({ error: "Statut technicien invalide" }, 400, origin);

    const { data: existingProfile, error: existingErr } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existingProfile) {
      return json({ error: "Ce compte existe déjà. Utilise l’invitation d’un compte existant." }, 409, origin);
    }

    const redirectTo = `${PROD_ORIGIN}/?invite=1`;
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { first_name: firstName, last_name: lastName, invited_by_company: true },
      redirectTo,
    });
    if (inviteErr || !invited.user) return json({ error: inviteErr?.message || "Invitation impossible" }, 400, origin);

    const newId = invited.user.id;
    try {
      const { error: profileErr } = await admin.from("profiles").upsert({
        id: newId,
        email,
        first_name: firstName,
        last_name: lastName,
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
        email,
        company_name: company.name,
        invitation_sent: true,
        employment_type: employmentType,
        hide_prices: hidePrices,
      }, 200, origin);
    } catch (dbErr) {
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      throw dbErr;
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, origin);
  }
});
