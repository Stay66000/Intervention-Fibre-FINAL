import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAndBackfill,clean,expiresAt} from '../workers/photos-production-maintenance.js';
const D='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const P='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const KEY='test-photos/'+D+'/'+P;
const BYTES=new Uint8Array([255,216,255,4,5,6]);
function bucket(){
 const map=new Map();
 return {map,
  async put(key,bytes,opts={}){
   const arr=new Uint8Array(bytes);
   map.set(key,{key,size:arr.length,etag:arr.join('-'),uploaded:new Date('2026-04-01T10:30:00Z'),customMetadata:opts.customMetadata||{},httpMetadata:opts.httpMetadata||{},bytes:arr});
  },
  async list({prefix}){return{objects:[...map.values()].filter(v=>v.key.startsWith(prefix)),truncated:false}},
  async head(key){return map.get(key)||null},
  async get(key){const object=map.get(key);return object?{...object,arrayBuffer:async()=>object.bytes.slice().buffer}:null},
  async delete(keys){for(const key of [keys].flat())map.delete(key)}
 };
}
test('old production photo is copied losslessly to backup and retains first-upload date',async()=>{
 const primary=bucket(),backup=bucket();
 await primary.put(KEY,BYTES,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{name:'terrain.jpg'}});
 const run=await auditAndBackfill({FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup});
 assert.equal(run.scanned,1);assert.equal(run.copied,1);assert.equal(run.complete,true);
 const copy=backup.map.get(KEY);
 assert.deepEqual([...copy.bytes],[...BYTES]);
 assert.equal(copy.customMetadata.sourceUploadedAt,'2026-04-01T10:30:00.000Z');
 assert.equal(primary.map.size,1);
});
test('partial backfill remains incomplete and never starts production cleanup',async()=>{
 const primary=bucket(),backup=bucket();
 for(let i=0;i<7;i++)await primary.put('photos/'+D+'/'+String(i).padStart(8,'0')+'-eeee-4eee-eeee-eeeeeeeeeeee',BYTES);
 const r=await auditAndBackfill({FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup},{maxCopies:6});
 assert.equal(r.copied,6);assert.equal(r.complete,false);
 assert.equal(primary.map.size,7);
});
test('conflicting secondary is preserved and prevents retention approval',async()=>{
 const primary=bucket(),backup=bucket();
 await primary.put(KEY,BYTES);await backup.put(KEY,new Uint8Array([255,216,255,99]));
 const result=await auditAndBackfill({FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup});
 assert.equal(result.mismatch,1);assert.equal(result.complete,false);
 assert.deepEqual([...backup.map.get(KEY).bytes],[255,216,255,99]);
});
test('six-month cleanup remains disabled unless backup audit and flags approve',async()=>{
 const primary=bucket(),backup=bucket();
 await primary.put(KEY,BYTES);await backup.put(KEY,BYTES);
 const result=await clean({FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup,PHOTO_PRODUCTION_CLEANUP_ENABLED:'false',PHOTO_PRODUCTION_RETENTION_ENABLED:'true',PHOTO_PRODUCTION_BACKFILL_COMPLETE:'true'});
 assert.equal(result.skipped,true);assert.equal(primary.map.size,1);assert.equal(backup.map.size,1);
 assert.equal(new Date(expiresAt('2026-08-31T12:00:00Z')).toISOString(),'2027-02-28T12:00:00.000Z');
});
