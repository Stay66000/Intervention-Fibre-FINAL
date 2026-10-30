import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import {webcrypto} from 'node:crypto';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/google-drive-oauth-callback/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
function fixture({metadataFails=false}={}){
 let stateAvailable=true,handler;const mutations=[],calls={created:0,exchanged:0,woken:0};
 const admin={from(table){let operation='select',payload;const query={select(){return query},delete(){operation='delete';return query},eq(){return query},in(){return query},maybeSingle(){return query},upsert(p){operation='upsert';payload=p;return query},update(p){operation='update';payload=p;return query},then(resolve,reject){return Promise.resolve().then(()=>{
  if(table==='google_backup_oauth_states'){const result=stateAvailable?[{user_id:'owner',expires_at:new Date(Date.now()+3600000).toISOString(),return_origin:'https://intervention-fibre-final.pages.dev'}]:[];stateAvailable=false;return {data:result}}
  if(operation!=='select'){mutations.push({table,operation,payload});return {data:null}}
  if(table==='google_backup_connections')return {data:{spreadsheet_id:'original-sheet',spreadsheet_url:'https://docs.google.com/spreadsheets/d/original-sheet/edit',google_email:'owner@example.invalid'}};
  if(table==='google_backup_tokens')return {data:{refresh_token:'old-refresh'}};
  throw Error(table);
 }).then(resolve,reject)}};return query},rpc:async()=>{calls.woken++;return {data:null}}};
 const context={console:{error(){}},crypto:webcrypto,TextEncoder,URL,URLSearchParams,AbortSignal,Response,Date,
 Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn}},createClient:()=>admin,secretKey:()=> 'fixture',check:r=>{if(r.error)throw r.error;return r.data},JOURNAL:'_JOURNAL_BACKUP',SHEETS_BASE:'https://sheets.googleapis.com/v4/spreadsheets',monthTitle:()=> 'Octobre 2026',
 googleJson:async(url,token,init={})=>{
  if(url.includes('userinfo'))return {email:'owner@example.invalid'};
  if(init.method==='POST'){calls.created++;return {spreadsheetId:'new-sheet',spreadsheetUrl:'url',sheets:[]}}
  if(metadataFails)throw Object.assign(Error('GOOGLE_503'),{status:503});
  return {spreadsheetUrl:'https://docs.google.com/spreadsheets/d/original-sheet/edit',sheets:[]};
 },fetch:async()=>{calls.exchanged++;return new Response(JSON.stringify({access_token:'access',refresh_token:'new-refresh',scope:'openid email drive.file'}),{status:200})}};
 vm.createContext(context);vm.runInContext(source,context);
 return {calls,mutations,run:()=>handler(new Request('https://fixture.invalid/?code=authorized-fixture&state=one-use-state'))};
}
test('OAuth reconnection retains the same spreadsheet and resumes reconciliation, including cancelled jobs',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.status,302);assert.match(r.headers.get('location'),/google_backup=connected/);assert.equal(f.calls.created,0);assert.equal(f.calls.woken,1);
 const c=f.mutations.find(x=>x.table==='google_backup_connections');assert.equal(c.payload.spreadsheet_id,'original-sheet');assert.equal(c.payload.reconcile_requested,true);
 assert.ok(f.mutations.some(x=>x.table==='google_backup_jobs'&&x.payload.status==='pending'));
});
test('temporary Google metadata errors never create a new workbook or replace the stored connection',async()=>{
 const f=fixture({metadataFails:true}),r=await f.run();assert.match(r.headers.get('location'),/google_backup=error/);assert.equal(f.calls.created,0);assert.equal(f.mutations.length,0);
});
test('parallel OAuth callbacks consume the state exactly once',async()=>{
 const f=fixture();const responses=await Promise.all([f.run(),f.run()]);assert.equal(f.calls.exchanged,1);assert.equal(responses.filter(r=>r.headers.get('location').includes('google_backup=connected')).length,1);
});
