const CACHE='fibre-ops-v3-production-1.3';
const CORE=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./app-hotfix.js'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

async function patchAppHtml(response){
  if(!response)return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  const tag='<script src="./app-hotfix.js?v=3"></script>';
  const patched=html.includes('app-hotfix.js')?html:html.replace('</body>',tag+'</body>');
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  return new Response(patched,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  if(req.mode==='navigate'){
    const isAppPage=url.pathname==='/'||url.pathname.endsWith('/index.html');
    if(isAppPage){
      event.respondWith(fetch(req).then(async res=>{
        const patched=await patchAppHtml(res);
        const copy=patched.clone();
        caches.open(CACHE).then(cache=>cache.put('./index.html',copy));
        return patched;
      }).catch(async()=>{
        const cached=await caches.match('./index.html');
        return patchAppHtml(cached);
      }));
      return;
    }

    event.respondWith(fetch(req).then(res=>{
      if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
      return res;
    }).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));
    return;
  }

  event.respondWith(fetch(req).then(res=>{
    if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
    return res;
  }).catch(()=>caches.match(req)));
});
