import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clean,expiresAt} from '../workers/photos-cleanup-test.js';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
function bucket(entries){const m=new Map(entries);return {m,async list({prefix}){return {objects:[...m].filter(([k])=>k.startsWith(prefix)).map(([key,uploaded])=>({key,uploaded})),truncated:false}},async delete(keys){for(const k of [keys].flat())m.delete(k)}}}
test('six calendar months handle the end of the month',()=>{assert.equal(new Date(expiresAt('2026-08-31T12:00:00Z')).toISOString(),'2027-02-28T12:00:00.000Z')});
test('deleted dossier and expired photos are removed in both buckets, production keys untouched',async()=>{
 const p=`preview-photos/${id}/`, primary=bucket([[p+'a',new Date('2026-10-01')],['preview-photos/old/p',new Date('2026-01-01')],['test-photos/untouched',new Date('2026-01-01')]]),backup=bucket([[p+'a',new Date('2026-10-01')],['preview-photos/old/p',new Date('2026-01-01')]]);let acks=0;const prev=globalThis.fetch;
 globalThis.fetch=async(_u,init)=>{const data=JSON.parse(init.body);if(data.p_done)acks++;return Response.json([{intervention_id:id,created_at:'2026-11-01T00:00:00Z'}])};
 try{await clean({FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup,PHOTO_TEST_CLEANUP_SECRET:'test'},Date.parse('2026-11-05'));assert.deepEqual([...primary.m.keys()],['test-photos/untouched']);assert.equal(backup.m.size,0);assert.equal(acks,1)}finally{globalThis.fetch=prev}
});
test('a failed backup removal does not acknowledge cleanup',async()=>{
 const primary=bucket([]),backup=bucket([[`preview-photos/${id}/a`,new Date()]]);backup.delete=async()=>{throw Error('offline')};let acks=0;const prev=globalThis.fetch;globalThis.fetch=async(_u,init)=>{if(JSON.parse(init.body).p_done)acks++;return Response.json([{intervention_id:id,created_at:new Date().toISOString()}])};try{await assert.rejects(clean({FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup,PHOTO_TEST_CLEANUP_SECRET:'test'}));assert.equal(acks,0)}finally{globalThis.fetch=prev}
});
