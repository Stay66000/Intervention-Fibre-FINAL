import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onProductionPhotoRequest} from '../functions/_lib/photos-production.js';

const A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const D='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const P='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const bytes=new Uint8Array([255,216,255,2,3,4]);

function fakeBucket(){
  const items=new Map();
  return {items,async put(key,value,meta){items.set(key,{bytes:new Uint8Array(value),meta})},
    async get(key){const it=items.get(key);return it?{body:it.bytes,httpMetadata:it.meta?.httpMetadata||{},arrayBuffer:async()=>it.bytes.slice().buffer}:null},
    async list({prefix}){return{objects:[...items].filter(([k])=>k.startsWith(prefix)).map(([key,v])=>({key,size:v.bytes.byteLength,uploaded:new Date('2026-11-05'),customMetadata:v.meta?.customMetadata})),truncated:false}},
    async delete(keys){for(const key of [keys].flat())items.delete(key)}
  };
}
async function fixture(method='GET',photo=null,body=null,{backup=true,canAccess=true,enabled=true,queue=true}={}){
  const primary=fakeBucket(),secondary=fakeBucket(),calls=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const u=String(url);
    if(u.includes('/auth/v1/user'))return Response.json({id:A});
    if(u.endsWith('/photo_my_access'))return Response.json(enabled);
    if(u.endsWith('/photo_can_access'))return Response.json(canAccess);
    if(u.endsWith('/photo_enqueue_delete')){calls.push('queued');return queue?Response.json(true):new Response('unavailable',{status:503})}
    throw Error('Unexpected request '+u);
  };
  const args={intervention:D,...(photo?{photo}:{}),...(method==='PUT'?{name:'original.jpg'}:{})};
  const req=new Request('https://site.test/api/photos?'+new URLSearchParams(args),{method,headers:{authorization:'Bearer test-token',...(body?{'content-type':'image/jpeg'}:{})},body});
  const ctx={request:req,env:{FIBRE_PHOTOS:primary,...(backup?{FIBRE_PHOTOS_BACKUP:secondary}:{})}};
  const call=()=>onProductionPhotoRequest(ctx,{base:'https://example.supabase.co',key:'publishable',validPhoto:(v,t)=>t==='image/jpeg'&&new Uint8Array(v)[0]===255});
  return {primary,secondary,calls,call,restore:()=>globalThis.fetch=originalFetch};
}
test('production upload writes original bytes to both buckets with no preview prefix',async()=>{
  const f=await fixture('PUT',P,bytes);
  try{const r=await f.call();assert.equal(r.status,200);for(const bucket of [f.primary,f.secondary]){assert.equal(bucket.items.size,1);assert.deepEqual([...bucket.items.get('photos/'+D+'/'+P).bytes],[...bytes])}}
  finally{f.restore()}
});
test('production upload fails closed without a secondary R2 binding',async()=>{
  const f=await fixture('PUT',P,bytes,{backup:false});try{assert.equal((await f.call()).status,503);assert.equal(f.primary.items.size,0)}finally{f.restore()}
});
test('legacy primary photos remain readable with their original key',async()=>{
  const f=await fixture('GET');try{await f.primary.put('test-photos/'+D+'/'+P,bytes,{customMetadata:{name:'legacy.jpg'},httpMetadata:{contentType:'image/jpeg'}});const r=await f.call();assert.equal(r.status,200);assert.deepEqual((await r.json()).files.map(x=>x.id),[P]);}finally{f.restore()}
});
test('unauthorized users cannot list or manipulate production photos',async()=>{
  const f=await fixture('PUT',P,bytes,{canAccess:false});try{assert.equal((await f.call()).status,403);assert.equal(f.primary.items.size,0)}finally{f.restore()}
});
test('production deletion queues a durable job before deleting both copies and legacy paths',async()=>{
  const f=await fixture('DELETE',P);try{for(const b of [f.primary,f.secondary]){await b.put('photos/'+D+'/'+P,bytes,{});await b.put('test-photos/'+D+'/'+P,bytes,{})}
    const r=await f.call();assert.equal(r.status,200);assert.deepEqual(f.calls,['queued']);assert.equal(f.primary.items.size,0);assert.equal(f.secondary.items.size,0);
  }finally{f.restore()}
});
test('failed cleanup enqueue prevents physical deletion',async()=>{
  const f=await fixture('DELETE',P,null,{queue:false});try{await f.primary.put('photos/'+D+'/'+P,bytes,{});assert.equal((await f.call()).status,503);assert.equal(f.primary.items.size,1)}finally{f.restore()}
});
