(function(){
  'use strict';
  if(window.FibreOfflineV2)return;

  const DB_NAME='fibre_ops_offline_v2';
  const DB_VERSION=1;
  const QUEUE='queue';
  const CONFIG='config';
  let flushing=false;
  let legacySave=null;
  let queueStatusShown=false;

  const $id=id=>document.getElementById(id);
  function notify(msg){try{if(typeof toast==='function')return toast(msg)}catch{}console.info('[FIBRE OPS OFFLINE]',msg)}
  function human(error){return String(error?.message||error||'Erreur').slice(0,220)}
  function uid(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`}

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(QUEUE)){
          const store=db.createObjectStore(QUEUE,{keyPath:'id'});
          store.createIndex('createdAt','createdAt');
        }
        if(!db.objectStoreNames.contains(CONFIG))db.createObjectStore(CONFIG,{keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB indisponible'));
    });
  }
  async function tx(storeName,mode,runner){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const t=db.transaction(storeName,mode),store=t.objectStore(storeName);
      let value;
      try{value=runner(store,t)}catch(error){db.close();reject(error);return}
      t.oncomplete=()=>{db.close();resolve(value)};
      t.onerror=()=>{db.close();reject(t.error||new Error('Erreur stockage local'))};
      t.onabort=()=>{db.close();reject(t.error||new Error('Stockage local annulé'))};
    });
  }
  async function putQueue(item){return tx(QUEUE,'readwrite',store=>store.put(item))}
  async function deleteQueue(id){return tx(QUEUE,'readwrite',store=>store.delete(id))}
  async function allQueue(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const t=db.transaction(QUEUE,'readonly'),req=t.objectStore(QUEUE).getAll();
      req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))));
      req.onerror=()=>reject(req.error);
      t.oncomplete=()=>db.close();
    });
  }
  async function saveConfig(){
    try{
      if(typeof user==='undefined'||!user?.id)return;
      const snapshot={
        key:'current',
        savedAt:new Date().toISOString(),
        userId:user.id,
        companyId:typeof currentCompanyId==='function'?currentCompanyId():null,
        teamId:typeof team!=='undefined'&&team?.id?team.id:null,
        operators:typeof operators!=='undefined'?(operators||[]).filter(x=>x.active).map(x=>({operator:x.operator,active:true})):[],
        types:typeof types!=='undefined'?(types||[]).filter(x=>x.active).map(x=>({id:x.id,operator:x.operator,name:x.name,amount:Number(x.amount||0)})):[],
        workMode:typeof form!=='undefined'?form.workMode:'Personal',
        soloUserId:typeof form!=='undefined'?form.soloUserId:null
      };
      await tx(CONFIG,'readwrite',store=>store.put(snapshot));
    }catch(error){console.warn('[FIBRE OPS OFFLINE] config cache',error)}
  }

  function isOffline(){return navigator.onLine===false}
  function selectedTypeSafe(){try{return typeof selectedType==='function'?selectedType():null}catch{return null}}
  function hasTeamSafe(){try{return typeof hasTeam==='function'&&hasTeam()}catch{return false}}
  function isCompanyTechSafe(){try{return typeof isCompanyTechnician==='function'&&isCompanyTechnician()}catch{return false}}
  function currentCompanySafe(){try{return typeof currentCompanyId==='function'?currentCompanyId():null}catch{return null}}

  async function buildQueuedIntervention(continueEntry){
    const date=$id('f-date')?.value||'';
    const reference=$id('f-num')?.value?.trim()||'';
    const address=$id('f-addr')?.value?.trim()||'';
    const notes=$id('f-comment')?.value?.trim()||'';
    const t=selectedTypeSafe();
    const supplement=typeof readInterventionSupplement==='function'?readInterventionSupplement('f'):{enabled:false,amount:0,comment:''};
    if(supplement.enabled&&(!(supplement.amount>0)||supplement.amount>10000))throw new Error('Indique un montant de complément entre 0,01 € et 10 000 €');
    if(!date||!form?.operator||!t)throw new Error('Date, opérateur et typologie obligatoires');
    if(hasTeamSafe()&&form.workMode==='Solo'&&!form.soloUserId)throw new Error('Choisis le technicien en Solo');

    const queued=await allQueue();
    const duplicateOnline=(typeof interventions!=='undefined'?(interventions||[]):[]).some(e=>e.num&&reference&&e.num===reference&&e.op===form.operator);
    const duplicateQueue=queued.some(e=>e.payload?.reference&&reference&&e.payload.reference===reference&&e.payload.operator===form.operator);
    if((duplicateOnline||duplicateQueue)&&!confirm('Cette référence existe déjà ou attend déjà la synchro. L’ajouter quand même ?'))return null;

    const id=uid();
    const operatorData=typeof mergeSupplementOperatorData==='function'?mergeSupplementOperatorData({},supplement):{};
    operatorData.offline_event_id=id;
    const payload={
      id,
      user_id:user.id,
      company_id:isCompanyTechSafe()?currentCompanySafe():null,
      team_id:hasTeamSafe()&&typeof team!=='undefined'?team?.id||null:null,
      work_mode:hasTeamSafe()?form.workMode:'Personal',
      solo_user_id:hasTeamSafe()&&form.workMode==='Solo'?form.soloUserId:user.id,
      intervention_date:date,
      operator:form.operator,
      intervention_type_id:t.id,
      result:form.result,
      reference:reference||null,
      address:address||null,
      notes:notes||null,
      operator_data:operatorData,
      client_event_id:id
    };
    return {id,payload,continueEntry:!!continueEntry,createdAt:new Date().toISOString(),attempts:0,lastError:null};
  }

  function resetEntryAfterQueue(continueEntry,retained){
    try{
      if($id('f-num'))$id('f-num').value='';
      if($id('f-addr'))$id('f-addr').value='';
      if($id('f-comment'))$id('f-comment').value='';
      if(typeof clearSupplementInputs==='function')clearSupplementInputs('f');
      if($id('f-typo'))$id('f-typo').value='';
      form.typeId='';
      if(typeof draftKey==='function')localStorage.removeItem(draftKey());
      if(continueEntry&&retained){
        Object.assign(form,retained);
        if(typeof populateOperatorUI==='function')populateOperatorUI();
        if(typeof setSeg==='function'){
          setSeg('f-statut',form.result);
          setSeg('f-work-mode',form.workMode);
        }
        if(typeof toggleSoloFields==='function')toggleSoloFields();
      }
      if(typeof preview==='function')preview();
      if(continueEntry&&typeof saveDraft==='function')saveDraft();
      $id('f-num')?.focus();
    }catch(error){console.warn('[FIBRE OPS OFFLINE] reset',error)}
  }

  async function queueCurrent(continueEntry=false){
    const retained=typeof form!=='undefined'?{...form}:null;
    const item=await buildQueuedIntervention(continueEntry);
    if(!item)return false;
    if(window.FibrePhotos?.hasPending?.()&&!window.FibrePhotos?.offlineSelection)throw new Error('Impossible de conserver les photos sur cet appareil');
    const photos=window.FibrePhotos?.offlineSelection?.()||[];
    item.photos=photos;
    await putQueue(item);
    if(photos.length)window.FibrePhotos.offlineQueued(photos);
    resetEntryAfterQueue(continueEntry,retained);
    try{window.FibreExperience?.entryStatus('Hors ligne · intervention et photos conservées sur cet appareil, en attente de synchronisation.','success')}catch{}
    notify('📡 Hors ligne · intervention et photos mises en attente');
    await refreshUi();
    return true;
  }

  async function flushQueue(manual=false){
    if(flushing||isOffline())return;
    const sb=typeof supabase!=='undefined'?supabase:window.supabase;
    const accountId=typeof user!=='undefined'?user?.id:null;
    if(!accountId||!sb||typeof sb.from!=='function')return;
    const items=(await allQueue()).filter(item=>item.payload?.user_id===accountId);
    if(!items.length){await refreshUi();return}
    flushing=true;
    setBadge('syncing',`${items.length} à synchroniser`);
    let done=0,failed=0,lastFailure='';
    try{
      for(const item of items){
        try{
          if(user?.id!==accountId)break;
          const {error}=await sb.from('interventions').insert(item.payload);
          let interventionId=item.payload.id;
          if(error){
            if((error.code||error.details?.code)!=='23505')throw error;
            const existing=await sb.rpc('photo_test_find_my_intervention',{p_event_id:item.id,p_intervention_id:item.payload.id||null});
            if(existing.error)throw new Error('Vérification du dossier impossible : '+human(existing.error));
            if(!existing.data)throw new Error('Le dossier déjà créé ne peut pas être confirmé pour ce compte.');
            interventionId=existing.data;
          }
          if(item.payload.id&&!item.testRegistered){
            if(!interventionId||interventionId!==item.payload.id||typeof sb.rpc!=='function')throw new Error('Impossible de confirmer le dossier de test');
            const registration=await sb.rpc('photo_test_register_intervention',{p_intervention_id:interventionId});
            if(registration.error||registration.data!==true)throw new Error('Dossier de test non enregistré');
            item.testRegistered=true;
            await putQueue(item);
          }
          if(item.photos?.length){
            if(!interventionId||interventionId!==item.payload.id)throw new Error('Impossible de confirmer le dossier des photos');
            if(!window.FibrePhotos?.uploadQueued)throw new Error('Module photo indisponible');
            while(item.photos.length){
              if(user?.id!==accountId)throw new Error('La session a changé');
              await window.FibrePhotos.uploadQueued(interventionId,item.photos[0],accountId);
              item.photos.shift();
              await putQueue(item);
            }
          }
          await deleteQueue(item.id);
          done++;
        }catch(error){
          failed++;
          item.attempts=Number(item.attempts||0)+1;
          item.lastError=human(error);
          lastFailure=item.lastError;
          await putQueue(item);
          console.warn('[FIBRE OPS OFFLINE] sync failed',item.id,error);
          if(/fetch|network|connexion|offline/i.test(item.lastError))break;
        }
      }
      if(done){
        try{await loadAll();renderAll()}catch(error){console.warn('[FIBRE OPS OFFLINE] refresh after sync',error)}
        notify(`✅ ${done} intervention${done>1?'s':''} hors ligne synchronisée${done>1?'s':''}`);
      }else if(manual&&failed){notify('Synchronisation en attente : '+lastFailure)}
    }finally{
      flushing=false;
      await refreshUi();
    }
  }

  function ensureUi(){
    if(!$id('offlineQueueCard')){
      const save=$id('f-save');
      const host=save?.closest('.card')||save?.parentElement;
      if(host&&save){
        const box=document.createElement('div');
        box.id='offlineQueueCard';
        box.className='offline-v2-card';
        box.innerHTML=`<div><b id="offlineQueueTitle">📡 Mode réseau</b><small id="offlineQueueText">Les interventions sont envoyées directement à FIBRE OPS.</small></div><button type="button" class="btn-ghost" id="offlineQueueSync" style="display:none">Synchroniser</button>`;
        const anchor=save.closest('.experience-save-actions')||save;
        if(anchor.parentElement===host)host.insertBefore(box,anchor);
        else save.parentElement.insertBefore(box,save);
        $id('offlineQueueSync').onclick=()=>flushQueue(true);
      }
    }
    if(!$id('offlineHeaderBadge')){
      const host=document.querySelector('.header-actions');
      if(host){
        const badge=document.createElement('button');
        badge.id='offlineHeaderBadge';
        badge.type='button';
        badge.className='offline-v2-header';
        badge.style.display='none';
        badge.onclick=()=>flushQueue(true);
        host.prepend(badge);
      }
    }
  }
  function setBadge(state,text){
    ensureUi();
    const badge=$id('offlineHeaderBadge');
    if(!badge)return;
    badge.dataset.state=state;
    badge.textContent=state==='offline'?`📡 ${text}`:state==='syncing'?`↻ ${text}`:`✓ ${text}`;
    badge.style.display='inline-flex';
  }
  async function refreshUi(){
    ensureUi();
    const accountId=typeof user!=='undefined'?user?.id:null;
    const waiting=(await allQueue()).filter(item=>accountId&&item.payload?.user_id===accountId);
    const count=waiting.length;
    const title=$id('offlineQueueTitle'),text=$id('offlineQueueText'),sync=$id('offlineQueueSync'),badge=$id('offlineHeaderBadge');
    if(isOffline()){
      if(title)title.textContent='📡 Hors ligne';
      if(text)text.textContent=count?`${count} intervention${count>1?'s':''} et leurs éventuelles photos en attente sur cet appareil.`:'Les nouvelles interventions et photos seront conservées sur cet appareil puis synchronisées à la reconnexion.';
      if(sync)sync.style.display='none';
      setBadge('offline',count?`${count} en attente`:'hors ligne');
      return;
    }
    if(count){
      if(typeof updateStatus==='function'){updateStatus('En attente',true);queueStatusShown=true}
      if(title)title.textContent='↻ Synchronisation en attente';
      if(text)text.textContent=waiting[0].lastError?`En attente : ${waiting[0].lastError}`:`${count} intervention${count>1?'s':''} et leurs éventuelles photos en attente de synchronisation.`;
      if(sync){sync.style.display='inline-flex';sync.textContent='Synchroniser maintenant'}
      setBadge('syncing',`${count} en attente`);
    }else{
      if(queueStatusShown&&typeof updateStatus==='function'){updateStatus('Synchronisé');queueStatusShown=false}
      if(title)title.textContent='☁️ En ligne';
      if(text)text.textContent='Les interventions sont envoyées directement à FIBRE OPS. En cas de coupure, elles seront mises en attente automatiquement.';
      if(sync)sync.style.display='none';
      if(badge)badge.style.display='none';
    }
  }

  function patchSave(){
    if(typeof saveIntervention!=='function'||saveIntervention.__offlineV2)return;
    legacySave=saveIntervention;
    const wrapped=async function(continueEntry=false){
      if(isOffline()){
        try{return await queueCurrent(continueEntry)}catch(error){notify('Erreur hors ligne : '+human(error));return false}
      }
      if((await allQueue()).length)flushQueue(false);
      return legacySave(continueEntry);
    };
    wrapped.__offlineV2=true;
    saveIntervention=wrapped;
  }

  async function init(){
    ensureUi();
    patchSave();
    await saveConfig();
    await refreshUi();
    if(!isOffline())setTimeout(()=>flushQueue(false),800);
    window.addEventListener('online',()=>{refreshUi();setTimeout(()=>flushQueue(false),250)});
    window.addEventListener('offline',()=>refreshUi());
    document.addEventListener('click',e=>{
      const el=e.target instanceof Element?e.target.closest('[data-view="new"],[data-experience-view="new"],#reloadBtn'):null;
      if(el)setTimeout(()=>{patchSave();saveConfig();refreshUi()},120);
    });
  }

  window.FibreOfflineV2={flush:()=>flushQueue(true),count:async()=>(await allQueue()).length,refresh:refreshUi};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
