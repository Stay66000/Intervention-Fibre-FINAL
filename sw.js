const CACHE='fibre-ops-v3-production-1.5';
const CACHE_PREFIX='fibre-ops-';
const APP_SHELL='./index.html';
const CORE=[APP_SHELL,'./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(CORE.map(url=>new Request(url,{cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

function freshRequest(req){
  return new Request(req,{cache:'no-store'});
}

async function cachePut(key,response){
  if(!response||!response.ok)return;
  try{
    const cache=await caches.open(CACHE);
    await cache.put(key,response);
  }catch(e){
    console.warn('[FIBRE OPS SW] cache write skipped',e);
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const network=await fetch(freshRequest(req));
        if(network?.ok)await cachePut(APP_SHELL,network.clone());
        return network;
      }catch(e){
        return (await caches.match(APP_SHELL))||Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    try{
      const network=await fetch(freshRequest(req));
      if(network?.ok)await cachePut(req,network.clone());
      return network;
    }catch(e){
      return (await caches.match(req))||Response.error();
    }
  })());
});
