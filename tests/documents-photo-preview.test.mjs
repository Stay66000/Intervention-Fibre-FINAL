import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import fs from 'node:fs';
test('photos open on request inside document details and release the URL when hidden',async()=>{
 const dom=new JSDOM('<section id="view-profil"></section>',{url:'https://preview.invalid',runScripts:'outside-only'}),w=dom.window;
 try{
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.indexedDB=indexedDB;w.HTMLElement.prototype.scrollIntoView=()=>{};
  let created=0,revoked=0;w.URL.createObjectURL=()=>{created++;return 'blob:synthetic-photo'};w.URL.revokeObjectURL=()=>revoked++;
  w.alert=message=>{throw Error(message)};
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fibreops-preview-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob(['photo'],{type:'image/jpeg'}),'photo-test');tx.oncomplete=resolve;tx.onerror=reject});db.close();
  w.localStorage.setItem('fibreops-documents-demo-v1',JSON.stringify([{id:'test',type:'AIPR',name:'Test',files:[{id:'photo-test',name:'photo.jpg'}]}]));
  w.eval(fs.readFileSync(new URL('../preview/documents-demo.js',import.meta.url),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.document.querySelector('.doc-demo-launch').click();w.document.querySelector('[data-action="view"]').click();assert.equal(created,0);
  w.document.querySelector('[data-view-file]').click();await new Promise(r=>setTimeout(r,20));
  assert.equal(created,1);assert.ok(w.document.querySelector('.doc-photo-viewer img'));assert.equal(w.document.querySelector('.doc-photo-viewer img').getAttribute('src'),'blob:synthetic-photo');
  w.document.querySelector('[data-fullscreen-photo]').click();assert.equal(w.document.querySelector('.doc-fullscreen').open,true);assert.equal(w.document.querySelector('.doc-fullscreen img').getAttribute('src'),'blob:synthetic-photo');
  w.document.querySelector('.doc-fullscreen-close').click();assert.equal(w.document.querySelector('.doc-fullscreen').open,false);assert.ok(w.document.querySelector('.doc-photo-viewer img'));assert.equal(revoked,0);
  w.document.querySelector('.doc-photo-expand').click();w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(w.document.querySelector('.doc-fullscreen').open,false);assert.equal(w.document.querySelector('.doc-dialog').hidden,false);
  w.document.querySelector('[data-close-photo]').click();assert.equal(w.document.querySelector('.doc-photo-viewer'),null);assert.equal(revoked,1);
 }finally{w.close()}
});
