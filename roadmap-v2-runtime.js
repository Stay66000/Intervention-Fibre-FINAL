(function(){
  'use strict';
  if(window.FibreRoadmapV2Runtime)return;
  window.FibreRoadmapV2Runtime=true;

  const DB_NAME='fibre_ops_offline_v2',DB_VERSION=1,CONFIG='config';
  function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('queue')){const store=db.createObjectStore('queue',{keyPath:'id'});store.createIndex('createdAt','createdAt')}if(!db.objectStoreNames.contains(CONFIG))db.createObjectStore(CONFIG,{keyPath:'key'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function cacheConfig(){
    try{
      if(typeof user==='undefined'||!user?.id||typeof operators==='undefined'||typeof types==='undefined')return false;
      const db=await openDb();
      await new Promise((resolve,reject)=>{const tx=db.transaction(CONFIG,'readwrite');tx.objectStore(CONFIG).put({key:'current',savedAt:new Date().toISOString(),userId:user.id,companyId:typeof currentCompanyId==='function'?currentCompanyId():null,teamId:typeof team!=='undefined'&&team?.id?team.id:null,operators:(operators||[]).filter(x=>x.active).map(x=>({operator:x.operator,active:true})),types:(types||[]).filter(x=>x.active).map(x=>({id:x.id,operator:x.operator,name:x.name,amount:Number(x.amount||0)})),workMode:typeof form!=='undefined'?form.workMode:'Personal',soloUserId:typeof form!=='undefined'?form.soloUserId:null});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();return true;
    }catch(error){console.warn('[FIBRE OPS ROADMAP V2] offline config cache',error);return false}
  }
  function badge(){
    if(document.getElementById('roadmapV2PreviewBadge'))return;
    const host=document.querySelector('.brand-wrap')||document.querySelector('header.top');if(!host)return;
    const el=document.createElement('span');el.id='roadmapV2PreviewBadge';el.textContent='TEST V2';el.style.cssText='display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border-radius:999px;border:1px solid rgba(53,208,224,.35);background:rgba(53,208,224,.10);color:#6be3f0;font:800 10px/1 system-ui;letter-spacing:.05em;white-space:nowrap';host.appendChild(el);
  }
  function init(){badge();[500,1400,3200,7000].forEach(ms=>setTimeout(cacheConfig,ms));document.addEventListener('click',e=>{if(e.target instanceof Element&&e.target.closest('[data-view="new"],[data-experience-view="new"],#reloadBtn,#f-save,#f-save-next'))setTimeout(cacheConfig,150)});window.addEventListener('online',()=>setTimeout(cacheConfig,300))}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
