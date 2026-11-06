import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clean,expiresAt,inventoryAndBackfill} from '../workers/photos-production-maintenance.js';

const D='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const J='99999999-9999-4999-9999-999999999999';
const P='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
function bucket(){
  const m=new Map();
  const api={m,async put(key,body,meta={}){
    m.set(key,{bytes:new Uint8Array(body),uploaded:new Date(),httpMetadata:meta.httpMetadata,customMetadata:meta.customMetadata});
  },async get(key){const a=m.get(key);return a?{...a,arrayBuffer:async()=>a.bytes.slice().buffer}:null},
  async list({prefix}){return {objects:[...m.entries()].filter(([k])=>k.startsWith(prefix)).map(([key,x])=>({key,...x})),truncated:false}},
  async delete(keys){for(const key of [keys].flat())m.delete(key)}};return api;
}
test('six calendar months are anchored to the original upload',()=>{
  assert.equal(new Date(expiresAt('2026-08-31T12:00:00Z')).toISOString(),'2027-02-28T12:00:00.000Z');
});
test('production maintenance cron is inert until explicitly enabled',async()=>{
  const p=bucket(),b=bucket();await p.put('photos/'+D+'/'+P,new Uint8Array([3,4]));
  const result=await clean({FIBRE_PHOTOS:p,FIBRE_PHOTOS_BACKUP:b});
  assert.equal(result.skipped,true);assert.equal(p.m.size,1);
});
test('backfill preview never changes any objects or the preview prefix',async()=>{
  const p=bucket(),b=bucket(),key='test-photos/'+D+'/'+P;
  await p.put(key,new Uint8Array([10,20,30]));
  await p.put('preview-photos/'+D+'/'+P,new Uint8Array([2,9]));
  const result=await inventoryAndBackfill({FIBRE_PHOTOS:p,FIBRE_PHOTOS_BACKUP:b});
  assert.equal(result.scanned,1);assert.equal(result.missing,1);assert.equal(result.copied,0);
  assert.equal(b.m.size,0);assert.equal(p.m.size,2);
});
test('explicit backfill copies original bytes, preserves timestamp and verifies SHA-256',async()=>{
  const p=bucket(),b=bucket(),key='test-photos/'+D+'/'+P;
  await p.put(key,new Uint8Array([0,10,255,55]),{httpMetadata:{contentType:'image/jpeg'},customMetadata:{name:'untouched.jpg'}});
  p.m.get(key).uploaded=new Date('2026-05-11T06:40:00Z');
  const result=await inventoryAndBackfill({FIBRE_PHOTOS:p,FIBRE_PHOTOS_BACKUP:b,PHOTO_PRODUCTION_BACKFILL_ENABLED:'true'},{copy:true});
  assert.equal(result.copied,1);assert.equal(result.verified,1);
  assert.deepEqual([...b.m.get(key).bytes],[0,10,255,55]);
  assert.equal(b.m.get(key).customMetadata.sourceUploadedAt,'2026-05-11T06:40:00.000Z');
});
test('backfill copy is refused without explicit activation flag',async()=>{
  await assert.rejects(inventoryAndBackfill({FIBRE_PHOTOS:bucket(),FIBRE_PHOTOS_BACKUP:bucket()},{copy:true}),/not authorized/);
});
test('authorized cleanup removes only deleted dossier keys in both buckets',async()=>{
  const p=bucket(),b=bucket(),key='photos/'+D+'/'+P;
  for(const q of [p,b]){await q.put(key,new Uint8Array([1,2]));await q.put('preview-photos/'+D+'/'+P,new Uint8Array([3]))}
  const previous=globalThis.fetch;const pending=[{job_id:J,intervention_id:D,photo_id:null}];const acks=[];
  globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);if(body.p_done){acks.push(body.p_done);pending.length=0;}return Response.json(pending)};
  try{const env={FIBRE_PHOTOS:p,FIBRE_PHOTOS_BACKUP:b,PHOTO_PRODUCTION_CLEANUP_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'key',PHOTO_PRODUCTION_WORKER_SECRET:'synthetic-long-secret'};
    const result=await clean(env);assert.equal(result.completed,1);assert.deepEqual(acks,[J]);
    assert.equal(p.m.has(key),false);assert.equal(b.m.has(key),false);
    assert.equal(p.m.has('preview-photos/'+D+'/'+P),true);
    assert.equal(b.m.has('preview-photos/'+D+'/'+P),true);
  }finally{globalThis.fetch=previous}
});
