const CACHE='fibre-ops-v3-production-1.4';
const CACHE_PREFIX='fibre-ops-';
const APP_SHELL='./index.html';
const CORE=[APP_SHELL,'./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./app-hotfix.js'];

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

async function patchAppHtml(response){
  if(!response)return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  const tag='<script src="./app-hotfix.js?v=4"></script>';
  const patched=html.includes('app-hotfix.js')?html:html.replace('</body>',tag+'</body>');
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  return new Response(patched,{status:response.status,statusText:response.statusText,headers});
}

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
    const isAppPage=url.pathname==='/'||url.pathname.endsWith('/index.html');

    if(isAppPage){
      event.respondWith((async()=>{
        try{
          const network=await fetch(freshRequest(req));
          const patched=await patchAppHtml(network);
          if(patched?.ok)await cachePut(APP_SHELL,patched.clone());
          return patched;
        }catch(e){
          const cached=await caches.match(APP_SHELL);
          if(cached)return patchAppHtml(cached);
          throw e;
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
        return (await caches.match(req))||(await caches.match(APP_SHELL))||Response.error();
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
