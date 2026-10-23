import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"Méthode non autorisée"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publicUrl=(Deno.env.get("FIBRE_OPS_PUBLIC_URL")||"").replace(/\/$/,"");
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!token)return json({error:"Non authentifié"},401);
    if(!publicUrl)return json({error:"URL publique FIBRE OPS non configurée"},500);

    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userErr}=await admin.auth.getUser(token);
    if(userErr||!userData.user)return json({error:"Session invalide"},401);

    const callerId=userData.user.id;
    const {data:membership,error:memberErr}=await admin.from("company_members")
      .select("company_id,role,status,companies!inner(status,name)")
      .eq("user_id",callerId).eq("role","admin").eq("status","active").maybeSingle();
    if(memberErr||!membership)return json({error:"Réservé à l’Admin Société"},403);
    const company=Array.isArray((membership as any).companies)?(membership as any).companies[0]:(membership as any).companies;
    if(!company||company.status!=="active")return json({error:"Société suspendue"},403);

    const body=await req.json().catch(()=>({}));
    const email=String(body.email||"").trim().toLowerCase();
    const firstName=String(body.first_name||"").trim();
    const lastName=String(body.last_name||"").trim();
    const employmentType=String(body.employment_type||"auto").trim().toLowerCase();
    const hidePrices=employmentType==="salaried"?Boolean(body.hide_prices):false;
    if(!email||!email.includes("@"))return json({error:"E-mail invalide"},400);
    if(!firstName)return json({error:"Prénom requis"},400);
    if(!["auto","salaried"].includes(employmentType))return json({error:"Statut technicien invalide"},400);

    const {data:existingProfile}=await admin.from("profiles").select("id,email").eq("email",email).maybeSingle();
    if(existingProfile)return json({error:"Ce compte existe déjà. Utilise l’invitation d’un compte existant."},409);

    const {data:invited,error:inviteErr}=await admin.auth.admin.inviteUserByEmail(email,{
      data:{first_name:firstName,last_name:lastName,invited_by_company:true},
      redirectTo:`${publicUrl}/?invite=1`,
    });
    if(inviteErr||!invited.user)return json({error:inviteErr?.message||"Invitation impossible"},400);

    const newId=invited.user.id;
    try{
      const {error:profileErr}=await admin.from("profiles").upsert({
        id:newId,email,first_name:firstName,last_name:lastName||null,role:"technician",active:true,
        onboarding_completed:true,company_id:membership.company_id,
      },{onConflict:"id"});
      if(profileErr)throw profileErr;
      const {error:cmErr}=await admin.from("company_members").upsert({
        company_id:membership.company_id,user_id:newId,role:"technician",status:"active",
        employment_type:employmentType,hide_prices:hidePrices,
      },{onConflict:"company_id,user_id"});
      if(cmErr)throw cmErr;
      return json({ok:true,email,company_name:company.name,user_id:newId,invitation_sent:true});
    }catch(dbErr){
      await admin.auth.admin.deleteUser(newId).catch(()=>{});
      throw dbErr;
    }
  }catch(err){return json({error:err instanceof Error?err.message:String(err)},500)}
});
