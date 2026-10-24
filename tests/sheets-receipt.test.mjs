import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {webcrypto} from 'node:crypto';
const code=fs.readFileSync(new URL('../sheets-bridge.js',import.meta.url),'utf8');
const body={id:'fixture-intervention',date:'2026-10-24',num:'1234567890',addr:'12 rue Test',typo:'Aérien',statut:'Réussite',op:'Orange',montant:100,comment:'',tech:'Brendan'};
function fixture({action='create',postFails=false}={}){
 const values=new Map([['fibre_ops_sheets_sandbox_enabled_v2','1'],['fibre_ops_sheets_sandbox_outbox_v2',JSON.stringify([{body:{...body,action},at:'2026-10-24T12:00:00Z'}])]]);
 let rows=[{...body,date:'24/10/2026'}],posts=0;
 const ctx={crypto:webcrypto,TextEncoder,AbortController,Event,console:{warn(){}},navigator:{onLine:true},setTimeout:()=>0,clearTimeout(){},
  user:{id:'account-a'},profile:{role:'admin'},currentCompanyId:()=>null,
  localStorage:{getItem:key=>values.get(key)||null,setItem:(key,val)=>values.set(key,val)},
  addEventListener(){},dispatchEvent(){},fetch:async(url,init)=>{
   if(init?.method==='POST'){posts++;if(postFails)throw new Error('network down');return {ok:false,type:'opaque',status:0};}
   if(String(url).includes('health=1'))return {ok:true,json:async()=>({supportsMutations:true,version:'2'})};
   return {ok:true,json:async()=>rows};
  }};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,api:ctx.FibreSheetsBeta,posts:()=>posts,setRows:r=>{rows=r},values};
}
test('opaque transmission is never reported as verified until the sheet matches',async()=>{
 const f=fixture();await f.api.retry();
 assert.equal(f.posts(),1);assert.equal(f.api.status().pending,0);assert.ok(f.api.status().lastSentAt);assert.equal(f.api.status().lastVerifiedAt,null);
 assert.equal(await f.api.verifyLastReceipt(),true);assert.ok(f.api.status().lastVerifiedAt);
});
test('a changed amount or missing row cannot confirm the backup',async()=>{
 const f=fixture();await f.api.retry();f.setRows([{...body,montant:99,date:'24/10/2026'}]);
 assert.equal(await f.api.verifyLastReceipt(),false);assert.equal(f.api.status().lastVerifiedAt,null);
 f.setRows([]);assert.equal(await f.api.verifyLastReceipt(),false);
});
test('network failures retain the outbox and report no successful transmission',async()=>{
 const f=fixture({postFails:true});await f.api.retry();assert.equal(f.api.status().pending,1);assert.equal(f.api.status().lastSentAt,undefined);assert.match(f.api.status().error,/file d’attente/);
});
test('deletion receipt requires row absence, and account switching hides prior receipts',async()=>{
 const f=fixture({action:'delete'});await f.api.retry();assert.equal(await f.api.verifyLastReceipt(),false);f.setRows([]);assert.equal(await f.api.verifyLastReceipt(),true);
 f.ctx.user={id:'account-b'};assert.equal(f.api.status().lastSentAt,undefined);await assert.rejects(f.api.verifyLastReceipt(),/Aucun envoi/);
});
test('loading the beta bridge twice does not wrap the transport twice',()=>{
 const f=fixture(),first=f.ctx.fetch;vm.runInContext(code,f.ctx);assert.equal(f.ctx.fetch,first);
});
