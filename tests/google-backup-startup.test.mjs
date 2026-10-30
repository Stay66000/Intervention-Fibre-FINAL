import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {JSDOM} from 'jsdom';
const code=fs.readFileSync(new URL('../google-backup.js',import.meta.url),'utf8');
function fixture(){
 const dom=new JSDOM('<html><body></body></html>',{url:'https://intervention-fibre-final.pages.dev/',runScripts:'outside-only'}),w=dom.window;
 let account='account-a',callback;const calls=[];
 w.supabase={auth:{getSession:async()=>({data:{session:account?{user:{id:account}}:null}}),onAuthStateChange:fn=>{callback=fn}},functions:{invoke:async(name,{body})=>{calls.push({account,...body});return {data:body.action==='status'?{connection:{status:'connected'},pending:0}:{ok:true}}}}};
 w.setTimeout=()=>0;w.console={warn(){},info(){}};vm.runInContext(code,dom.getInternalVMContext());w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 return {w,calls,setAccount:id=>{account=id},auth:(event,s)=>callback(event,s),close:()=>w.close()};
}
test('opening the site compares once per signed-in account without polling or double startup calls',async()=>{
 const f=fixture();try{await Promise.all([f.w.FibreGoogleBackup.onAccountReady(),f.w.FibreGoogleBackup.onAccountReady()]);await f.w.FibreGoogleBackup.onAccountReady();
 assert.equal(f.calls.filter(x=>x.action==='reconcile').length,1);
 f.setAccount('account-b');await f.w.FibreGoogleBackup.onAccountReady();assert.equal(f.calls.filter(x=>x.action==='reconcile').length,2);
 assert.ok(f.w.FibreSheetsBeta.status().modern);
 }finally{f.close()}
});
test('signing out resets the startup guard and does not retain another account status',async()=>{
 const f=fixture();try{await f.w.FibreGoogleBackup.onAccountReady();f.setAccount(null);f.auth('SIGNED_OUT',null);assert.equal(f.w.FibreGoogleBackup.status(),null);
 f.setAccount('account-a');await f.w.FibreGoogleBackup.onAccountReady();assert.equal(f.calls.filter(x=>x.action==='reconcile').length,2)}finally{f.close()}
});
