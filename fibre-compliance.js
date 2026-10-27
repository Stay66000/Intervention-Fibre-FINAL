// FIBRE OPS — conformité / confidentialité — module amovible
(function(){
  'use strict';

  const LEGAL_BASE='/legal/';
  let lastAutoDate='';
  let dateTouchedByUser=false;
  let pageBecameVisibleAt=Date.now();
  let settingsHubOpen=false;
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

  function createSettingsHub(){
    if(document.getElementById('foSettingsPage'))return;

    const page=document.createElement('section');
    page.id='foSettingsPage';
    page.className='fo-settings-page';
    page.setAttribute('aria-hidden','true');
    page.innerHTML=`
      <div class="fo-settings-page-shell">
        <header class="fo-settings-page-head">
          <button class="btn-ghost fo-settings-back" id="foSettingsBack" type="button">← Retour</button>
          <div>
            <div class="fo-settings-page-title">Réglages avancés</div>
            <div class="fo-settings-page-sub">Compte, organisation, données et confidentialité</div>
          </div>
        </header>
        <main class="fo-settings-page-content">
          <section class="fo-settings-section"><div class="fo-settings-section-head"><span>👤</span><div><h2>Compte & organisation</h2><p>Société, invitations, binôme et accès.</p></div></div><div class="fo-settings-section-grid" id="foSettingsAccount"></div></section>
          <section class="fo-settings-section"><div class="fo-settings-section-head"><span>📱</span><div><h2>Application</h2><p>Installation, version et réglages de fonctionnement.</p></div></div><div class="fo-settings-section-grid" id="foSettingsApp"></div></section>
          <section class="fo-settings-section"><div class="fo-settings-section-head"><span>💾</span><div><h2>Données & maintenance</h2><p>Sauvegarde locale et outils de maintenance.</p></div></div><div class="fo-settings-section-grid" id="foSettingsData"></div></section>
          <section class="fo-settings-section"><div class="fo-settings-section-head"><span>🔐</span><div><h2>Sécurité & confidentialité</h2><p>Protection du compte et documents juridiques.</p></div></div><div class="fo-settings-section-grid" id="foSettingsPrivacy"></div></section>
          <section class="fo-settings-section admin-only" id="foSettingsAdminSection"><div class="fo-settings-section-head"><span>🛡️</span><div><h2>Administration</h2><p>Outils réservés à l’administration FIBRE OPS.</p></div></div><div class="fo-settings-section-grid" id="foSettingsAdmin"></div></section>
        </main>
      </div>`;
    document.body.appendChild(page);

    document.getElementById('foSettingsBack')?.addEventListener('click',()=>closeSettingsHub(true));
    page.addEventListener('click',e=>{if(e.target===page)closeSettingsHub(true)});
  }

  function settingsHeading(block){
    return String(block?.querySelector('h4')?.textContent||'').trim().toLowerCase();
  }

  function settingsTarget(block){
    const h=settingsHeading(block);
    if(block.id==='adminBlock'||h.includes('administration'))return 'foSettingsAdmin';
    if(block.id==='installAppBlock'||h.includes('installer')||h.includes('version')||h.includes('objectif'))return 'foSettingsApp';
    if(h.includes('sauvegarde')||h.includes('brouillon'))return 'foSettingsData';
    if(block.id==='foPrivacySettings'||h.includes('confidentialité')||h.includes('sécurité'))return 'foSettingsPrivacy';
    return 'foSettingsAccount';
  }

  function shouldStayQuick(block){
    if(!block)return true;
    if(block.id==='foAdvancedSettingsEntry')return true;
    if(block.querySelector('#logoutBtn'))return true;
    const h=settingsHeading(block);
    return h.includes('thème')||h.includes("couleur d'accent")||h.includes('mode compact')||h.includes('fond noir');
  }

  function moveAdvancedSettings(){
    const grid=document.querySelector('#view-profil .settings-grid, #settingsOverlay .settings-grid');
    if(!grid)return;
    createSettingsHub();

    Array.from(grid.children).forEach(block=>{
      if(!block.classList?.contains('setting-block')||shouldStayQuick(block))return;
      const target=document.getElementById(settingsTarget(block));
      if(target)target.appendChild(block);
    });

    if(!document.getElementById('foAdvancedSettingsEntry')){
      const entry=document.createElement('div');
      entry.id='foAdvancedSettingsEntry';
      entry.className='setting-block wide fo-settings-entry';
      entry.innerHTML='<h4>⚙️ Plus de réglages</h4><p>Compte, société, sauvegardes, sécurité, confidentialité et outils avancés sont regroupés sur une page dédiée.</p><button class="btn-primary" id="foOpenAdvancedSettings" type="button" style="width:100%">Ouvrir les réglages avancés</button>';
      grid.appendChild(entry);
      entry.querySelector('#foOpenAdvancedSettings')?.addEventListener('click',openSettingsHub);
    }
  }

  function addPrivacySettings(){
    createSettingsHub();
    const grid=document.getElementById('foSettingsPrivacy');
    if(!grid||document.getElementById('foPrivacySettings'))return;
    const block=document.createElement('div');
    block.className='setting-block wide';block.id='foPrivacySettings';
    block.innerHTML=`<h4>🔐 Confidentialité & sécurité</h4><p>Consulte les engagements de confidentialité et les documents qui encadrent l’utilisation de FIBRE OPS.</p><div class="fo-settings-actions"><a href="${LEGAL_BASE}confidentialite.html" target="_blank" rel="noopener">Confidentialité</a><a href="${LEGAL_BASE}securite.html" target="_blank" rel="noopener">Sécurité</a><a href="${LEGAL_BASE}mentions-legales.html" target="_blank" rel="noopener">Mentions légales</a><a href="${LEGAL_BASE}cgu.html" target="_blank" rel="noopener">CGU</a><a href="${LEGAL_BASE}cookies.html" target="_blank" rel="noopener">Cookies & stockage local</a></div><div class="fo-privacy-status">Les données métier ne doivent pas être accessibles au Platform Admin dans l’usage courant.</div>`;
    grid.appendChild(block);
  }

  function openSettingsHub(){
    createSettingsHub();
    moveAdvancedSettings();
    addPrivacySettings();
    const page=document.getElementById('foSettingsPage');
    if(!page)return;
    document.getElementById('settingsOverlay')?.classList.remove('active');
    page.classList.add('active');
    page.setAttribute('aria-hidden','false');
    settingsHubOpen=true;
    document.body.classList.add('fo-settings-page-open');
    try{if(location.hash!=='#reglages-avances')history.pushState({foSettings:true},'',location.pathname+location.search+'#reglages-avances')}catch{}
  }

  function clearSettingsRoute(){
    try{
      if(location.hash==='#reglages-avances')history.replaceState(null,'',location.pathname+location.search);
    }catch{}
  }

  function closeSettingsHub(reopenQuick=false){
    const page=document.getElementById('foSettingsPage');
    page?.classList.remove('active');
    page?.setAttribute('aria-hidden','true');
    settingsHubOpen=false;
    document.body.classList.remove('fo-settings-page-open');
    clearSettingsRoute();
    if(reopenQuick)setTimeout(()=>{if(typeof navigateView==='function')navigateView('profil');else document.getElementById('settingsOverlay')?.classList.add('active')},40);
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
  window.addEventListener('popstate',()=>{if(settingsHubOpen&&location.hash!=='#reglages-avances')closeSettingsHub(true)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&settingsHubOpen){e.preventDefault();closeSettingsHub(true)}});
  setInterval(()=>{if(!dateTouchedByUser)syncInterventionDate(false)},60000);

  function init(){
    addLegalLinks();
    addCaptureNotice();
    createSettingsHub();
    addPrivacySettings();
    moveAdvancedSettings();
    bindDateProtection();
    // Settings are a temporary panel, not a persisted startup destination.
    clearSettingsRoute();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

  const observer=new MutationObserver(()=>{addLegalLinks();addCaptureNotice();addPrivacySettings();moveAdvancedSettings();bindDateProtection()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
