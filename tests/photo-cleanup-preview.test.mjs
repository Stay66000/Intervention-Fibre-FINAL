import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clean,expiresAt,retentionSweep} from '../workers/photos-cleanup-test.js';

const ID='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', PHOTO='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const ID2='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const KEY='preview-photos/'+ID+'/'+PHOTO;
const now=Date.parse('2026-11-06T00:00:00Z');

function bucket(entries=[]){
  const m=new Map(entries.map(([key,uploaded,sourceUploadedAt])=>[key,{uploaded:new Date(uploaded),size:6,customMetadata:sourceUploadedAt?{sourceUploadedAt}:{}}]));
  const calls={deleted:[],listed:[]};
  return {m,calls,
    async list({prefix}){calls.listed.push(prefix);return{objects:[...m.entries()].filter(([key])=>key.startsWith(prefix)).map(([key,info])=>({key,...info})),truncated:false}},
    async delete(keys){for(const key of [keys].flat()){calls.deleted.push(key);m.delete(key)}}
  };
}
function env(primary,backup){return{FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup,PHOTO_TEST_CLEANUP_SECRET:'fake-secret'}}
async function withJobs(jobs,fn){
  const fetchOriginal=globalThis.fetch,acked=[];
  globalThis.fetch=async(_url,init)=>{
    const {p_done}=JSON.parse(init.body);
    if(p_done){acked.push(p_done);jobs=jobs.filter(x=>x.intervention_id!==p_done)}
    return Response.json(jobs);
  };
  try{return await fn(acked)}finally{globalThis.fetch=fetchOriginal}
}
test('six calendar months preserve time and clamp end-of-month leap dates',()=>{
  assert.equal(new Date(expiresAt('2026-08-31T12:00:00Z')).toISOString(),'2027-02-28T12:00:00.000Z');
  assert.equal(new Date(expiresAt('2023-08-31T11:00:00Z')).toISOString(),'2024-02-29T11:00:00.000Z');
  assert.throws(()=>expiresAt('invalid timestamp'),/Invalid/);
});
test('preview-only expiry removes original and backup at six calendar months; leaves production keys untouched',async()=>{
  const p=bucket([[KEY,'2026-05-05T00:00:00Z'],['test-photos/'+ID+'/'+PHOTO,'2025-01-01'],['photos/'+ID+'/'+PHOTO,'2025-01-01']]);
  const b=bucket([[KEY,'2026-05-05T00:00:00Z'],['photos/'+ID+'/'+PHOTO,'2025-01-01']]);
  const result=await retentionSweep(p,b,now);
  assert.equal(result.removed,1);
  assert.equal(p.m.has(KEY),false);assert.equal(b.m.has(KEY),false);
  assert.equal(p.m.size,2);assert.equal(b.m.size,1);
  assert.ok(p.calls.deleted.every(k=>k.startsWith('preview-photos/')));
  assert.ok(b.calls.deleted.every(k=>k.startsWith('preview-photos/')));
});
test('new photos are not deleted before their six-month anniversary',async()=>{
  const p=bucket([[KEY,'2026-05-07T00:00:00Z']]),b=bucket([[KEY,'2026-05-07T00:00:00Z']]);
  const result=await retentionSweep(p,b,now);
  assert.equal(result.expired,0);assert.equal(p.m.has(KEY),true);assert.equal(b.m.has(KEY),true);
});
test('later backup upload retains the original first-upload timestamp',async()=>{
  const p=bucket([[KEY,'2026-05-03T00:00:00Z','2026-05-03T00:00:00Z']]);
  const b=bucket([[KEY,'2026-11-05T00:00:00Z','2026-05-03T00:00:00Z']]);
  assert.equal((await retentionSweep(p,b,now)).removed,1);
  assert.equal(b.m.has(KEY),false);
});
test('dry-run reports expiration but never deletes or acknowledges jobs',async()=>{
  const p=bucket([[KEY,'2026-01-01']]),b=bucket([[KEY,'2026-01-01']]);
  await withJobs([{intervention_id:ID}],async acked=>{
    const result=await clean(env(p,b),now,{dryRun:true});
    assert.equal(result.completed,0);assert.equal(result.retention.expired,1);
    assert.equal(result.retention.removed,0);assert.equal(acked.length,0);
    assert.equal(p.m.has(KEY),true);assert.equal(b.m.has(KEY),true);
  });
});
test('cleanup of a removed dossier deletes only its preview objects in both buckets',async()=>{
  const other='preview-photos/'+ID2+'/'+PHOTO;
  const p=bucket([[KEY,'2026-10-01'],[other,'2026-10-01'],['test-photos/'+ID+'/'+PHOTO,'2025-01-01']]);
  const b=bucket([[KEY,'2026-10-01'],[other,'2026-10-01']]);
  await withJobs([{intervention_id:ID}],async acked=>{
    const result=await clean(env(p,b),now);
    assert.equal(result.completed,1);assert.deepEqual(acked,[ID]);
    assert.equal(p.m.has(KEY),false);assert.equal(b.m.has(KEY),false);
    assert.equal(p.m.has(other),true);assert.equal(b.m.has(other),true);
    assert.equal(p.m.has('test-photos/'+ID+'/'+PHOTO),true);
  });
});
test('failed backup deletion leaves cleanup job unacknowledged',async()=>{
  const p=bucket([[KEY,'2026-10-01']]),b=bucket([[KEY,'2026-10-01']]);
  b.delete=async()=>{throw Error('backup unavailable')};
  await withJobs([{intervention_id:ID}],async acked=>{
    await assert.rejects(clean(env(p,b),now),/backup unavailable/);
    assert.equal(acked.length,0);
  });
});
test('invalid queue ID fails closed before any R2 deletion',async()=>{
  const p=bucket([[KEY,'2026-01-01']]),b=bucket([[KEY,'2026-01-01']]);
  await withJobs([{intervention_id:'invalid-id'}],async acked=>{
    await assert.rejects(clean(env(p,b),now),/Invalid queued identifier/);
    assert.equal(acked.length,0);assert.equal(p.m.has(KEY),true);
  });
});
test('cleanup limits external acknowledgements and leaves remaining work for another run',async()=>{
  const p=bucket(),b=bucket();
  let jobs=Array.from({length:12},(_,i)=>({intervention_id:'aaaaaaaa-aaaa-4aaa-aaaa-'+String(i).padStart(12,'0')}));
  const acked=[];
  const fetchOriginal=globalThis.fetch;
  globalThis.fetch=async(_u,init)=>{
    const {p_done}=JSON.parse(init.body);
    if(p_done){acked.push(p_done);jobs=jobs.filter(j=>j.intervention_id!==p_done)}
    return Response.json(jobs);
  };
  try{
    assert.equal((await clean(env(p,b),now)).completed,5);
    assert.equal((await clean(env(p,b),now)).completed,5);
    assert.equal((await clean(env(p,b),now)).completed,2);
    assert.equal(new Set(acked).size,12);
  }finally{globalThis.fetch=fetchOriginal}
});
test('an incomplete listing refuses to expire anything',async()=>{
  const p=bucket([[KEY,'2026-01-01']]),b=bucket([[KEY,'2026-01-01']]);
  p.list=async()=>({objects:[{key:KEY,uploaded:new Date('2026-01-01')}],truncated:true,cursor:null});
  await assert.rejects(retentionSweep(p,b,now),/inventory was truncated/);
  assert.equal(b.calls.deleted.length,0);
});
test('unknown or non-UUID preview keys are never deleted',async()=>{
  const bogus='preview-photos/not-a-real-uuid/'+PHOTO;
  const p=bucket([[bogus,'2025-01-01'],[KEY,'2026-11-05']]),b=bucket([[bogus,'2025-01-01'],[KEY,'2026-11-05']]);
  await retentionSweep(p,b,now);
  assert.equal(p.m.has(bogus),true);assert.equal(b.m.has(bogus),true);
});
