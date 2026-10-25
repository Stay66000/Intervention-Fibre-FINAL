import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const JOURNAL = '_JOURNAL_BACKUP';
const TEMPLATE_VERSION = 3;
const RETRY_SECONDS = [60, 300, 900, 3600];

function secretKey() {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (modern) { try { const parsed = JSON.parse(modern); if (parsed?.default) return parsed.default as string; } catch {} }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
function monthTitle(value?: string | null) {
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const d = value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value + 'T12:00:00Z') : new Date();
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function q(title: string) { return `'${title.replace(/'/g, "''")}'`; }
function compactText(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function numberValue(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }
function operatorLabel(value: unknown) {
  const key = String(value || '').toLowerCase();
  return ({ orange:'Orange', sfr:'SFR', bouygues:'Bouygues Telecom', free:'Free' } as Record<string,string>)[key] || compactText(value, 80);
}
function resultLabel(value: unknown) {
  const raw = String(value || '').toLowerCase();
  return raw.startsWith('réuss') || raw === 'success' ? 'Réussite' : 'Échec';
}
function workMode(snapshot: any) { return snapshot?.work_mode === 'Binôme' ? 'Binôme' : 'Solo'; }
function supplement(snapshot: any) {
  const data = snapshot?.operator_data && typeof snapshot.operator_data === 'object' ? snapshot.operator_data : {};
  const label = compactText(data.supplement_comment ?? data.supplement_label ?? data.supplement ?? '', 200);
  const rawAmount = numberValue(data.supplement_amount ?? 0);
  return { label, amount: workMode(snapshot) === 'Binôme' ? rawAmount / 2 : rawAmount };
}
function visibleAmount(snapshot: any) {
  if (resultLabel(snapshot?.result) !== 'Réussite') return 0;
  return numberValue(snapshot?.applied_amount) + supplement(snapshot).amount;
}
function dailyFormula() { return '=IF(INDEX(A:A,ROW())="","",SUMIFS(I:I,A:A,INDEX(A:A,ROW()),E:E,"Réussite"))'; }
function visibleMonthlyRow(snapshot: any) {
  return [compactText(snapshot?.intervention_date,20),compactText(snapshot?.reference,120),compactText(snapshot?.address,400),compactText(snapshot?.intervention_type_name,160),resultLabel(snapshot?.result),operatorLabel(snapshot?.operator),dailyFormula(),workMode(snapshot),visibleAmount(snapshot),compactText(snapshot?.notes,500)];
}
function technicalMonthlyRow(snapshot: any, state: string) {
  const supp = supplement(snapshot);
  return [supp.label,supp.amount,new Date().toISOString(),state,compactText(snapshot?.id,80)];
}
function journalRow(job: any, state: string) {
  const supp = supplement(job.snapshot);
  return [job.id,job.action,new Date().toISOString(),compactText(job.snapshot?.intervention_date,20),compactText(job.snapshot?.reference,120),compactText(job.snapshot?.address,400),compactText(job.snapshot?.intervention_type_name,160),resultLabel(job.snapshot?.result),operatorLabel(job.snapshot?.operator),workMode(job.snapshot),visibleAmount(job.snapshot),compactText(job.snapshot?.notes,500),supp.label,supp.amount,state,compactText(job.snapshot?.id,80)];
}
function styleKey(title: string) { return `__template_v${TEMPLATE_VERSION}__${title}`; }
function priorStyleKeys(known: Record<string, any>, title: string) { return Object.keys(known).filter(k => /^__template_v\d+__/.test(k) && k.endsWith(`__${title}`)); }
function rgb(hex: string) { const n=hex.replace('#',''); return {red:parseInt(n.slice(0,2),16)/255,green:parseInt(n.slice(2,4),16)/255,blue:parseInt(n.slice(4,6),16)/255}; }
function archiveTitle(known: Record<string, any>, title: string) {
  let base = `_ARCHIVE ${title}`.slice(0,95), candidate = base, n = 2;
  while (known[candidate] != null) candidate = `${base.slice(0,90)} ${n++}`;
  return candidate;
}

async function googleJson(url: string, accessToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {}); headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(url, { ...init, headers }); const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) { const msg=typeof body==='string'?body.slice(0,200):body?.error?.message||'request_failed'; const err=new Error(`GOOGLE_${res.status}:${msg}`) as Error & {status?:number}; err.status=res.status; throw err; }
  return body;
}
async function refreshAccessToken(refreshToken: string) {
  const clientId=Deno.env.get('GOOGLE_DRIVE_CLIENT_ID')||'', clientSecret=Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')||'';
  if(!clientId||!clientSecret)throw new Error('GOOGLE_OAUTH_CONFIG_MISSING');
  const res=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const body=await res.json().catch(()=>({})); if(!res.ok||!body?.access_token){const err=new Error(`TOKEN_REFRESH_${res.status}`) as Error&{authFailure?:boolean};err.authFailure=res.status===400||res.status===401;throw err} return String(body.access_token);
}
async function getValues(spreadsheetId:string,accessToken:string,range:string){const data=await googleJson(`${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,accessToken);return Array.isArray(data?.values)?data.values as any[][]:[]}
async function batchUpdateValues(spreadsheetId:string,accessToken:string,data:any[],valueInputOption='USER_ENTERED'){return googleJson(`${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`,accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({valueInputOption,data})})}
async function updateValues(spreadsheetId:string,accessToken:string,range:string,values:any[][],valueInputOption='RAW'){return googleJson(`${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${encodeURIComponent(valueInputOption)}`,accessToken,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values})})}

async function initializeMonthlyTemplate(connection:any,accessToken:string,title:string,sheetId:number){
  const spreadsheetId=connection.spreadsheet_id;
  const summary=[['Opérateur','Solo','Binôme','Total'],['Orange','=SUMIFS($I:$I,$F:$F,$K2,$H:$H,L$1,$E:$E,"Réussite")','=SUMIFS($I:$I,$F:$F,$K2,$H:$H,M$1,$E:$E,"Réussite")','=SUM(L2:M2)'],['SFR','=SUMIFS($I:$I,$F:$F,$K3,$H:$H,L$1,$E:$E,"Réussite")','=SUMIFS($I:$I,$F:$F,$K3,$H:$H,M$1,$E:$E,"Réussite")','=SUM(L3:M3)'],['Bouygues Telecom','=SUMIFS($I:$I,$F:$F,$K4,$H:$H,L$1,$E:$E,"Réussite")','=SUMIFS($I:$I,$F:$F,$K4,$H:$H,M$1,$E:$E,"Réussite")','=SUM(L4:M4)'],['Free','=SUMIFS($I:$I,$F:$F,$K5,$H:$H,L$1,$E:$E,"Réussite")','=SUMIFS($I:$I,$F:$F,$K5,$H:$H,M$1,$E:$E,"Réussite")','=SUM(L5:M5)'],['TOTAL GÉNÉRAL','=SUM(L2:L5)','=SUM(M2:M5)','=SUM(N2:N5)']];
  await batchUpdateValues(spreadsheetId,accessToken,[{range:`${q(title)}!A1:J1`,values:[['Date','N° intervention','Adresse client','Typologie raccordement','Réussite / Échec','Opérateur','Total journalier (€)','Mode','Montant (€)','Commentaire']]},{range:`${q(title)}!K1:N6`,values:summary},{range:`${q(title)}!O1:T1`,values:[['Complément','Montant complément','Dernière synchro','État','ID FIBRE OPS',`FIBRE_OPS_TEMPLATE_V${TEMPLATE_VERSION}`]]}]);
  const header=rgb('#386A9C'),white=rgb('#FFFFFF'),dark=rgb('#1F2937'),opColors=[rgb('#FF8A1F'),rgb('#38BDF8'),rgb('#22C55E'),rgb('#EF4444')],widths=[90,135,250,205,135,145,145,95,115,260,165,110,110,115];
  const requests:any[]=[{updateSheetProperties:{properties:{sheetId,gridProperties:{frozenRowCount:1}},fields:'gridProperties.frozenRowCount'}},{clearBasicFilter:{sheetId}},{repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:10},cell:{userEnteredFormat:{backgroundColor:header,textFormat:{foregroundColor:white,bold:true},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'}},{repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:10,endColumnIndex:14},cell:{userEnteredFormat:{backgroundColor:header,textFormat:{foregroundColor:white,bold:true},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'}},{repeatCell:{range:{sheetId,startRowIndex:5,endRowIndex:6,startColumnIndex:10,endColumnIndex:14},cell:{userEnteredFormat:{backgroundColor:dark,textFormat:{foregroundColor:white,bold:true}}},fields:'userEnteredFormat(backgroundColor,textFormat)'}},{repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:2000,startColumnIndex:6,endColumnIndex:7},cell:{userEnteredFormat:{numberFormat:{type:'CURRENCY',pattern:'#,##0.00 "€"'}}},fields:'userEnteredFormat.numberFormat'}},{repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:2000,startColumnIndex:8,endColumnIndex:9},cell:{userEnteredFormat:{numberFormat:{type:'CURRENCY',pattern:'#,##0.00 "€"'}}},fields:'userEnteredFormat.numberFormat'}},{repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:6,startColumnIndex:11,endColumnIndex:14},cell:{userEnteredFormat:{numberFormat:{type:'CURRENCY',pattern:'#,##0.00 "€"'}}},fields:'userEnteredFormat.numberFormat'}},{repeatCell:{range:{sheetId,startRowIndex:1,endRowIndex:2000,startColumnIndex:15,endColumnIndex:16},cell:{userEnteredFormat:{numberFormat:{type:'CURRENCY',pattern:'#,##0.00 "€"'}}},fields:'userEnteredFormat.numberFormat'}},{setBasicFilter:{filter:{range:{sheetId,startRowIndex:0,endRowIndex:2000,startColumnIndex:0,endColumnIndex:10}}}},{updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:14,endIndex:20},properties:{hiddenByUser:true},fields:'hiddenByUser'}}];
  for(let i=0;i<widths.length;i++)requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:widths[i]},fields:'pixelSize'}});
  for(let i=0;i<4;i++)requests.push({repeatCell:{range:{sheetId,startRowIndex:i+1,endRowIndex:i+2,startColumnIndex:10,endColumnIndex:11},cell:{userEnteredFormat:{backgroundColor:opColors[i],textFormat:{foregroundColor:white,bold:true},horizontalAlignment:'CENTER'}},fields:'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'}});
  for(const [name,color] of [['Orange','#FF8A1F'],['SFR','#38BDF8'],['Bouygues Telecom','#22C55E'],['Free','#EF4444']])requests.push({addConditionalFormatRule:{index:0,rule:{ranges:[{sheetId,startRowIndex:1,endRowIndex:2000,startColumnIndex:5,endColumnIndex:6}],booleanRule:{condition:{type:'TEXT_EQ',values:[{userEnteredValue:name}]},format:{backgroundColor:rgb(color),textFormat:{foregroundColor:white,bold:true}}}}}});
  await googleJson(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`,accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})});
}
async function ensureJournalHeader(connection:any,accessToken:string){await updateValues(connection.spreadsheet_id,accessToken,`${q(JOURNAL)}!A1:P1`,[['Event ID','Action','Horodatage','Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','État','ID FIBRE OPS']])}
async function replaceLegacyMonthlySheet(connection:any,accessToken:string,title:string,known:Record<string,any>){
  const oldSheetId=Number(known[title]); const archived=archiveTitle(known,title);
  const result=await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}:batchUpdate`,accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{updateSheetProperties:{properties:{sheetId:oldSheetId,title:archived,hidden:true},fields:'title,hidden'}},{addSheet:{properties:{title,gridProperties:{frozenRowCount:1}}}}]})});
  const newSheetId=Number(result?.replies?.[1]?.addSheet?.properties?.sheetId); if(!newSheetId)throw new Error('SHEETS_TEMPLATE_UPGRADE_FAILED');
  known[archived]=oldSheetId; known[title]=newSheetId; for(const key of priorStyleKeys(known,title))delete known[key]; return newSheetId;
}
async function ensureSheet(admin:any,connection:any,accessToken:string,title:string,hidden=false){
  const known=connection.known_sheets&&typeof connection.known_sheets==='object'?{...connection.known_sheets}:{};let changed=false,createdNow=false;
  if(known[title]==null){const result=await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}:batchUpdate`,accessToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{addSheet:{properties:{title,hidden,gridProperties:{frozenRowCount:1}}}}]})});const props=result?.replies?.[0]?.addSheet?.properties;if(props?.sheetId!=null){known[title]=props.sheetId;changed=true;createdNow=true}}
  if(title===JOURNAL){if(!known[styleKey(title)]){await ensureJournalHeader(connection,accessToken);known[styleKey(title)]=TEMPLATE_VERSION;changed=true}}
  else if(!known[styleKey(title)]){if(!createdNow){known[title]=await replaceLegacyMonthlySheet(connection,accessToken,title,known);changed=true}await initializeMonthlyTemplate(connection,accessToken,title,Number(known[title]));known[styleKey(title)]=TEMPLATE_VERSION;changed=true}
  if(changed){await admin.from('google_backup_connections').update({known_sheets:known,updated_at:new Date().toISOString()}).eq('user_id',connection.user_id);connection.known_sheets=known} return known;
}

