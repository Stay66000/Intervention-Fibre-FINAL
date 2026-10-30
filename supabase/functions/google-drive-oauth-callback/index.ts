import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {secretKey,googleJson,SHEETS_BASE} from '../_shared/google-backup-google.ts';
import {monthTitle,JOURNAL} from '../_shared/google-backup-model.mjs';
import {check} from '../_shared/google-backup-sync.ts';
const PROD_ORIGIN='https://intervention-fibre-final.pages.dev';
function allowedOrigin(origin:string){try{const u=new URL(origin);return origin===PROD_ORIGIN||(u.protocol==='https:'&&!u.port&&u.hostname.endsWith('.intervention-fibre-final.pages.dev'))}catch{return false}}
function redirect(origin:string,status:string,detail=''){const u=new URL((allowedOrigin(origin)?origin:PROD_ORIGIN)+'/');u.searchParams.set('google_backup',status);if(detail)u.searchParams.set('google_backup_reason',detail.slice(0,120));return Response.redirect(u.toString(),302)}
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
Deno.serve(async(req:Request)=>{
  if(req.method!=='GET')return new Response('Méthode non autorisée',{status:405});
  const url=new URL(req.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',secretKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  let origin=PROD_ORIGIN;
  try{
    if(!state)throw new Error('missing_state');
    // DELETE RETURNING consumes the OAuth state atomically, including callbacks in parallel.
    const states=check(await admin.from('google_backup_oauth_states').delete().eq('state_hash',await sha256(state)).select('user_id,expires_at,return_origin'));
    const saved=states?.[0];
    if(!saved||new Date(saved.expires_at).getTime()<Date.now())throw new Error('state_expired');
    origin=saved.return_origin;
    if(url.searchParams.has('error'))throw new Error(url.searchParams.get('error')||'oauth_denied');
    if(!code)throw new Error('missing_code');
    const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')||'',redirect_uri:Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI')||'',code,grant_type:'authorization_code'})});
    const auth=await tokenRes.json();
    if(!tokenRes.ok||!auth.access_token)throw new Error('token_exchange_failed');
    const info=await googleJson('https://openidconnect.googleapis.com/v1/userinfo',auth.access_token);
    const existing=check(await admin.from('google_backup_connections').select('spreadsheet_id,spreadsheet_url,google_email').eq('user_id',saved.user_id).maybeSingle());
    const oldToken=check(await admin.from('google_backup_tokens').select('refresh_token').eq('user_id',saved.user_id).maybeSingle());
    // Never reuse a refresh token belonging to a different Google identity.
    const refresh=auth.refresh_token||(existing?.google_email===info.email?oldToken?.refresh_token:'');
    if(!refresh)throw new Error('refresh_token_missing');
    let spreadsheetId=existing?.spreadsheet_id,spreadsheetUrl=existing?.spreadsheet_url,known:any={};
    if(spreadsheetId){
      // A timeout/403/5xx must not silently create a second backup workbook.
      const meta=await googleJson(`${SHEETS_BASE}/${spreadsheetId}?fields=spreadsheetUrl,sheets.properties(sheetId,title)`,auth.access_token);
      spreadsheetUrl=meta.spreadsheetUrl;
      for(const s of meta.sheets||[])known[s.properties.title]=s.properties.sheetId;
    }else{
      const month=monthTitle(new Date().toISOString().slice(0,10));
      const created=await googleJson(SHEETS_BASE,auth.access_token,{method:'POST',body:JSON.stringify({properties:{title:'FIBRE OPS — Sauvegarde interventions'},sheets:[{properties:{title:month,gridProperties:{rowCount:2000,columnCount:26}}},{properties:{title:JOURNAL,hidden:true,gridProperties:{rowCount:2000,columnCount:26}}}]})});
      spreadsheetId=created.spreadsheetId;spreadsheetUrl=created.spreadsheetUrl;
      for(const s of created.sheets||[])known[s.properties.title]=s.properties.sheetId;
    }
    const now=new Date().toISOString();
    check(await admin.from('google_backup_tokens').upsert({user_id:saved.user_id,refresh_token:refresh,granted_scopes:String(auth.scope||'').split(/\s+/).filter(Boolean),updated_at:now}));
    check(await admin.from('google_backup_connections').upsert({user_id:saved.user_id,google_email:info.email,spreadsheet_id:spreadsheetId,spreadsheet_url:spreadsheetUrl,status:'connected',known_sheets:known,connected_at:now,updated_at:now,last_error:null,last_error_at:null,disconnected_at:null,reconcile_requested:true,reconcile_attempts:0,reconcile_next_attempt_at:now}));
    check(await admin.from('google_backup_jobs').update({status:'pending',attempts:0,next_attempt_at:now,locked_at:null,last_error:null,updated_at:now}).eq('user_id',saved.user_id).in('status',['dead','cancelled']));
    // One full authoritative reconcile replaces per-row backfill jobs and also applies missed deletions.
    check(await admin.rpc('google_backup_wake'));
    return redirect(origin,'connected');
  }catch(error){console.error('GOOGLE_BACKUP_CALLBACK',String((error as any)?.message||error));return redirect(origin,'error',String((error as any)?.message||'callback_failed'))}
});
