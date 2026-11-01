import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import {secretKey} from '../_shared/google-backup-google.ts';
import {syncUser,check} from '../_shared/google-backup-sync.ts';

Deno.serve(async(req:Request)=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='POST')return json({error:'Méthode non autorisée'},405);
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',secretKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  const config=check(await admin.from('google_backup_worker_config').select('worker_secret').eq('singleton',true).single());
  if(!config.worker_secret||req.headers.get('x-fibre-worker')!==config.worker_secret)return json({error:'Accès refusé'},403);
  const users=check(await admin.rpc('google_backup_due_users'))||[],results=[];
  const started=Date.now();
  for(const u of users){
    if(Date.now()-started>60000)break;
    results.push(await syncUser(admin,u.user_id,u.reconcile));
  }
  return json({ok:true,results});
});
