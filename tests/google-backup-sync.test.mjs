import test from 'node:test';
import assert from 'node:assert/strict';
import {syncUser} from '../supabase/functions/_shared/google-backup-sync.ts';
import {JOURNAL,LEGACY,monthlyRow} from '../supabase/functions/_shared/google-backup-model.mjs';
const sample={id:'immutable',intervention_date:'2026-10-15',reference:'00123',address:'Adresse',result:'Réussite',operator:'orange',applied_amount:150};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function fixture(){
 const conn={user_id:'owner',spreadsheet_id:'sheet',status:'connected',known_sheets:{}},job={id:'event',user_id:'owner',intervention_id:sample.id,action:'upsert',snapshot:{...sample},status:'pending',attempts:0};
 const state={conn,jobs:[job],rows:[{...sample}],lease:null,failed:null,failAck:false,reads:0,writes:0,requests:[],hold:false,hidden:false};
 state.sheets=[{sheetId:1,title:'Octobre 2026',gridProperties:{rowCount:2000,columnCount:26},values:[Array(19).fill('').concat('FIBRE_OPS_TEMPLATE_V4')]},{sheetId:2,title:'Novembre 2026',gridProperties:{rowCount:2000,columnCount:26},values:[Array(19).fill('').concat('FIBRE_OPS_TEMPLATE_V4')]},{sheetId:3,title:JOURNAL,gridProperties:{rowCount:2000,columnCount:26},values:[['Event ID']]},{sheetId:4,title:LEGACY,gridProperties:{rowCount:2000,columnCount:26},values:[['Archive ID']]}];
 const admin={
  async rpc(name,args){
   if(name==='acquire_google_backup_lease'){if(state.lease)return {data:false};state.lease=args.p_token;return {data:true}}
   if(name==='renew_google_backup_lease')return {data:state.lease===args.p_token&&conn.status==='connected'};
   if(name==='release_google_backup_lease'){if(state.lease===args.p_token)state.lease=null;return {data:null}}
   if(name==='claim_google_backup_jobs_v2'){const jobs=state.jobs.filter(j=>j.status==='pending');for(const j of jobs){j.status='processing';j.attempts++}return {data:structuredClone(jobs)}}
   if(name==='google_backup_source')return {data:{rows:structuredClone(state.rows),hide_prices:state.hidden}};
   throw Error(name);
  },
  from(table){
   const filters=[];let patch=null;
   const query={select(){return query},update(p){patch=p;return query},eq(k,v){filters.push(r=>r[k]===v);return query},in(k,v){filters.push(r=>v.includes(r[k]));return query},single(){return query},maybeSingle(){return query},
    then(resolve,reject){return Promise.resolve().then(()=>{
     if(table==='google_backup_tokens')return {data:{refresh_token:'test-refresh'}};
     let rows=table==='google_backup_connections'?[conn]:state.jobs;rows=rows.filter(r=>filters.every(f=>f(r)));
     if(patch){if(state.failAck&&table==='google_backup_jobs'&&patch.status==='done'){state.failAck=false;return {error:Error('ack failed')}}for(const r of rows)Object.assign(r,patch)}
     return {data:table==='google_backup_connections'?structuredClone(rows[0]):structuredClone(rows)};
    }).then(resolve,reject)}
   };return query;
  }
 };
 const native=global.fetch;global.Deno={env:{get:()=> 'test'}};
 global.fetch=async(url,init={})=>{
  url=String(url);
  if(url.includes('oauth2.googleapis.com')){
   if(state.failed==='token503')return json({error:'temporarily_unavailable'},503);
   if(state.failed==='invalid_grant')return json({error:'invalid_grant'},400);
   return json({access_token:'test-access'});
  }
  if(url.includes('/values:batchGet')){state.reads++;const ranges=new URL(url).searchParams.getAll('ranges');return json({valueRanges:ranges.map(range=>({values:state.sheets.find(s=>range.startsWith("'"+s.title+"'!"))?.values||[]}))})}
  if(init.method!=='POST'){state.reads++;return json({sheets:state.sheets.map(s=>({properties:{sheetId:s.sheetId,title:s.title,gridProperties:s.gridProperties}}))})}
  const body=JSON.parse(init.body);state.writes++;state.requests.push(body);
  if(state.failed==='google503')return json({error:{message:'Unavailable'}},503);
  if(state.failed==='google401')return json({error:{message:'Expired'}},401);
  for(const request of body.requests||[]){
   if(request.updateCells){const {start,rows}=request.updateCells,s=state.sheets.find(s=>s.sheetId===start.sheetId);let row=start.rowIndex;
    for(const item of rows){while(s.values.length<=row)s.values.push([]);item.values.forEach((c,i)=>s.values[row][start.columnIndex+i]=Object.values(c.userEnteredValue||{})[0]??'');row++}
   }
   if(request.repeatCell){const {range}=request.repeatCell,s=state.sheets.find(s=>s.sheetId===range.sheetId);for(const row of s.values)for(let i=range.startColumnIndex;i<range.endColumnIndex;i++)row[i]=''}
  }
  if(state.failed==='timeout-after-commit')throw new DOMException('timed out','TimeoutError');
  return json({replies:[]});
 };
 return {admin,state,cleanup:()=>{global.fetch=native},active:()=>state.sheets.filter(s=>!s.title.startsWith('_')).flatMap(s=>s.values.slice(1).filter(r=>r[18]))};
}
test('worker batches all reads and commits mirror plus journal with one atomic write',async()=>{
 const f=fixture();try{const r=await syncUser(f.admin,'owner');assert.equal(r.ok,true);assert.equal(f.state.reads,2);assert.equal(f.state.writes,1);assert.equal(f.state.jobs[0].status,'done');assert.equal(f.active().length,1);assert.equal(f.state.lease,null)}finally{f.cleanup()}
});
test('concurrent workers cannot acquire the same workbook lease',async()=>{
 const f=fixture();try{const r=await Promise.all([syncUser(f.admin,'owner'),syncUser(f.admin,'owner')]);assert.equal(r.filter(x=>x.busy).length,1);assert.equal(f.state.writes,1);assert.equal(f.active().length,1)}finally{f.cleanup()}
});
test('temporary token failures remain pending and never demand Google reconnection',async()=>{
 const f=fixture();try{f.state.failed='token503';const r=await syncUser(f.admin,'owner');assert.equal(r.ok,false);assert.equal(r.reconnect,false);assert.equal(f.state.conn.status,'connected');assert.equal(f.state.jobs[0].status,'pending');assert.equal(f.state.jobs[0].attempts,1);assert.equal(f.state.writes,0)}finally{f.cleanup()}
});
test('invalid grant pauses jobs; reconnect and retry reuses the same ID without duplicate',async()=>{
 const f=fixture();try{f.state.failed='invalid_grant';assert.equal((await syncUser(f.admin,'owner')).reconnect,true);assert.equal(f.state.conn.status,'error');assert.equal(f.state.jobs[0].status,'dead');
 f.state.failed=null;f.state.conn.status='connected';f.state.jobs[0].status='pending';f.state.jobs[0].attempts=0;
 assert.equal((await syncUser(f.admin,'owner',true)).ok,true);assert.equal(f.active().length,1)}finally{f.cleanup()}
});
test('an ambiguous Google timeout holds the lease; retry after expiry reads the committed row and journal',async()=>{
 const f=fixture();try{f.state.failed='timeout-after-commit';assert.equal((await syncUser(f.admin,'owner')).ok,false);assert.equal(f.state.jobs[0].status,'pending');assert.ok(f.state.lease);assert.equal(f.active().length,1);
 assert.equal((await syncUser(f.admin,'owner')).busy,true);f.state.lease=null;f.state.failed=null;
 assert.equal((await syncUser(f.admin,'owner')).ok,true);assert.equal(f.active().length,1);assert.equal(f.state.sheets[2].values.length,2);assert.equal(f.state.writes,1)}finally{f.cleanup()}
});
test('failed Supabase acknowledgement replays without a second Google row or journal event',async()=>{
 const f=fixture();try{f.state.failAck=true;assert.equal((await syncUser(f.admin,'owner')).ok,false);assert.equal(f.state.jobs[0].status,'pending');assert.equal((await syncUser(f.admin,'owner')).ok,true);assert.equal(f.active().length,1);assert.equal(f.state.sheets[2].values.length,2)}finally{f.cleanup()}
});
test('full startup reconcile repairs corrupted amounts and removes deleted IDs with no jobs required',async()=>{
 const f=fixture();try{f.state.jobs=[];const s=f.state.sheets[0];s.values.push(monthlyRow({...sample,applied_amount:999},'old'),monthlyRow({...sample,id:'gone'},'old'));
 const r=await syncUser(f.admin,'owner',true);assert.equal(r.report.changed,1);assert.equal(r.report.deleted,1);assert.equal(f.active().length,1);assert.equal(f.active()[0][8],150);assert.ok(f.state.conn.last_reconciled_at)}finally{f.cleanup()}
});
test('jobs reaching attempt five stop retrying automatically',async()=>{
 const f=fixture();try{f.state.jobs[0].attempts=4;f.state.failed='token503';await syncUser(f.admin,'owner');assert.equal(f.state.jobs[0].attempts,5);assert.equal(f.state.jobs[0].status,'dead')}finally{f.cleanup()}
});
test('a failed startup comparison is durable and scheduled with backoff even when there are no event jobs',async()=>{
 const f=fixture();try{f.state.jobs=[];f.state.failed='token503';const r=await syncUser(f.admin,'owner',true);assert.equal(r.ok,false);assert.equal(f.state.conn.reconcile_requested,true);assert.equal(f.state.conn.reconcile_attempts,1);assert.ok(new Date(f.state.conn.reconcile_next_attempt_at).getTime()>Date.now());assert.equal(f.state.conn.status,'connected')}finally{f.cleanup()}
});
