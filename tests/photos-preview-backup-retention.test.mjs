import {test} from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/photos.js';

const UID='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const IID='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const PHOTO='eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const key='photos/'+IID+'/'+PHOTO;
const jpeg=new Uint8Array([255,216,255,10,20,30]);
function bucket(){
  const files=new Map();
  return {files,
    async head(k){return files.get(k)||null},
    async put(k,bytes,options){
      const data=new Uint8Array(bytes);
      files.set(k,{size:data.length,data,httpMetadata:options.httpMetadata,customMetadata:options.customMetadata,uploaded:new Date()});
    },
    async list({prefix}){return {objects:[...files.entries()].filter(([k])=>k.startsWith(prefix)).map(([key,v])=>({key,...v})),truncated:false}},
    async get(k){const row=files.get(k);return row?{body:row.data,httpMetadata:row.httpMetadata}:null},
    async delete(k){files.delete(k)}
  };
}
async function scenario(fn){
  const primary=bucket(),backup=bucket(),originalFetch=globalThis.fetch;
  globalThis.fetch=async (url)=>{
    const u=String(url);
    if(u.endsWith('/auth/v1/user'))return Response.json({id:UID});
    if(u.endsWith('/photo_my_access'))return Response.json(true);
    if(u.endsWith('/photo_can_access'))return Response.json(true);
    throw Error('Unexpected authentication URL');
  };
  const call=(method='GET',photo=null,bytes)=>onRequest({
    request:new Request('https://preview.test/api/photos?'+new URLSearchParams({intervention:IID,...(photo?{photo,name:'original.jpg'}:{})}),
      {method,headers:{authorization:'Bearer test-session',...(bytes?{'content-type':'image/jpeg'}:{})},body:bytes||undefined}),
    env:{FIBRE_PHOTOS:primary,FIBRE_PHOTOS_BACKUP:backup,PHOTO_STORAGE_MODE:'production'}
  });
  try{await fn({primary,backup,call})}finally{globalThis.fetch=originalFetch}
}
test('original-size photo stores identical bytes and SHA-256 in both production R2 buckets',async()=>{
  await scenario(async({primary,backup,call})=>{
    const r=await call('PUT',PHOTO,jpeg);
    assert.equal(r.status,200);
    const result=await r.json();assert.equal(result.backupSaved,true);
    assert.deepEqual([...primary.files.get(key).data],[...jpeg]);
    assert.deepEqual([...backup.files.get(key).data],[...jpeg]);
    assert.equal(primary.files.get(key).customMetadata.sha256,backup.files.get(key).customMetadata.sha256);
    assert.equal(primary.files.get(key).customMetadata.sourceUploadedAt,backup.files.get(key).customMetadata.sourceUploadedAt);
    assert.equal(primary.files.size,1);assert.equal(backup.files.size,1);
  });
});
test('a retry after interrupted upload does not restart six-month clock',async()=>{
  await scenario(async({primary,backup,call})=>{
    const initial='2026-01-31T10:00:00.000Z';
    await backup.put(key,jpeg,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{name:'original.jpg',sourceUploadedAt:initial}});
    const response=await call('PUT',PHOTO,jpeg);
    assert.equal(response.status,200);
    assert.equal((await response.json()).expiresAt,'2026-07-31T10:00:00.000Z');
    assert.equal(primary.files.get(key).customMetadata.sourceUploadedAt,initial);
    assert.equal(backup.files.get(key).customMetadata.sourceUploadedAt,initial);
  });
});
test('listing marks verified backup and exact expiration date; absent backup is visible',async()=>{
  await scenario(async({primary,backup,call})=>{
    await call('PUT',PHOTO,jpeg);
    let response=await call();let data=await response.json();
    assert.equal(data.files[0].backupState,'verified');
    assert.ok(data.files[0].expiresAt);
    assert.ok(!('sha256' in data.files[0]));
    backup.files.clear();
    response=await call();data=await response.json();
    assert.equal(data.files[0].backupState,'missing');
    assert.equal(primary.files.size,1);
  });
});
test('failed secondary write cannot confirm storage or overwrite the primary',async()=>{
  await scenario(async({primary,backup,call})=>{
    backup.put=async()=>{throw Error('secondary unavailable')};
    const response=await call('PUT',PHOTO,jpeg);
    assert.equal(response.status,503);
    assert.equal(primary.files.size,0);
  });
});
