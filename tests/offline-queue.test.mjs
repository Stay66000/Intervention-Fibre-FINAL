import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';

async function fixture(error, existing) {
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://fixture.invalid',runScripts:'outside-only'});
  const w=dom.window;w.indexedDB=new IDBFactory();w.IDBKeyRange=IDBKeyRange;
  const req=w.indexedDB.open('fibre_ops_offline_v2',1);
  await new Promise((resolve,reject)=>{req.onupgradeneeded=()=>{req.result.createObjectStore('queue',{keyPath:'id'}).createIndex('createdAt','createdAt');req.result.createObjectStore('config',{keyPath:'key'})};req.onsuccess=resolve;req.onerror=reject});
  const db=req.result;await new Promise((resolve,reject)=>{const tx=db.transaction('queue','readwrite');for(const [id,user_id] of [['a','owner'],['b','other']])tx.objectStore('queue').put({id,payload:{user_id,client_event_id:id},createdAt:id});tx.oncomplete=resolve;tx.onerror=reject});db.close();
  w.resultError=error;w.resultExisting=existing;w.calls=[];
  const ctx=dom.getInternalVMContext();
  vm.runInContext(`let user={id:'owner'};let supabase={from(){return {insert:async p=>{calls.push(['insert',p.user_id]);return {error:resultError}},select(){return {eq(){return this},maybeSingle:async()=>({data:resultExisting,error:null})}}}}};`,ctx);
  vm.runInContext(fs.readFileSync(new URL('../offline-v2.js',import.meta.url),'utf8'),ctx);
  if(w.document.readyState==='loading')w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(r=>setTimeout(r,20));
  return {w,dom};
}

test('offline sync keeps an unrelated unique conflict and another account’s item',async()=>{
 const f=await fixture({code:'23505',message:'duplicate key'},null);try{await f.w.FibreOfflineV2.flush();assert.equal(await f.w.FibreOfflineV2.count(),2);assert.deepEqual(f.w.calls.map(x=>x[1]),['owner'])}finally{f.dom.window.close()}
});
test('offline sync removes an ambiguous duplicate only after matching owner and event are confirmed',async()=>{
 const f=await fixture({code:'23505',message:'duplicate key'},{id:'confirmed'});try{await f.w.FibreOfflineV2.flush();assert.equal(await f.w.FibreOfflineV2.count(),1);assert.deepEqual(f.w.calls.map(x=>x[1]),['owner'])}finally{f.dom.window.close()}
});
