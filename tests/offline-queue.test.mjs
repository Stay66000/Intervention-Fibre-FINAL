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
  vm.runInContext(`let user={id:'owner'};let supabase={rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:resultExisting?.id||null,error:null}},from(){return {insert:async p=>{calls.push(['insert',p.user_id]);return {error:resultError}},select(){throw Error('table SELECT denied')}}}};`,ctx);
  vm.runInContext(fs.readFileSync(new URL('../offline-v2.js',import.meta.url),'utf8'),ctx);
  if(w.document.readyState==='loading')w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(r=>setTimeout(r,20));
  return {w,dom};
}

test('offline sync keeps an unrelated unique conflict and another account’s item',async()=>{
 const f=await fixture({code:'23505',message:'duplicate key'},null);try{await f.w.FibreOfflineV2.flush();assert.equal(await f.w.FibreOfflineV2.count(),2);assert.deepEqual(f.w.calls.filter(x=>x[0]==='insert').map(x=>x[1]),['owner'])}finally{f.dom.window.close()}
});
test('offline sync removes an ambiguous duplicate only after matching owner and event are confirmed',async()=>{
 const f=await fixture({code:'23505',message:'duplicate key'},{id:'confirmed'});try{await f.w.FibreOfflineV2.flush();assert.equal(await f.w.FibreOfflineV2.count(),1);assert.deepEqual(f.w.calls.filter(x=>x[0]==='insert').map(x=>x[1]),['owner'])}finally{f.dom.window.close()}
});

test('hors ligne, le dossier et ses photos restent ensemble après rechargement du stockage',async()=>{
 const dom=new JSDOM('<!doctype html><body><input id="f-date" value="2026-11-05"><input id="f-num"><input id="f-addr"><input id="f-comment"><input id="f-typo"><button id="f-save"></button></body>',{url:'https://fixture.invalid',runScripts:'outside-only'});const w=dom.window;w.indexedDB=new IDBFactory();w.IDBKeyRange=IDBKeyRange;Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});let selected=[{id:'photo-a',name:'test.jpg',type:'image/jpeg',blob:new Blob(['original'],{type:'image/jpeg'})}];w.FibrePhotos={hasPending:()=>selected.length>0,offlineSelection:()=>selected,offlineQueued:()=>{selected=[]}};const ctx=dom.getInternalVMContext();vm.runInContext("let user={id:'owner'};let form={operator:'orange',result:'Réussite'};let interventions=[];function selectedType(){return {id:'type-a'}};function saveIntervention(){}",ctx);vm.runInContext(fs.readFileSync(new URL('../offline-v2.js',import.meta.url),'utf8'),ctx);if(w.document.readyState==='loading')w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,30));try{assert.equal(await vm.runInContext('saveIntervention(false)',ctx),true);assert.equal(selected.length,0);const req=w.indexedDB.open('fibre_ops_offline_v2',1);const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=reject});const stored=await new Promise((resolve,reject)=>{const tx=db.transaction('queue','readonly'),r=tx.objectStore('queue').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=reject});assert.equal(stored.length,1);assert.equal(stored[0].photos[0].name,'test.jpg');assert.equal(await stored[0].photos[0].blob.text(),'original');assert.equal(stored[0].payload.id,stored[0].id);db.close()}finally{dom.window.close()}
});

test('une photo en échec reste en attente et reprend sans doublon après reconnexion',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://fixture.invalid',runScripts:'outside-only'});const w=dom.window;w.indexedDB=new IDBFactory();w.IDBKeyRange=IDBKeyRange;const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';let fail=true;const uploads=[];w.FibrePhotos={uploadQueued:async(dossier,photo,account)=>{uploads.push([dossier,photo.id,account]);if(photo.id==='p2'&&fail)throw Error('network offline')}};
 const req=w.indexedDB.open('fibre_ops_offline_v2',1);await new Promise((resolve,reject)=>{req.onupgradeneeded=()=>{req.result.createObjectStore('queue',{keyPath:'id'}).createIndex('createdAt','createdAt');req.result.createObjectStore('config',{keyPath:'key'})};req.onsuccess=resolve;req.onerror=reject});const db=req.result;await new Promise((resolve,reject)=>{const t=db.transaction('queue','readwrite');t.objectStore('queue').put({id,payload:{id,user_id:'owner',client_event_id:id},createdAt:'1',photos:[{id:'p1'},{id:'p2'}]});t.oncomplete=resolve;t.onerror=reject});db.close();
 const ctx=dom.getInternalVMContext();vm.runInContext("let user={id:'owner'};let supabase={rpc:async()=>({data:true,error:null}),from(){return {insert:async()=>({error:null}),select(){return {eq(){return this},maybeSingle:async()=>({data:{id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'},error:null})}}}}};",ctx);vm.runInContext(fs.readFileSync(new URL('../offline-v2.js',import.meta.url),'utf8'),ctx);if(w.document.readyState==='loading')w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,20));try{await w.FibreOfflineV2.flush();assert.equal(await w.FibreOfflineV2.count(),1);fail=false;await w.FibreOfflineV2.flush();assert.equal(await w.FibreOfflineV2.count(),0);assert.deepEqual(uploads.map(x=>x[1]),['p1','p2','p2'])}finally{dom.window.close()}
});

test('un dossier déjà créé reprend les photos sans lecture directe ni doublon',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;w.indexedDB=new IDBFactory();w.IDBKeyRange=IDBKeyRange;const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';const uploads=[];w.FibrePhotos={uploadQueued:async(dossier,photo,account)=>uploads.push([dossier,photo.id,account])};const req=w.indexedDB.open('fibre_ops_offline_v2',1);await new Promise((resolve,reject)=>{req.onupgradeneeded=()=>{req.result.createObjectStore('queue',{keyPath:'id'}).createIndex('createdAt','createdAt');req.result.createObjectStore('config',{keyPath:'key'})};req.onsuccess=resolve;req.onerror=reject});const db=req.result;await new Promise((resolve,reject)=>{const t=db.transaction('queue','readwrite');t.objectStore('queue').put({id,payload:{id,user_id:'owner',client_event_id:id},createdAt:'1',photos:[{id:'photo-1'}]});t.oncomplete=resolve;t.onerror=reject});db.close();
 const ctx=dom.getInternalVMContext();vm.runInContext("let user={id:'owner'};let supabase={rpc:async(name,args)=>({data:name==='photo_test_find_my_intervention'?args.p_event_id:true,error:null}),from(){return {insert:async()=>({error:{code:'23505'}}),select(){throw Error('SELECT permission denied')}}}};",ctx);vm.runInContext(fs.readFileSync(new URL('../offline-v2.js',import.meta.url),'utf8'),ctx);if(w.document.readyState==='loading')w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,20));try{await w.FibreOfflineV2.flush();assert.equal(await w.FibreOfflineV2.count(),0);assert.deepEqual(uploads,[[id,'photo-1','owner']])}finally{dom.window.close()}
});
