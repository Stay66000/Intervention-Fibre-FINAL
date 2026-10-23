// FIBRE OPS — conformité / confidentialité — module amovible
(function(){
  'use strict';

  const LEGAL_BASE='/legal/';
  let lastAutoDate='';
  let dateTouchedByUser=false;
  let pageBecameVisibleAt=Date.now();
  const originalFetch=window.fetch.bind(window);

  function todayLocal(){
    const d=new Date();
    const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function addLegalLinks(){
    const footer=document.querySelector('.auth-footer');
    if(footer&&!footer.querySelector('.fo-legal-links')){
      const wrap=document.createElement('div');wrap.className='fo-legal-links';
      wrap.innerHTML=`<a href="${LEGAL_BASE}mentions-legales.html" target="_blank" rel="noopener">Mentions légales</a><a href="${LEGAL_BASE}confidentialite.html" target="_blank" rel="noopener">Confidentialité</a><a href="${LEGAL_BASE}cgu.html" target="_blank" rel="noopener">CGU</a><a href="${LEGAL_BASE}cookies.html" target="_blank" rel="noopener">Cookies</a>`;
      footer.appendChild(wrap);
    }

    const signup=document.getElementById('authSignupPane');
    if(signup&&!signup.querySelector('.fo-signup-legal')){
      const p=document.createElement('p');p.className='fo-signup-legal';
      p.innerHTML=`En créant un compte, tu reconnais avoir pris connaissance des <a href="${LEGAL_BASE}cgu.html" target="_blank" rel="noopener">CGU</a> et de la <a href="${LEGAL_BASE}confidentialite.html" target="_blank" rel="noopener">politique de confidentialité</a>.`;
      const submit=document.getElementById('authSignupSubmit');submit?.insertAdjacentElement('afterend',p);
    }
  }

  function addCaptureNotice(){
    const input=document.getElementById('cap-file');
    const field=input?.closest('.field');
    if(!field||field.querySelector('.fo-privacy-note'))return;
    const note=document.createElement('div');note.className='fo-privacy-note';
    note.innerHTML='<b>🔒 Capture temporaire</b> · elle reste consultable pendant la saisie puis est retirée de l’interface après l’enregistrement réussi de l’intervention. Le traitement OCR s’effectue dans ton navigateur.';
    field.appendChild(note);
  }

  function addPrivacySettings(){
    const grid=document.querySelector('#settingsOverlay .settings-grid');
    if(!grid||document.getElementById('foPrivacySettings'))return;
    const block=document.createElement('div');
    block.className='setting-block wide';block.id='foPrivacySettings';
    block.innerHTML=`<h4>🔐 Confidentialité & sécurité</h4><p>Consulte les règles de confidentialité, les conditions d’utilisation et les engagements de sécurité de FIBRE OPS.</p><div class="fo-settings-actions"><a href="${LEGAL_BASE}confidentialite.html" target="_blank" rel="noopener">Confidentialité</a><a href="${LEGAL_BASE}securite.html" target="_blank" rel="noopener">Sécurité</a><a href="${LEGAL_BASE}cgu.html" target="_blank" rel="noopener">CGU</a><a href="${LEGAL_BASE}cookies.html" target="_blank" rel="noopener">Cookies & stockage local</a></div><div class="fo-privacy-status">Aucun accès Platform Admin aux interventions et factures ne doit être prévu dans l’usage courant.</div>`;
    grid.appendChild(block);
  }

  function markDateManual(){dateTouchedByUser=true}
  function syncInterventionDate(force=false){
    const input=document.getElementById('f-date');if(!input)return;
    const today=todayLocal();
    if(!lastAutoDate)lastAutoDate=input.value||today;
    const canUpdate=force||!dateTouchedByUser||!input.value||input.value===lastAutoDate;
    if(canUpdate&&input.value!==today){
      input.value=today;
      input.classList.remove('fo-date-fresh');void input.offsetWidth;input.classList.add('fo-date-fresh');
      try{input.dispatchEvent(new Event('change',{bubbles:true}))}catch{}
    }
    lastAutoDate=today;
  }

  function resetDateAfterSuccessfulSave(){
    dateTouchedByUser=false;
    lastAutoDate='';
    setTimeout(()=>syncInterventionDate(true),120);
  }

  function clearCapturePreview(){
    const img=document.getElementById('cap-img');
    const link=document.getElementById('cap-link');
    const raw=document.getElementById('cap-raw');
    const file=document.getElementById('cap-file');
    if(img){
      const src=img.src;
      if(src&&src.startsWith('blob:')){try{URL.revokeObjectURL(src)}catch{}}
      img.removeAttribute('src');img.style.display='none';
    }
    if(link){link.style.display='none';link.textContent=''}
    if(raw)raw.textContent='';
    if(file)file.value='';
  }

  function isSuccessfulInterventionInsert(url,init,response){
    if(!response?.ok)return false;
    const method=String(init?.method||'GET').toUpperCase();
    return method==='POST'&&url.includes('.supabase.co/rest/v1/interventions')&&!url.includes('/rpc/');
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:String(input?.url||input||'');
    const response=await originalFetch(input,init);
    if(isSuccessfulInterventionInsert(url,init,response)){
      setTimeout(()=>{clearCapturePreview();resetDateAfterSuccessfulSave()},250);
    }
    return response;
  };

  function bindDateProtection(){
    const input=document.getElementById('f-date');
    if(input&&!input.dataset.foDateBound){
      input.dataset.foDateBound='1';
      input.addEventListener('input',markDateManual);
      input.addEventListener('change',e=>{if(e.isTrusted)markDateManual()});
    }
    setTimeout(()=>syncInterventionDate(true),0);
    setTimeout(()=>{if(!dateTouchedByUser)syncInterventionDate(true)},700);
    setTimeout(()=>{if(!dateTouchedByUser)syncInterventionDate(true)},1800);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')return;
    const hiddenFor=Date.now()-pageBecameVisibleAt;
    pageBecameVisibleAt=Date.now();
    if(hiddenFor>45000&&!dateTouchedByUser)syncInterventionDate(true);
  });
  window.addEventListener('pageshow',()=>{pageBecameVisibleAt=Date.now();if(!dateTouchedByUser)syncInterventionDate(true)});
  setInterval(()=>{if(!dateTouchedByUser)syncInterventionDate(false)},60000);

  function init(){addLegalLinks();addCaptureNotice();addPrivacySettings();bindDateProtection()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

  const observer=new MutationObserver(()=>{addLegalLinks();addCaptureNotice();addPrivacySettings();bindDateProtection()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
