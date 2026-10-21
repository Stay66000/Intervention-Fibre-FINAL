from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: attendu 1 occurrence, trouvé {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


index = ROOT / "index.html"

replace_once(
    index,
    """function billingCanUse(){
  if(!user||profile?.role!=='technician')return false;
  if(!currentCompanyId())return true;
  return isCompanyTechnician()&&companyEmploymentType()==='auto';
}""",
    """function billingCanUse(){
  if(!user||!['technician','platform_admin','admin'].includes(profile?.role))return false;
  if(!currentCompanyId())return true;
  return isCompanyTechnician()&&companyEmploymentType()==='auto';
}""",
)

replace_once(
    index,
    """function billingSyncAvailability(){
  const allowed=billingCanUse();
  if($('billingHistoryBtn'))$('billingHistoryBtn').style.display=allowed?'inline-flex':'none';

  if(!allowed && $('view-facturation')?.classList.contains('active')){
    document.querySelector('.tabbar button[data-view=\"historique\"]')?.click();
  }
}""",
    """function billingSyncAvailability(){
  const allowed=billingCanUse();
  if($('billingHistoryBtn'))$('billingHistoryBtn').style.display=allowed?'inline-flex':'none';
  document.body.classList.toggle('billing-solo',allowed);

  if(!allowed && $('view-facturation')?.classList.contains('active')){
    document.querySelector('.tabbar button[data-view=\"historique\"]')?.click();
  }
}""",
)

replace_once(
    index,
    """  document.querySelectorAll('.tabbar button').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-facturation'));""",
    """  document.querySelectorAll('.tabbar button').forEach(x=>x.classList.toggle('active',x.dataset.view==='historique'));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-facturation'));""",
)

replace_once(
    index,
    """if('serviceWorker' in navigator&&['http:','https:'].includes(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Service worker:',e)));""",
    """if('serviceWorker' in navigator&&['http:','https:'].includes(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(e=>console.warn('Service worker:',e)));""",
)

text = index.read_text(encoding="utf-8")
version_count = text.count("V3 Production 1.1")
if version_count != 2:
    raise RuntimeError(f"index.html: attendu 2 occurrences de version, trouvé {version_count}")
index.write_text(text.replace("V3 Production 1.1", "V3 Production 1.2"), encoding="utf-8")

sw = """const CACHE='fibre-ops-v3-production-1.5';
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
"""
(ROOT / "sw.js").write_text(sw, encoding="utf-8")

headers = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: no-cache
"""
(ROOT / "_headers").write_text(headers, encoding="utf-8")

hotfix = ROOT / "app-hotfix.js"
if not hotfix.exists():
    raise RuntimeError("app-hotfix.js introuvable avant migration")
hotfix.unlink()

# Cette migration est volontairement jetable : le commit final ne conserve
# ni le script ni le workflow qui l'a exécutée.
for rel in ["scripts/migrate_pwa_cleanup.py", ".github/workflows/pwa-cleanup.yml"]:
    p = ROOT / rel
    if p.exists():
        p.unlink()

print("Migration PWA appliquée avec succès")
