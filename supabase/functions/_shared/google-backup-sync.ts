import {JOURNAL,LEGACY,MONTH,monthTitle,planMirror,gridRequests,hidden,formulaSeparator,redactLegacyRow} from './google-backup-model.mjs';
import {SHEETS_BASE,q,googleJson,refreshAccessToken} from './google-backup-google.ts';
import {initializeMonthlyTemplate} from './google-backup-template.ts';

export function check(result:any){if(result.error)throw result.error;return result.data}
const rpc=async(admin:any,name:string,args:any={})=>check(await admin.rpc(name,args));
const RETRIES=[60,300,900,3600];

// No process-global indexes. A workbook lease covers fresh reads, planning and the Google commit.
export async function syncUser(admin:any,userId:string,reconcile=false){
  const lease=crypto.randomUUID(),started=Date.now();
  const acquired=await rpc(admin,'acquire_google_backup_lease',{p_user_id:userId,p_token:lease});
  if(!acquired)return {ok:true,busy:true};
  let jobs:any[]=[],connection:any,uncertainWrite=false;
  function budget(){if(Date.now()-started>65000)throw new Error('BACKUP_TIME_BUDGET')}
  try{
    connection=check(await admin.from('google_backup_connections').select('user_id,spreadsheet_id,known_sheets,status,reconcile_requested,reconcile_attempts,reconcile_next_attempt_at').eq('user_id',userId).single());
    if(connection.status!=='connected')return {ok:true,disconnected:true};
    reconcile=reconcile||(connection.reconcile_requested&&new Date(connection.reconcile_next_attempt_at).getTime()<=Date.now()&&connection.reconcile_attempts<5);
    if(reconcile)check(await admin.from('google_backup_connections').update({reconcile_requested:false,reconcile_attempts:Math.min(5,Number(connection.reconcile_attempts||0)+1)}).eq('user_id',userId));
    jobs=await rpc(admin,'claim_google_backup_jobs_v2',{p_user_id:userId,p_token:lease,p_limit:100});
    if(!reconcile&&!jobs.length)return {ok:true,processed:0};
    const tokenRow=check(await admin.from('google_backup_tokens').select('refresh_token').eq('user_id',userId).single());
    const token=await refreshAccessToken(tokenRow.refresh_token);
    // One DB snapshot, including recipient-specific payouts and current privacy rules.
    const state=await rpc(admin,'google_backup_source',{p_user_id:userId});
    const isHidden=!!state.hide_prices,snapshots=(state.rows||[]).map((s:any)=>isHidden?{...s,backup_price_hidden:true}:s);
    budget();
    const meta=await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}?fields=properties.locale,sheets.properties(sheetId,title,hidden,gridProperties)`,token);
    const separator=formulaSeparator(meta.properties?.locale);
    const sheets:any[]=(meta.sheets||[]).map((s:any)=>({...s.properties,values:[]}));
    const required=new Set<string>([JOURNAL,LEGACY,...snapshots.filter((s:any)=>reconcile||jobs.some(j=>j.intervention_id===s.id)).map((s:any)=>monthTitle(s.intervention_date))]);
    const requests:any[]=[];
    let nextId=Math.max(0,...sheets.map(s=>s.sheetId))+1;
    for(const title of required)if(!sheets.some(s=>s.title===title)){
      const sheet={sheetId:nextId++,title,gridProperties:{rowCount:2000,columnCount:26},values:[]};sheets.push(sheet);
      requests.push({addSheet:{properties:{sheetId:sheet.sheetId,title,hidden:title.startsWith('_'),gridProperties:{rowCount:2000,columnCount:26,frozenRowCount:1}}}});
    }
    // Existing v3 sheets may have only the default 1000 rows despite formatting to 2000.
    for(const s of sheets.filter(s=>MONTH.test(s.title)||[JOURNAL,LEGACY].includes(s.title))){
      if(s.gridProperties.rowCount<2000)requests.push({updateSheetProperties:{properties:{sheetId:s.sheetId,gridProperties:{rowCount:2000}},fields:'gridProperties.rowCount'}});
    }
    if(requests.length){budget();await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}:batchUpdate`,token,{method:'POST',body:JSON.stringify({requests})})}
    // Read all monthly rows + journal keys in a single batch (FORMULA keeps canonical formulas).
    const selected=sheets.filter(s=>MONTH.test(s.title)||[JOURNAL,LEGACY].includes(s.title));
    const params=new URLSearchParams({valueRenderOption:'FORMULA',dateTimeRenderOption:'FORMATTED_STRING'});
    for(const s of selected)params.append('ranges',`${q(s.title)}!${MONTH.test(s.title)?'A1:T':s.title===LEGACY?(isHidden?'A1:E':'A1:A'):'A1:A'}`);
    budget();
    const batch=await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}/values:batchGet?${params}`,token);
    selected.forEach((s,i)=>s.values=batch.valueRanges?.[i]?.values||[]);
    const known:any={};for(const s of sheets)known[s.title]=s.sheetId;
    for(const s of selected.filter(s=>MONTH.test(s.title))){
      // Initialize in place. Never rename/archive an existing month simply because a cache marker vanished.
      if(s.values[0]?.[19]!=='FIBRE_OPS_TEMPLATE_V4'){
        budget();await initializeMonthlyTemplate(connection,token,s.title,s.sheetId,separator);
        known[`__template_v4__${s.title}`]=4;
      }else known[`__template_v4__${s.title}`]=4;
    }
    // The latest Supabase state always wins over a delayed/replayed event snapshot.
    const safeJobs=jobs.map(j=>({...j,snapshot:{...j.snapshot,backup_price_hidden:isHidden||hidden(j.snapshot)}}));
    const plan=planMirror({sheets:selected,snapshots,jobs:safeJobs,reconcile,separator,hidePrices:isHidden});
    const mutations:any[]=gridRequests(plan.writes);
    const journal=sheets.find(s=>s.title===JOURNAL),legacy=sheets.find(s=>s.title===LEGACY);
    if(!journal.values?.[0]?.length)mutations.push(...gridRequests([{sheetId:journal.sheetId,row:1,col:0,values:['Event ID','Action','Horodatage','Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','État','ID FIBRE OPS']} ]));
    if(!legacy.values?.[0]?.length)mutations.push(...gridRequests([{sheetId:legacy.sheetId,row:1,col:0,values:['Archive ID','Onglet source','Ligne source','Horodatage','Valeurs source (JSON)']} ]));
    // Extend the grid once before a large backfill; no per-row append calls.
    for(const s of selected){const last=Math.max(0,...plan.writes.filter((w:any)=>w.sheetId===s.sheetId).map((w:any)=>w.row));if(last>Math.max(2000,s.gridProperties.rowCount))mutations.unshift({updateSheetProperties:{properties:{sheetId:s.sheetId,gridProperties:{rowCount:last+100}},fields:'gridProperties.rowCount'}})}
    if(isHidden){
      // Retain existing price privacy, including historical journal/archive data, without a polling worker.
      for(const s of sheets){
        if(s.title===LEGACY){
          s.values.slice(1).forEach((row:any,i:number)=>{if(!row[4])return;let safe:string;try{safe=JSON.stringify(redactLegacyRow(JSON.parse(row[4])))}catch{safe='Archive masquée (format inconnu)'}if(safe!==row[4])mutations.push(...gridRequests([{sheetId:s.sheetId,row:i+2,col:4,values:[safe]}]))});
          continue;
        }
        if(s.title.startsWith('_')&&s.title!==JOURNAL&&!s.title.startsWith('_ARCHIVE '))continue;
        const cols=s.title===JOURNAL?[[10,11],[13,14]]:[[6,7],[8,9],[10,14],[15,16]];
        for(const [a,b] of cols)mutations.push({repeatCell:{range:{sheetId:s.sheetId,startColumnIndex:a,endColumnIndex:b},cell:{},fields:'userEnteredValue'}});
      }
    }
    // Renew/check the lease immediately before the only data write. Disconnect cannot revive a stale job.
    budget();
    if(!await rpc(admin,'renew_google_backup_lease',{p_user_id:userId,p_token:lease}))throw new Error('BACKUP_LEASE_LOST');
    if(mutations.length){uncertainWrite=true;await googleJson(`${SHEETS_BASE}/${connection.spreadsheet_id}:batchUpdate`,token,{method:'POST',body:JSON.stringify({requests:mutations})});uncertainWrite=false}
    // Commit job acknowledgement only after Google confirmed the atomic write.
    const now=new Date().toISOString();
    if(jobs.length)check(await admin.from('google_backup_jobs').update({status:'done',locked_at:null,completed_at:now,last_error:null,updated_at:now}).in('id',jobs.map(j=>j.id)).eq('status','processing'));
    check(await admin.from('google_backup_connections').update({known_sheets:known,last_success_at:now,last_error:null,last_error_at:null,updated_at:now,...(reconcile?{last_reconciled_at:now,last_reconcile_report:plan.report,reconcile_attempts:0}:{})}).eq('user_id',userId).eq('status','connected'));
    return {ok:true,processed:jobs.length,report:plan.report};
  }catch(error){
    uncertainWrite=uncertainWrite&&(!(error as any)?.status||(error as any).status>=500);
    const now=new Date(),authFailure=(error as any)?.authFailure===true,message=String((error as any)?.message||error).slice(0,350);
    for(const job of jobs)check(await admin.from('google_backup_jobs').update({status:authFailure||job.attempts>=5?'dead':'pending',locked_at:null,next_attempt_at:new Date(now.getTime()+RETRIES[Math.min(job.attempts-1,3)]*1000).toISOString(),last_error:message,updated_at:now.toISOString()}).eq('id',job.id).eq('status','processing'));
    if(connection)check(await admin.from('google_backup_connections').update({last_error:message,last_error_at:now.toISOString(),...(authFailure?{status:'error'}:{}),...(reconcile&&!authFailure?{reconcile_requested:Number(connection.reconcile_attempts||0)+1<5,reconcile_next_attempt_at:new Date(now.getTime()+RETRIES[Math.min(Number(connection.reconcile_attempts||0),3)]*1000).toISOString()}:{}),}).eq('user_id',userId).eq('status','connected'));
    return {ok:false,error:message,reconnect:authFailure};
  }finally{
    // Google may still commit a timed-out write for up to 180 seconds. Keep the 4-minute lease
    // on ambiguous responses so a fresh writer cannot race a late Google commit.
    if(!uncertainWrite)await rpc(admin,'release_google_backup_lease',{p_user_id:userId,p_token:lease});
  }
}