type MonthlyIndex={rows:Map<string,number>,nextRow:number}; type JournalIndex={ids:Set<string>,nextRow:number};
const monthlyCaches=new Map<string,MonthlyIndex>(); const journalCaches=new Map<string,JournalIndex>();
async function monthlyIndex(connection:any,accessToken:string,month:string){const key=`${connection.spreadsheet_id}:${month}`;let cached=monthlyCaches.get(key);if(cached)return cached;const values=await getValues(connection.spreadsheet_id,accessToken,`${q(month)}!S2:S`),rows=new Map<string,number>();values.forEach((row,i)=>{const id=String(row?.[0]||'');if(id)rows.set(id,i+2)});cached={rows,nextRow:Math.max(2,values.length+2)};monthlyCaches.set(key,cached);return cached}
async function journalIndex(connection:any,accessToken:string){const key=connection.spreadsheet_id;let cached=journalCaches.get(key);if(cached)return cached;const values=await getValues(connection.spreadsheet_id,accessToken,`${q(JOURNAL)}!A2:A`),ids=new Set<string>();values.forEach(row=>{const id=String(row?.[0]||'');if(id)ids.add(id)});cached={ids,nextRow:Math.max(2,values.length+2)};journalCaches.set(key,cached);return cached}
async function writeJob(connection:any,accessToken:string,job:any,month:string,state:string,interventionId:string){
  const mi=await monthlyIndex(connection,accessToken,month),ji=await journalIndex(connection,accessToken);let rowNumber=mi.rows.get(interventionId);if(!rowNumber){rowNumber=mi.nextRow++;mi.rows.set(interventionId,rowNumber)}
  const data:any[]=[{range:`${q(month)}!A${rowNumber}:J${rowNumber}`,values:[visibleMonthlyRow(job.snapshot)]},{range:`${q(month)}!O${rowNumber}:S${rowNumber}`,values:[technicalMonthlyRow(job.snapshot,state)]}];
  const jobId=String(job.id);if(!ji.ids.has(jobId)){const jr=ji.nextRow++;ji.ids.add(jobId);data.push({range:`${q(JOURNAL)}!A${jr}:P${jr}`,values:[journalRow(job,state)]})}
  await batchUpdateValues(connection.spreadsheet_id,accessToken,data,'USER_ENTERED');
}
async function markDone(admin:any,job:any){const now=new Date().toISOString();await Promise.all([admin.from('google_backup_jobs').update({status:'done',locked_at:null,completed_at:now,last_error:null,updated_at:now}).eq('id',job.id),admin.from('google_backup_connections').update({status:'connected',last_success_at:now,last_error:null,last_error_at:null,updated_at:now}).eq('user_id',job.user_id)])}
async function markFailed(admin:any,job:any,error:unknown,authFailure=false){const now=new Date(),message=compactText(error instanceof Error?error.message:error,400)||'Sauvegarde Google impossible',attempts=Number(job.attempts||1),dead=authFailure||attempts>=5,delay=RETRY_SECONDS[Math.min(Math.max(attempts-1,0),RETRY_SECONDS.length-1)]||3600;await admin.from('google_backup_jobs').update({status:dead?'dead':'pending',locked_at:null,next_attempt_at:new Date(now.getTime()+delay*1000).toISOString(),last_error:message,updated_at:now.toISOString()}).eq('id',job.id);await admin.from('google_backup_connections').update({status:authFailure?'error':'connected',last_error:message,last_error_at:now.toISOString(),updated_at:now.toISOString()}).eq('user_id',job.user_id)}

