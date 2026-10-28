const CACHE='fibre-ops-roadmap-v2-1';
const CACHE_PREFIX='fibre-ops-';
const OFFLINE='./offline.html';
const CORE=[
  './manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',OFFLINE,
  './roadmap-v2.css','./offline-v2.js','./capture-v2.js','./billing-roadmap-v2.js','./finance-v2.js',
  './company-v2.css','./company-v2.js','./company-v2-runtime-fix.js','./experience.css','./experience.js'
];

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

function freshRequest(req){return new Request(req,{cache:'no-store'})}
async function cachePut(key,response){
  if(!response||!response.ok)return;
  try{
    if((response.headers.get('cache-control')||'').includes('no-store')||response.headers.get('content-type')?.includes('text/html'))return;
    const cache=await caches.open(CACHE);await cache.put(key,response);
  }catch(e){console.warn('[FIBRE OPS SW] cache write skipped',e)}
}

self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.searchParams.has('code')||url.searchParams.has('token_hash'))return;

  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{return await fetch(freshRequest(req))}
      catch(e){return (await caches.match(OFFLINE))||Response.error()}
    })());
    return;
  }

  event.respondWith((async()=>{
    try{
      const network=await fetch(freshRequest(req));
      if(network?.ok)await cachePut(req,network.clone());
      return network;
    }catch(e){return (await caches.match(req))||Response.error()}
  })());
});
