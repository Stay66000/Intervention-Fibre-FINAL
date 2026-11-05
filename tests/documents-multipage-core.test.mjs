import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPages, legacyPage, validatePages, signedPageUrl} from '../documents-multipage-core.mjs';
const file=(name='page.pdf')=>({name,type:'application/pdf',size:123});

test('multiple pages retain order and legacy attachment remains available',async()=>{
  const legacy=legacyPage({file_path:'user/old'}),committed=[];
  let i=0;const result=await appendPages({files:[file('p1.pdf'),file('p2.pdf')],existingCount:legacy.length,ownerId:'user',currentOwner:()=> 'user',makeId:()=>String(++i),upload:async()=>{},commit:async pages=>committed.push(...pages),remove:async()=>{throw Error('unexpected')}});
  assert.deepEqual(result.map(x=>x.path),['user/1','user/2']);
  assert.deepEqual(committed.map(x=>x.name),['p1.pdf','p2.pdf']);
  assert.equal(legacy[0].path,'user/old');
});
test('failed uploads clean up only newly uploaded pages',async()=>{
  const removed=[];let n=0;
  await assert.rejects(appendPages({files:[file(),file()],existingCount:1,ownerId:'u',currentOwner:()=> 'u',makeId:()=>String(++n),upload:async path=>{if(path==='u/2')throw Error('upload failed')},commit:async()=>assert.fail(),remove:async path=>removed.push(path)}),/upload failed/);
  assert.deepEqual(removed,['u/1']);
});
test('ambiguous metadata result never deletes potentially committed files',async()=>{
  let deleted=false;
  await assert.rejects(appendPages({files:[file()],existingCount:0,ownerId:'u',currentOwner:()=> 'u',makeId:()=> 'id',upload:async()=>{},commit:async()=>{throw Error('timeout')},remove:async()=>{deleted=true}}),error=>error.message==='timeout'&&error.unconfirmedPages[0].path==='u/id');
  assert.equal(deleted,false);
});
test('rejects invalid files and account switches',async()=>{
  assert.throws(()=>validatePages([{type:'text/html',size:1}],0),/PDF/);
  assert.throws(()=>validatePages([file()],20),/Maximum/);
  let owner='a';const deleted=[];
  await assert.rejects(appendPages({files:[file()],existingCount:0,ownerId:'a',currentOwner:()=>owner,makeId:()=> '1',upload:async()=>{owner='b'},commit:async()=>assert.fail(),remove:async path=>deleted.push(path)}),/Session modifiée/);
  assert.deepEqual(deleted,['a/1']);
});
test('signed viewing is scoped to owner and trusted storage origin',async()=>{
  const opts={page:{path:'alice/one'},ownerId:'alice',currentOwner:()=> 'alice',storageOrigin:'https://example.supabase.co',sign:async(path,ttl)=>{assert.equal(ttl,60);return '/storage/v1/object/sign/professional-documents/alice/one?token=test'}};
  assert.match(await signedPageUrl(opts),/^https:\/\/example\.supabase\.co\//);
  await assert.rejects(signedPageUrl({...opts,page:{path:'bob/one'}}),/inaccessible/);
  await assert.rejects(signedPageUrl({...opts,sign:async()=> 'https://attacker.example/storage/v1/object/sign/professional-documents/alice/one'}),/invalide/);
  await assert.rejects(signedPageUrl({...opts,currentOwner:()=> 'bob'}),/Session/);
});