Deno.serve(async(req:Request)=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});if(req.method!=='POST')return json({error:'Méthode non autorisée'},405);
  monthlyCaches.clear();journalCaches.clear();
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'',adminKey=secretKey();if(!supabaseUrl||!adminKey)return json({error:'Configuration serveur manquante'},500);const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:workerConfig,error:workerConfigError}=await admin.from('google_backup_worker_config').select('worker_secret').eq('singleton',true).maybeSingle();if(workerConfigError||!workerConfig?.worker_secret)return json({error:'Worker non configuré'},503);if((req.headers.get('x-fibre-worker')||'')!==workerConfig.worker_secret)return json({error:'Accès refusé'},403);
  const{data:jobs,error:claimError}=await admin.rpc('claim_google_backup_jobs',{p_limit:4});if(claimError)return json({error:'File de sauvegarde indisponible'},500);if(!jobs?.length)return json({ok:true,processed:0});
  const tokenCache=new Map<string,string>();let success=0,failed=0;
  for(const job of jobs){try{const[{data:connection},{data:token}]=await Promise.all([admin.from('google_backup_connections').select('user_id,spreadsheet_id,known_sheets,status').eq('user_id',job.user_id).maybeSingle(),admin.from('google_backup_tokens').select('refresh_token').eq('user_id',job.user_id).maybeSingle()]);if(!connection||connection.status!=='connected'||!connection.spreadsheet_id||!token?.refresh_token)throw new Error('GOOGLE_CONNECTION_MISSING');let accessToken=tokenCache.get(job.user_id);if(!accessToken){try{accessToken=await refreshAccessToken(token.refresh_token)}catch(error){await markFailed(admin,job,error,true);failed++;continue}tokenCache.set(job.user_id,accessToken)}const month=monthTitle(job.snapshot?.intervention_date);await ensureSheet(admin,connection,accessToken,JOURNAL,true);await ensureSheet(admin,connection,accessToken,month,false);const interventionId=compactText(job.intervention_id||job.snapshot?.id,80),state=job.action==='delete'?'Supprimée dans FIBRE OPS':'Active';await writeJob(connection,accessToken,job,month,state,interventionId);await markDone(admin,job);success++}catch(error){const status=(error as any)?.status,authFailure=status===401||String((error as any)?.message||'').startsWith('TOKEN_REFRESH_');await markFailed(admin,job,error,authFailure);failed++}}
  return json({ok:true,processed:jobs.length,success,failed});
});
