// Retired endpoint: never reintroduce temporary passwords.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
Deno.serve(() => new Response(JSON.stringify({error:'Ancienne création de compte désactivée.',endpoint_disabled:true}), {
  status:410,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
}));
