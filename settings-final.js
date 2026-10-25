(function(){
  'use strict';
  if(window.FibreSettingsFinal?.version==='v2-safe')return;

  const $=id=>document.getElementById(id);
  let prepared=false;

  function heading(node){
    return String(node?.querySelector('h4,h3')?.textContent||'').trim().toLowerCase();
  }

  function existingSection(gridId,sectionId){
    const grid=$(gridId);
    const section=grid?.closest('.fo-settings-section')||null;
    if(section&&sectionId&&!section.id)section.id=sectionId;
    return section;
  }

  function ensureSection(id,gridId,icon,title,copy){
    let section=$(id);
    if(section)return section;
    const content=document.querySelector('#foSettingsPage .fo-settings-page-content');
    if(!content)return null;
    section=document.createElement('section');
    section.className='fo-settings-section';
    section.id=id;
    section.innerHTML=`<div class="fo-settings-section-head"><span>${icon}</span><div><h2>${title}</h2><p>${copy}</p></div></div><div class="fo-settings-section-grid" id="${gridId}"></div>`;
    content.appendChild(section);
    return section;
  }

  function targetForBlock(block){
    const h=heading(block);
    if(block.id==='adminBlock'||h.includes('administration'))return $('foSettingsAdmin');
    if(h.includes('thème')||h.includes("couleur d'accent")||h.includes('mode compact')||h.includes('fond noir'))return $('foSettingsAppearanceGrid');
    if(block.id==='installAppBlock'||h.includes('installer')||h.includes('version')||h.includes('objectif'))return $('foSettingsApp');
    if(h.includes('sauvegarde')||h.includes('brouillon'))return $('foSettingsData');
    if(block.id==='foPrivacySettings'||h.includes('confidentialité')||h.includes('mentions légales')||h.includes('cookies'))return $('foSettingsPrivacy');
    return $('foSettingsAccount');
  }

  function moveOnce(node,target,first=false){
    if(!node||!target||node.parentElement===target)return;
    if(first)target.insertBefore(node,target.firstChild);else target.appendChild(node);
  }

  function prepareSettingsPage(){
    if(prepared)return true;
    const page=$('foSettingsPage');
    const content=page?.querySelector('.fo-settings-page-content');
    if(!page||!content)return false;

    const title=page.querySelector('.fo-settings-page-title');
    const sub=page.querySelector('.fo-settings-page-sub');
    const back=$('foSettingsBack');
    if(title)title.textContent='Réglages';
    if(sub)sub.textContent='Compte, terrain, apparence, sauvegardes et sécurité';
    if(back)back.textContent='← Profil';

    const accountSection=existingSection('foSettingsAccount','foSettingsAccountSection');
    const appSection=existingSection('foSettingsApp','foSettingsAppSection');
    const dataSection=existingSection('foSettingsData','foSettingsDataSection');
    const privacySection=existingSection('foSettingsPrivacy','foSettingsPrivacySection');
    const adminSection=existingSection('foSettingsAdmin','foSettingsAdminSection');

    const fieldSection=ensureSection('foSettingsFieldSection','foSettingsFieldGrid','🛠️','Préférences terrain','Écran de démarrage et valeurs proposées lors d’une nouvelle intervention.');
    const appearanceSection=ensureSection('foSettingsAppearanceSection','foSettingsAppearanceGrid','🎨','Apparence','Thème, couleur et densité d’affichage.');

    const startCard=$('experienceStart')?.closest('.experience-card');
    const defaultsCard=$('defaultOperator')?.closest('.experience-card');
    moveOnce(startCard,$('foSettingsFieldGrid'));
    moveOnce(defaultsCard,$('foSettingsFieldGrid'));
    moveOnce($('backupStatusCard'),$('foSettingsData'),true);

    document.querySelectorAll('#profileSettings .setting-block').forEach(block=>{
      if(block.id==='foAdvancedSettingsEntry')return;
      moveOnce(block,targetForBlock(block));
    });

    const order=[accountSection,fieldSection,appearanceSection,dataSection,appSection,privacySection,adminSection].filter(Boolean);
    order.forEach(section=>{if(section.parentElement===content)content.appendChild(section)});

    prepared=true;
    document.body.classList.add('fo-settings-v2-ready');
    return true;
  }

  function decorateEntry(){
    const entry=$('foAdvancedSettingsEntry');
    const button=$('foOpenAdvancedSettings');
    if(!entry||!button)return false;
    entry.classList.add('fo-settings-entry-final');
    const h=entry.querySelector('h4');
    const p=entry.querySelector('p');
    if(h)h.textContent='⚙️ Réglages';
    if(p)p.textContent='Compte, préférences terrain, apparence, sauvegardes et sécurité.';
    button.textContent='Ouvrir les réglages';
    return true;
  }

  function onOpen(){
    // Le module conformité ouvre déjà la page. On organise ensuite une seule fois.
    requestAnimationFrame(()=>{
      prepareSettingsPage();
      setTimeout(()=>window.FibreGoogleBackup?.loadStatus?.(),80);
    });
  }

  function bind(){
    decorateEntry();
    // Aucun MutationObserver global : seulement une écoute de clic légère.
    document.addEventListener('click',event=>{
      const button=event.target instanceof Element?event.target.closest('#foOpenAdvancedSettings'):null;
      if(button)onOpen();
    });
    if(location.hash==='#reglages-avances')setTimeout(()=>{prepareSettingsPage();window.FibreGoogleBackup?.loadStatus?.()},120);
  }

  window.FibreSettingsFinal={
    version:'v2-safe',
    prepare:prepareSettingsPage,
    open(){
      const button=$('foOpenAdvancedSettings');
      if(button){button.click();return}
      const overlay=$('settingsOverlay');
      if(overlay)overlay.classList.add('active');
    }
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
