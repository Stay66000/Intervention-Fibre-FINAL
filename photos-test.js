(function(){'use strict';let current='',version=0,urls=[],productionMode=false;let gallery=[],viewerIndex=0,viewerTicket=0,touchStart=null,bulkReady=[],bulkKey='',bulkBusy=false;const byId=id=>document.getElementById(id);
function cleanup(){urls.forEach(URL.revokeObjectURL);urls=[]}
async function api(params,options={}){const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw Error('Reconnecte-toi.');const res=await fetch('/api/photos?'+new URLSearchParams(params),{...options,cache:'no-store',headers:{...(options.headers||{}),Authorization:'Bearer '+session.access_token}});if(!res.ok){const body=await res.json().catch(()=>({}));throw Error(body.error||'Erreur de connexion')}return res}
async function checkAccess(){const res=await api({access:'1'});const data=await res.json();productionMode=data.mode==='production';if(productionMode&&byId('photosTest'))byId('photosTest').querySelector('p').textContent='Photos originales · sauvegarde principale et secours · 25 Mo maximum par photo';if(data.enabled!==true)throw Error('Fonction indisponible');return productionMode}
function mount(){
  if(byId('photosTest'))return;
  const wrap=document.createElement('section');
  wrap.id='photosTest';wrap.hidden=true;
  wrap.innerHTML='<h3>📸 Photos du dossier</h3><p>Version test : photos séparées du site principal · fichiers originaux · 25 Mo maximum par photo</p><label class="btn-ghost photo-add">＋ Ajouter des photos<input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden></label><button type="button" class="btn-ghost photo-all" id="photoDownloadAll" hidden>⬇️ Télécharger toutes les photos</button><p id="photoStatus" role="status" aria-live="polite"></p><div id="photoList"></div><dialog id="photoViewer" aria-label="Visionneuse de photos"><button type="button" aria-label="Fermer la visionneuse" id="photoClose">×</button><div class="photo-viewer-stage"><button type="button" class="photo-nav" id="photoPrev" aria-label="Photo précédente">‹</button><img alt="Photo de l’intervention"><button type="button" class="photo-nav" id="photoNext" aria-label="Photo suivante">›</button></div><div id="photoCounter" aria-live="polite"></div><a id="photoDownload" class="btn-ghost" download>Télécharger cette photo</a></dialog>';
  byId('m-save-btn').parentNode.before(wrap);
  const dlg=byId('photoViewer');
  byId('photoClose').onclick=()=>dlg.close();
  dlg.onclose=()=>{viewerTicket++;dlg.querySelector('img').removeAttribute('src');cleanup()};
  byId('photoPrev').onclick=()=>showViewer(viewerIndex-1);
  byId('photoNext').onclick=()=>showViewer(viewerIndex+1);
  const img=dlg.querySelector('img');
  img.addEventListener('touchstart',e=>{if(e.touches.length===1)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
  img.addEventListener('touchend',e=>{
    if(!touchStart||!e.changedTouches.length)return;
    const dx=e.changedTouches[0].clientX-touchStart.x,dy=e.changedTouches[0].clientY-touchStart.y;touchStart=null;
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)showViewer(viewerIndex+(dx<0?1:-1));
  },{passive:true});
  document.addEventListener('keydown',e=>{
    if(!dlg.open||gallery.length<2)return;
    if(e.key==='ArrowLeft'){e.preventDefault();showViewer(viewerIndex-1)}
    if(e.key==='ArrowRight'){e.preventDefault();showViewer(viewerIndex+1)}
  });
  byId('photoFiles').onchange=upload;
  byId('photoList').onclick=actions;
  byId('photoDownloadAll').onclick=downloadAll;
}
async function open(row){
  mount();const token=++version;
  const dlg=byId('photoViewer');if(dlg.open)dlg.close();
  viewerTicket++;current=row.id;gallery=[];resetBulk();cleanup();
  const box=byId('photosTest');box.hidden=true;byId('photoList').replaceChildren();
  try{
    await checkAccess();if(token!==version)return;
    const res=await api({intervention:row.id});if(token!==version)return;
    box.hidden=false;render((await res.json()).files);byId('photoStatus').textContent='';
  }catch(err){
    if(token===version&&err.message!=='Fonction indisponible'&&err.message!=='Dossier inaccessible'){
      box.hidden=false;byId('photoStatus').textContent=err.message;
    }
  }
}
function resetBulk(){
  bulkReady=[];bulkKey='';bulkBusy=false;const btn=byId('photoDownloadAll');
  if(btn){btn.disabled=false;btn.textContent='⬇️ Télécharger toutes les photos'}
}
function render(files){
  gallery=Array.isArray(files)?files.slice():[];
  resetBulk();
  const btn=byId('photoDownloadAll');if(btn)btn.hidden=!gallery.length;
  const list=byId('photoList');list.replaceChildren();
  if(!gallery.length){list.textContent='Aucune photo pour ce dossier.';return}
  gallery.forEach((file,i)=>{
    const el=document.createElement('div');el.className='photo-row';
    const name=document.createElement('span');name.textContent=file.name||'Photo '+(i+1);
    const view=document.createElement('button');view.type='button';view.className='btn-ghost';
    view.textContent='Voir';view.dataset.view=file.id;view.dataset.name=file.name;
    const del=document.createElement('button');del.type='button';del.className='btn-ghost';
    del.textContent='Supprimer';del.dataset.remove=file.id;
    el.append(name,view,del);list.append(el);
  });
}
async function refresh(id){const r=await api({intervention:id});if(id===current)render((await r.json()).files)}
async function upload(e){const files=[...e.target.files],id=current,token=version;if(!files.length)return;let good=0,failed=[];e.target.disabled=true;for(const [i,file] of files.entries()){if(token!==version)break;byId('photoStatus').textContent=`Envoi ${i+1}/${files.length} : ${file.name}…`;try{await api({intervention:id,photo:crypto.randomUUID(),name:file.name},{method:'PUT',headers:{'content-type':file.type},body:file});good++}catch(err){failed.push(file.name+' : '+err.message)}}if(token===version){try{await refresh(id)}catch{}byId('photoStatus').textContent=failed.length?`${good} photo(s) sauvegardée(s). Échec : ${failed.join(' ; ')}. Sélectionne-les à nouveau pour réessayer.`:good===files.length?'Toutes les photos sont sauvegardées ✓':`${good} photo(s) sauvegardée(s).`;e.target.value=''}e.target.disabled=false}
async function showViewer(target){
  const dlg=byId('photoViewer');
  if(!gallery.length||!dlg?.open)return;
  viewerIndex=((target%gallery.length)+gallery.length)%gallery.length;
  const seq=++viewerTicket,id=current,file=gallery[viewerIndex];
  const img=dlg.querySelector('img');
  img.removeAttribute('src');
  byId('photoCounter').textContent=(viewerIndex+1)+' / '+gallery.length+' · Chargement…';
  byId('photoPrev').disabled=gallery.length<2;
  byId('photoNext').disabled=gallery.length<2;
  byId('photoDownload').removeAttribute('href');
  try{
    const res=await api({intervention:id,photo:file.id});
    const blob=await res.blob();
    if(seq!==viewerTicket||id!==current||!dlg.open)return;
    cleanup();
    const url=URL.createObjectURL(blob);urls.push(url);
    img.src=url;img.alt=file.name||'Photo '+(viewerIndex+1);
    const link=byId('photoDownload');
    link.href=url;link.download=file.name||'photo';
    byId('photoCounter').textContent=(viewerIndex+1)+' / '+gallery.length;
  }catch(error){
    if(seq===viewerTicket&&dlg.open)byId('photoCounter').textContent='Photo indisponible : '+(error.message||'réessaie');
  }
}
function canShareAll(files){
  return typeof navigator.share==='function' &&
    typeof navigator.canShare==='function' &&
    navigator.canShare({files});
}
async function downloadAll(){
  const btn=byId('photoDownloadAll'),status=byId('photoStatus');
  if(bulkBusy||!gallery.length)return;
  const key=current+'|'+version;
  if(bulkReady.length&&bulkKey===key){
    if(canShareAll(bulkReady)){
      // Called directly from the second user click: iOS requires fresh user activation.
      try{
        await navigator.share({files:bulkReady,title:'Photos du dossier'});
        status.textContent='Photos transmises au partage. Tu peux les enregistrer dans Photos ou Fichiers.';
      }catch(error){
        status.textContent=error?.name==='AbortError'?'Partage annulé. Les photos restent prêtes.':
          'Partage impossible : '+(error?.message||'réessaie')+'. Tu peux télécharger chaque photo dans la visionneuse.';
      }
      return;
    }
    // Browsers without multi-file sharing: request separate original downloads, never ZIP.
    const links=[];
    for(const file of bulkReady){
      const url=URL.createObjectURL(file);links.push(url);
      const a=document.createElement('a');a.href=url;a.download=file.name;
      a.style.display='none';document.body.append(a);a.click();a.remove();
    }
    setTimeout(()=>links.forEach(url=>URL.revokeObjectURL(url)),120000);
    status.textContent='Téléchargements individuels demandés ('+bulkReady.length+'). Le navigateur peut te demander de les autoriser. Sinon, utilise le téléchargement photo par photo.';
    return;
  }
  const id=current,token=version,account=user?.id,files=gallery.slice();
  bulkBusy=true;btn.disabled=true;status.textContent='Préparation des '+files.length+' photos…';
  try{
    const prepared=[];
    for(let i=0;i<files.length;i++){
      if(current!==id||version!==token||user?.id!==account)throw Error('Le dossier ou la session a changé.');
      status.textContent='Préparation des photos originales : '+(i+1)+' / '+files.length+'…';
      const res=await api({intervention:id,photo:files[i].id});
      const blob=await res.blob();
      if(current!==id||version!==token||user?.id!==account)throw Error('Le dossier ou la session a changé.');
      const name=String(files[i].name||'photo').replace(/[\/\\:*?"<>|]/g,'_').slice(0,100);
      const numbered=String(i+1).padStart(3,'0')+'_'+name;
      prepared.push(new File([blob],numbered,{type:blob.type||'application/octet-stream'}));
    }
    bulkReady=prepared;bulkKey=key;
    btn.textContent=canShareAll(prepared)?'📲 Enregistrer les '+prepared.length+' photos':'⬇️ Télécharger les '+prepared.length+' fichiers';
    status.textContent=canShareAll(prepared)?
      'Photos prêtes. Appuie sur « Enregistrer les photos », puis choisis Photos ou Fichiers dans le partage iPhone. Aucun ZIP.':
      'Photos prêtes. Appuie sur « Télécharger les fichiers » : ils resteront séparés, sans ZIP.';
  }catch(error){
    if(current===id&&version===token){bulkReady=[];bulkKey='';btn.textContent='⬇️ Télécharger toutes les photos';status.textContent='Préparation interrompue : '+(error.message||'réessaie')+'. Aucune photo n’a été modifiée.'}
  }finally{
    if(current===id&&version===token){bulkBusy=false;btn.disabled=false}
  }
}
async function actions(e){
  const button=e.target.closest('button');if(!button)return;
  const id=current;button.disabled=true;
  try{
    if(button.dataset.remove){
      if(!confirm('Supprimer cette photo ?'))return;
      const removed=await api({intervention:id,photo:button.dataset.remove},{method:'DELETE'});
      const result=await removed.json();
      await refresh(id);
      byId('photoStatus').textContent=result.queued?'Suppression enregistrée, nettoyage des copies en attente.':'Photo supprimée.';
    }else if(button.dataset.view){
      const dlg=byId('photoViewer');
      if(!dlg.open)dlg.showModal();
      const position=gallery.findIndex(file=>file.id===button.dataset.view);
      await showViewer(position<0?0:position);
    }
  }catch(err){
    byId('photoStatus').textContent=err.message;
  }finally{button.disabled=false}
}
let pending=[],pendingIntervention='',pendingEvent='',owner='',ready=false,mounting=false;
const accessKey=id=>'fibre-ops-photo-access:'+id;
function cachedAccess(id){try{return localStorage.getItem(accessKey(id))==='yes'}catch{return false}}
function rememberAccess(id,allowed){try{localStorage.setItem(accessKey(id),allowed?'yes':'no')}catch{}}
function entryStatus(text){const el=byId('photoEntryStatus');if(el)el.textContent=text}
async function mountEntry(){if(!user?.id||mounting||ready&&owner===user.id)return;if(owner&&owner!==user.id){pending=[];pendingIntervention='';pendingEvent=''}ready=false;mounting=true;owner=user.id;const old=byId('photoEntry');if(old)old.remove();try{if(navigator.onLine===false){if(!cachedAccess(owner))return}else{try{await checkAccess();rememberAccess(owner,true)}catch(error){if(error.message==='Fonction indisponible')rememberAccess(owner,false);throw error}}if(!user?.id||user.id!==owner)return;const box=document.createElement('section');box.id='photoEntry';box.className='photo-entry';box.innerHTML='<h3>📸 Photos du dossier</h3><p>En ligne, attends la confirmation de l’envoi. Hors ligne, les photos sont conservées sur cet appareil jusqu’à la synchronisation.</p><label class="btn-ghost photo-add">＋ Choisir des photos<input id="photoEntryFiles" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden></label><button type="button" class="btn-ghost" id="photoEntryClear">Retirer les photos sélectionnées</button><button type="button" class="btn-ghost" id="photoEntryRetry" hidden>Réessayer les photos en attente</button><p id="photoEntryStatus" role="status" aria-live="polite"></p>';byId('f-save').parentNode.before(box);byId('photoEntryFiles').onchange=e=>{if(pendingIntervention||pendingEvent){entryStatus('Termine d’abord l’envoi des photos en attente.');e.target.value='';return}const accepted=[...e.target.files].filter(f=>['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(f.type)&&f.size<=25*1024*1024&&f.size>0);pending.push(...accepted.map(file=>({file,id:crypto.randomUUID()})));entryStatus(`${pending.length} photo(s) sélectionnée(s). ${accepted.length<e.target.files.length?'Certains fichiers ont été refusés : photos uniquement, 25 Mo maximum.':''}`);e.target.value=''};byId('photoEntryClear').onclick=()=>{if(pendingEvent){entryStatus('Ces photos appartiennent à une intervention déjà enregistrée : réessaie leur envoi.');return}pending=[];entryStatus('Sélection de photos retirée.')};byId('photoEntryRetry').onclick=async()=>{await sendEntry(pendingEvent)};ready=true}catch{}finally{mounting=false}}
async function sendPending(){if(!pendingIntervention||!pending.length)return false;const retry=byId('photoEntryRetry');retry.disabled=true;let remaining=[],failures=[],account=owner;for(let i=0;i<pending.length;i++){const item=pending[i];if(user?.id!==account){remaining.push(...pending.slice(i));failures.push('La session a changé');break;}entryStatus(`Envoi ${i+1}/${pending.length} : ${item.file.name}…`);try{await api({intervention:pendingIntervention,photo:item.id,name:item.file.name},{method:'PUT',headers:{'content-type':item.file.type},body:item.file})}catch(error){remaining.push(item);failures.push(item.file.name+' : '+(error.message||'erreur d’envoi'))}}pending=remaining;retry.disabled=false;retry.hidden=!remaining.length;if(remaining.length){entryStatus(`${remaining.length} photo(s) non sauvegardée(s) : ${failures.join(' ; ')}. Garde cette page ouverte et réessaie.`)}else{entryStatus('Toutes les photos sont sauvegardées ✓');pendingIntervention='';pendingEvent=''}return remaining.length===0}
async function sendEntry(eventId){if(!pending.length)return true;if(pendingEvent&&pendingEvent!==eventId){entryStatus('Les photos de l’intervention précédente sont encore en attente : réessaie leur envoi.');return false}pendingEvent=eventId;if(pendingIntervention){return await sendPending()}try{const result=await supabase.rpc(productionMode?'photo_find_my_intervention':'photo_test_find_my_intervention',{p_event_id:eventId,p_intervention_id:eventId});if(result.error||result.data!==eventId){entryStatus('Intervention enregistrée, mais ses photos sont encore en attente. Ne ferme pas cette page.');byId('photoEntryRetry').hidden=false;return false}pendingIntervention=result.data;return await sendPending()}catch{entryStatus('Intervention enregistrée, mais ses photos sont encore en attente. Ne ferme pas cette page.');byId('photoEntryRetry').hidden=false;return false}}
window.addEventListener('beforeunload',event=>{if(pending.length){event.preventDefault();event.returnValue='';}});document.addEventListener('click',()=>{if(typeof user!=='undefined'&&user?.id)mountEntry()});
window.FibrePhotos={open,sendEntry,isProduction:()=>productionMode,refreshMode:checkAccess,hasPending:()=>pending.length>0,offlineSelection:()=>{if(!pending.length)return [];if(owner!==user?.id||pendingIntervention||pendingEvent)throw Error('Termine d’abord l’envoi des photos en attente');return pending.map(item=>({id:item.id,name:item.file.name,type:item.file.type,blob:item.file}))},offlineQueued:items=>{const ids=new Set(items.map(item=>item.id));pending=pending.filter(item=>!ids.has(item.id));entryStatus('Photos conservées sur cet appareil, en attente de synchronisation.')},uploadQueued:async(intervention,item,account)=>{const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token||user?.id!==account)throw Error('Reconnecte-toi avec le compte qui a créé le dossier.');let sessionUser=session.user;if(!sessionUser?.id&&typeof supabase.auth.getUser==='function'){const verified=await supabase.auth.getUser();if(verified.error)throw Error('Vérification de la session impossible.');sessionUser=verified.data?.user}if(sessionUser?.id!==account||user?.id!==account)throw Error('Reconnecte-toi avec le compte qui a créé le dossier.');const res=await fetch('/api/photos?'+new URLSearchParams({intervention,photo:item.id,name:item.name}),{method:'PUT',cache:'no-store',headers:{'content-type':item.type,Authorization:'Bearer '+session.access_token},body:item.blob});if(!res.ok){const body=await res.json().catch(()=>({}));throw Error(body.error||'Envoi photo impossible')}},offlineBlocked:()=>entryStatus('Photos en attente de synchronisation.')};const originalOpenEdit=window.openEdit;if(typeof originalOpenEdit==='function')window.openEdit=function(id){originalOpenEdit(id);const row=interventions.find(item=>item.id===id);if(row)open(row)};})();
