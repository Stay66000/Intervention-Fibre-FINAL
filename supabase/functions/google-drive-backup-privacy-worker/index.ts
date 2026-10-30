import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {secretKey} from '../_shared/google-backup-google.ts';
import {check} from '../_shared/google-backup-sync.ts';
// Compatibility endpoint: all Google writes now go through the same workbook lease.
Deno.serve(async(req:Request)=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(req.method!=='POST')return json({error:'Méthode non autorisée'},405);
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',secretKey(),{auth:{persistSession:false}});
  const config=check(await admin.from('google_backup_worker_config').select('worker_secret').eq('singleton',true).single());
  if(req.headers.get('x-fibre-worker')!==config.worker_secret)return json({error:'Accès refusé'},403);
  const users=check(await admin.rpc('google_backup_privacy_targets'))||[];
  if(users.length)check(await admin.from('google_backup_connections').update({reconcile_requested:true,reconcile_attempts:0,reconcile_next_attempt_at:new Date().toISOString()}).in('user_id',users.map((u:any)=>u.user_id)));
  check(await admin.rpc('google_backup_wake'));
  return json({ok:true,queued:users.length});
});
