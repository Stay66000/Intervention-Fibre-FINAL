(function(){
  'use strict';
  if(window.FibreSettingsFinal)return;

  const $=id=>document.getElementById(id);
  let arranging=false;

  function heading(node){return String(node?.querySelector('h4,h3')?.textContent||'').trim().toLowerCase()}

  function ensureSection(id,icon,title,copy,beforeId){
    let section=$(id);
    if(section)return section;
    const before=$(beforeId);
    const content=document.querySelector('#foSettingsPage .fo-settings-page-content');
    if(!content)return null;
    section=document.createElement('section');
    section.className='fo-settings-section';
    section.id=id;
    section.innerHTML=`<div class="fo-settings-section-head"><span>${icon}</span><div><h2>${title}</h2><p>${copy}</p></div></div><div class="fo-settings-section-grid" id="${id}Grid"></div>`;
    if(before?.parentElement===content)content.insertBefore(section,before);else content.appendChild(section);
    return section;
  }

  function targetForSetting(block){
    const h=heading(block);
    if(block.id==='adminBlock'||h.includes('administration'))return $('foSettingsAdmin');
    if(h.includes('thème')||h.includes("couleur d'accent")||h.includes('mode compact')||h.includes('fond noir'))return $('foSettingsAppearanceGrid');
    if(block.id==='installAppBlock'||h.includes('installer')||h.includes('version')||h.includes('objectif'))return $('foSettingsApp');
    if(h.includes('sauvegarde')||h.includes('brouillon'))return $('foSettingsData');
    if(block.id==='foPrivacySettings'||h.includes('confidentialité')||h.includes('sécurité'))return $('foSettingsPrivacy');
    return $('foSettingsAccount');
  }

  function moveFieldPreferences(){
    const grid=$('foSettingsFieldGrid');
    if(!grid)return;
    const start=$('experienceStart')?.closest('.experience-card');
    const defaults=$('defaultOperator')?.closest('.experience-card');
    if(start&&start.parentElement!==grid)grid.appendChild(start);
    if(defaults&&defaults.parentElement!==grid)grid.appendChild(defaults);
  }

  function moveBackupCard(){
    const grid=$('foSettingsData');
    const card=$('backupStatusCard');
    if(grid&&card&&card.parentElement!==grid)grid.insertBefore(card,grid.firstChild);
  }

  function moveSettingBlocks(){
    const blocks=[...document.querySelectorAll('#profileSettings .setting-block,#settingsOverlay .setting-block,#foSettingsPage .setting-block')];
    blocks.forEach(block=>{
      if(block.id==='foAdvancedSettingsEntry')return;
      const target=targetForSetting(block);
      if(target&&block.parentElement!==target)target.appendChild(block);
    });
  }

  function configureEntry(){
    const entry=$('foAdvancedSettingsEntry');
    if(!entry)return;
    entry.classList.add('fo-settings-entry-final');
    if(!$('foOpenSettingsFinal')){
      entry.innerHTML='<div class="fo-settings-entry-icon">⚙️</div><div class="fo-settings-entry-copy"><h4>Réglages</h4><p>Compte, préférences terrain, apparence, sauvegardes et sécurité.</p></div><button class="btn-primary" id="foOpenSettingsFinal" type="button">Ouvrir</button>';
      entry.querySelector('#foOpenSettingsFinal')?.addEventListener('click',openSettings);
    }
  }

  function pageTitle(){
    const title=document.querySelector('#foSettingsPage .fo-settings-page-title');
    const sub=document.querySelector('#foSettingsPage .fo-settings-page-sub');
    if(title&&title.textContent!=='Réglages')title.textContent='Réglages';
    const wanted='Compte, terrain, apparence, sauvegardes et sécurité';
    if(sub&&sub.textContent!==wanted)sub.textContent=wanted;
    const back=$('foSettingsBack');if(back&&back.textContent!=='← Profil')back.textContent='← Profil';
  }

  function reorderSections(){
    const content=document.querySelector('#foSettingsPage .fo-settings-page-content');
    if(!content)return;
    const account=$('foSettingsAccount')?.closest('.fo-settings-section');
    const data=$('foSettingsData')?.closest('.fo-settings-section');
    const app=$('foSettingsApp')?.closest('.fo-settings-section');
    const privacy=$('foSettingsPrivacy')?.closest('.fo-settings-section');
    if(account&&!account.id)account.id='foSettingsAccountSection';
    if(data&&!data.id)data.id='foSettingsDataSection';
    if(app&&!app.id)app.id='foSettingsAppSection';
    if(privacy&&!privacy.id)privacy.id='foSettingsPrivacySection';
    const order=['foSettingsAccountSection','foSettingsFieldSection','foSettingsAppearanceSection','foSettingsDataSection','foSettingsAppSection','foSettingsPrivacySection','foSettingsAdminSection'];
    order.forEach(id=>{const section=$(id);if(section&&section.parentElement===content)content.appendChild(section)});
  }

  function openSettings(){
    arrange();
    const legacy=$('settingsOverlay');legacy?.classList.remove('active');
    const page=$('foSettingsPage');
    if(!page)return;
    page.classList.add('active');page.setAttribute('aria-hidden','false');
    document.body.classList.add('fo-settings-page-open');
    try{if(location.hash!=='#reglages-avances')history.pushState({foSettings:true},'',location.pathname+location.search+'#reglages-avances')}catch{}
    setTimeout(()=>window.FibreGoogleBackup?.loadStatus?.(),80);
  }

  function interceptLegacyOverlay(){
    const overlay=$('settingsOverlay');if(!overlay||overlay.dataset.finalSettingsBound)return;
    overlay.dataset.finalSettingsBound='1';
    const observer=new MutationObserver(()=>{
      if(overlay.classList.contains('active')){
        overlay.classList.remove('active');
        openSettings();
      }
    });
    observer.observe(overlay,{attributes:true,attributeFilter:['class']});
  }

  function arrange(){
    if(arranging)return;arranging=true;
    try{
      if(!$('foSettingsPage'))return;
      ensureSection('foSettingsFieldSection','🛠️','Préférences terrain','Écran de démarrage et valeurs proposées lors d’une nouvelle intervention.','foSettingsAppSection');
      ensureSection('foSettingsAppearanceSection','🎨','Apparence','Thème, couleur et densité d’affichage.','foSettingsAppSection');
      const field=$('foSettingsFieldSection');if(field&&!$('foSettingsFieldGrid'))field.querySelector('.fo-settings-section-grid').id='foSettingsFieldGrid';
      const appearance=$('foSettingsAppearanceSection');if(appearance&&!$('foSettingsAppearanceGrid'))appearance.querySelector('.fo-settings-section-grid').id='foSettingsAppearanceGrid';
      pageTitle();
      moveFieldPreferences();
      moveBackupCard();
      moveSettingBlocks();
      reorderSections();
      configureEntry();
      interceptLegacyOverlay();
    }finally{arranging=false}
  }

  function init(){
    arrange();
    setTimeout(arrange,250);setTimeout(arrange,900);
    const observer=new MutationObserver(()=>arrange());
    observer.observe(document.body,{childList:true,subtree:true});
  }

  window.FibreSettingsFinal={open:openSettings,arrange};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();