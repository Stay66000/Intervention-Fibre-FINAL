import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

const TOKEN_URL='https://oauth2.googleapis.com/token';
const SHEETS_BASE='https://sheets.googleapis.com/v4/spreadsheets';
const GUARD='_MIGRATION_FIBRE_OPS';

function secretKey(){
  const modern=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(modern){try{const parsed=JSON.parse(modern);if(parsed?.default)return parsed.default as string}catch{}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
async function refreshToken(refreshToken:string){
  const clientId=Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')||'';
  const clientSecret=Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')||'';
  const res=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data?.access_token)throw new Error('TOKEN_REFRESH_FAILED');
  return String(data.access_token);
}
async function google(url:string,token:string,init:RequestInit={}){
  const headers=new Headers(init.headers||{});headers.set('Authorization',`Bearer ${token}`);headers.set('Content-Type','application/json');
  const res=await fetch(url,{...init,headers});const text=await res.text();let data:any=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok)throw new Error(`GOOGLE_${res.status}:${typeof data==='string'?data.slice(0,180):data?.error?.message||'request_failed'}`);
  return data;
}
Deno.serve(async(req:Request)=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='POST')return json({error:'Méthode non autorisée'},405);
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'',adminKey=secretKey();
  if(!supabaseUrl||!adminKey)return json({error:'Configuration serveur manquante'},500);
  const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:cfg}=await admin.from('google_backup_worker_config').select('worker_secret').eq('singleton',true).maybeSingle();
  if(!cfg?.worker_secret||(req.headers.get('x-fibre-worker')||'')!==cfg.worker_secret)return json({error:'Accès refusé'},403);
  const body=await req.json().catch(()=>({}));const action=body?.action==='cleanup'?'cleanup':'prepare';
  const {data:connections,error}=await admin.from('google_backup_connections').select('user_id,spreadsheet_id,status').eq('status','connected');
  if(error)return json({error:'Connexions indisponibles'},500);
  let changed=0;
  for(const c of connections||[]){
    const {data:t}=await admin.from('google_backup_tokens').select('refresh_token').eq('user_id',c.user_id).maybeSingle();
    if(!t?.refresh_token||!c.spreadsheet_id)continue;
    try{
      const token=await refreshToken(t.refresh_token);
      const meta=await google(`${SHEETS_BASE}/${c.spreadsheet_id}?fields=sheets.properties(sheetId,title,hidden)`,token);
      const guard=(meta.sheets||[]).find((s:any)=>s.properties?.title===GUARD);
      if(action==='prepare'&&!guard){
        await google(`${SHEETS_BASE}/${c.spreadsheet_id}:batchUpdate`,token,{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:GUARD,hidden:false}}}]})});changed++;
      }else if(action==='cleanup'&&guard){
        const visible=(meta.sheets||[]).filter((s:any)=>!s.properties?.hidden);
        if(visible.length>1){await google(`${SHEETS_BASE}/${c.spreadsheet_id}:batchUpdate`,token,{method:'POST',body:JSON.stringify({requests:[{deleteSheet:{sheetId:guard.properties.sheetId}}]})});changed++;}
      }
    }catch(e){console.error('GOOGLE_MAINTENANCE',e)}
  }
  return json({ok:true,action,connections:(connections||[]).length,changed});
});