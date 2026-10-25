(function(){
  'use strict';
  if(window.FibreSettingsFinal?.version==='v3-final')return;

  const $=id=>document.getElementById(id);
  let initialized=false;
  let openBridgeButton=null;

  function directHeading(block){
    return String(block?.querySelector(':scope > h4, :scope > h3')?.textContent||'').trim().toLowerCase();
  }

  function makeSupport(){
    let support=$('foSettingsSupport');
    if(!support){
      support=document.createElement('div');
      support.id='foSettingsSupport';
      support.hidden=true;
      document.body.appendChild(support);
    }
    return support;
  }

  function makeAccordion(card,{id,icon,title,copy,open=false}={}){
    if(!card)return null;
    if(id)card.id=id;
    if(card.dataset.foAccordion==='1')return card;

    const oldTitle=card.querySelector(':scope > h4, :scope > h3');
    const oldCopy=oldTitle?.nextElementSibling?.tagName==='P'?oldTitle.nextElementSibling:null;
    oldTitle?.remove();
    oldCopy?.remove();

    const body=document.createElement('div');
    body.className='fo-accordion-body';
    while(card.firstChild)body.appendChild(card.firstChild);

    const button=document.createElement('button');
    button.type='button';
    button.className='fo-accordion-trigger';
    button.setAttribute('aria-expanded',open?'true':'false');
    button.innerHTML=`<span class="fo-accordion-title"><span class="fo-accordion-icon" aria-hidden="true">${icon||'•'}</span><span><b>${title||''}</b><small>${copy||''}</small></span></span><span class="fo-accordion-chevron" aria-hidden="true">⌄</span>`;
    button.addEventListener('click',()=>{
      const next=!card.classList.contains('fo-open');
      card.classList.toggle('fo-open',next);
      button.setAttribute('aria-expanded',String(next));
    });

    card.classList.add('fo-accordion-card');
    card.dataset.foAccordion='1';
    card.classList.toggle('fo-open',!!open);
    card.append(button,body);
    return card;
  }

  function syncProfileIdentity(){
    const emailNode=$('foProfileEmail');
    if(!emailNode)return;
    let email='';
    try{if(typeof profile!=='undefined'&&profile?.email)email=profile.email}catch{}
    if(!email){
      const raw=String($('settingsIdentity')?.textContent||'');
      const parts=raw.split('·').map(v=>v.trim()).filter(Boolean);
      email=parts.length>1?parts[parts.length-1]:'';
    }
    emailNode.textContent=email||'Compte connecté';
  }

  function buildProfile(){
    const view=$('view-profil');
    if(!view)return false;

    const title=view.querySelector('.view-title');
    const copy=view.querySelector('.view-copy');
    if(title)title.textContent='Profil';
    if(copy)copy.textContent='Tes opérateurs, tes préférences de terrain et tes sauvegardes.';

    const accountHead=view.querySelector('.experience-account-head');
    const name=$('experienceName');
    const role=$('experienceRole');
    const logout=$('logoutBtn');
    if(accountHead&&name){
      accountHead.classList.add('fo-profile-identity');
      $('experienceAvatar')?.classList.add('fo-hidden-avatar');
      role?.classList.add('fo-hidden-role');
      const info=name.parentElement;
      if(info&&!$('foProfileEmail')){
        const email=document.createElement('div');
        email.id='foProfileEmail';
        email.className='fo-profile-email';
        info.appendChild(email);
      }
      if(logout&&logout.parentElement!==accountHead){
        logout.classList.add('fo-profile-logout');
        logout.textContent='Déconnexion';
        accountHead.appendChild(logout);
      }
    }

    const accountBlock=$('settingsIdentity')?.closest('.setting-block');
    if(accountBlock)makeSupport().appendChild(accountBlock);

    const topGrid=view.querySelector('.experience-grid');
    const startCard=$('experienceStart')?.closest('.experience-card');
    const goalBlock=$('goalInput')?.closest('.setting-block');
    if(goalBlock){
      goalBlock.classList.add('experience-card','fo-profile-card');
      goalBlock.classList.remove('setting-block','wide');
      makeAccordion(goalBlock,{id:'foProfileGoal',icon:'◎',title:'Objectif journalier',copy:'Définis le montant cible affiché dans ton dashboard.'});
      if(topGrid)topGrid.insertAdjacentElement('afterend',goalBlock);
      else if(startCard)startCard.insertAdjacentElement('afterend',goalBlock);
    }

    const prefs=$('defaultOperator')?.closest('.experience-card');
    if(prefs)makeAccordion(prefs,{id:'foProfilePreferences',icon:'⚡',title:'Préférences de saisie',copy:'Préremplis tes choix habituels pour gagner du temps sur le terrain.'});

    const backup=$('backupStatusCard');
    if(backup)makeAccordion(backup,{id:'foProfileBackups',icon:'☁',title:'Mes sauvegardes',copy:'Google Sheets et copies de secours de ton compte.'});

    const advanced=$('foAdvancedSettingsEntry');
    if(advanced){
      openBridgeButton=$('foOpenAdvancedSettings');
      makeSupport().appendChild(advanced);
    }

    syncProfileIdentity();
    return true;
  }

  function makeSection(id,icon,title,copy){
    const section=document.createElement('section');
    section.className='fo-final-section';
    section.id=id;
    section.innerHTML=`<div class="fo-final-section-head"><span aria-hidden="true">${icon}</span><div><h2>${title}</h2><p>${copy}</p></div></div><div class="fo-final-section-grid"></div>`;
    return section;
  }

  function collectSettingsBlocks(){
    const selectors=['#profileSettings .setting-block','#settingsOverlay .setting-block','#foSettingsPage .setting-block'];
    return Array.from(document.querySelectorAll(selectors.join(','))).filter((node,index,arr)=>arr.indexOf(node)===index);
  }

  function buildSettings(){
    const page=$('foSettingsPage');
    const content=page?.querySelector('.fo-settings-page-content');
    if(!page||!content)return false;

    const pageTitle=page.querySelector('.fo-settings-page-title');
    const pageSub=page.querySelector('.fo-settings-page-sub');
    const back=$('foSettingsBack');
    if(pageTitle)pageTitle.textContent='Réglages';
    if(pageSub)pageSub.textContent='Apparence, données, sécurité et configuration de FIBRE OPS.';
    if(back)back.textContent='← Profil';

    if(!openBridgeButton)openBridgeButton=$('foOpenAdvancedSettings');

    const blocks=collectSettingsBlocks();
    const support=makeSupport();
    const accountBlock=$('settingsIdentity')?.closest('.setting-block');
    if(accountBlock) support.appendChild(accountBlock);
    const advanced=$('foAdvancedSettingsEntry');
    if(advanced) support.appendChild(advanced);

    const appearance=[];
    const organization=[];
    let passwordBlock=null,backupBlock=null,draftBlock=null,privacyBlock=null,adminBlock=null,installBlock=null,versionBlock=null;

    blocks.forEach(block=>{
      if(block===accountBlock||block===advanced||block.id==='foProfileGoal')return;
      const h=directHeading(block);
      if(h.includes('thème')||h.includes("couleur d'accent")||h.includes('mode compact')||h.includes('fond noir'))appearance.push(block);
      else if(h.includes('mot de passe'))passwordBlock=block;
      else if(h.includes('sauvegarde json'))backupBlock=block;
      else if(h.includes('brouillon'))draftBlock=block;
      else if(block.id==='foPrivacySettings'||h.includes('confidentialité'))privacyBlock=block;
      else if(block.id==='adminBlock'||h.includes('administration'))adminBlock=block;
      else if(block.id==='installAppBlock'||h.includes('installer fibre ops'))installBlock=block;
      else if(h.includes('version'))versionBlock=block;
      else if(h.includes('objectif')){
        // L'objectif appartient au Profil.
      } else organization.push(block);
    });

    const final=document.createElement('div');
    final.id='foSettingsFinalContent';
    final.className='fo-final-settings';

    if(appearance.length){
      const sec=makeSection('foFinalAppearance','🎨','Apparence','Thème, couleur d’accent et densité d’affichage.');
      appearance.forEach(block=>sec.querySelector('.fo-final-section-grid').appendChild(block));
      final.appendChild(sec);
    }

    if(organization.length){
      const sec=makeSection('foFinalOrganization','🏢','Compte & organisation','Société, binôme et paramètres liés à ton organisation.');
      organization.forEach(block=>sec.querySelector('.fo-final-section-grid').appendChild(block));
      final.appendChild(sec);
    }

    if(backupBlock||draftBlock){
      const sec=makeSection('foFinalData','⇩','Données & outils','Exports, sauvegarde locale et brouillon.');
      const grid=sec.querySelector('.fo-final-section-grid');
      if(backupBlock){
        makeAccordion(backupBlock,{id:'foSettingsExports',icon:'⇩',title:'Exports & données',copy:'Copies de secours et exports ponctuels.'});
        grid.appendChild(backupBlock);
      }
      if(draftBlock){
        makeAccordion(draftBlock,{id:'foSettingsDraft',icon:'✎',title:'Brouillons',copy:'Gestion des données temporaires de saisie.'});
        grid.appendChild(draftBlock);
      }
      final.appendChild(sec);
    }

    if(passwordBlock||privacyBlock){
      const sec=makeSection('foFinalSecurity','🔒','Sécurité & légal','Protection du compte et documents réglementaires.');
      const grid=sec.querySelector('.fo-final-section-grid');
      if(passwordBlock){
        makeAccordion(passwordBlock,{id:'foSettingsSecurity',icon:'🔒',title:'Sécurité',copy:'Protection et accès au compte.'});
        grid.appendChild(passwordBlock);
      }
      if(privacyBlock){
        makeAccordion(privacyBlock,{id:'foSettingsLegal',icon:'ⓘ',title:'Confidentialité & légal',copy:'CGU, confidentialité, sécurité et mentions légales.'});
        grid.appendChild(privacyBlock);
      }
      final.appendChild(sec);
    }

    if(adminBlock){
      const sec=makeSection('foFinalAdmin','🛡️','Administration','Outils disponibles uniquement pour les comptes autorisés.');
      sec.classList.add('admin-only');
      sec.querySelector('.fo-final-section-grid').appendChild(adminBlock);
      final.appendChild(sec);
    }

    if(installBlock||versionBlock){
      const sec=makeSection('foFinalApplication','▣','Application','Installation et informations techniques.');
      const shell=document.createElement('div');
      shell.className='setting-block wide';
      const inner=document.createElement('div');
      inner.className='fo-app-settings-inner';
      if(installBlock)inner.appendChild(installBlock);
      if(versionBlock)inner.appendChild(versionBlock);
      shell.appendChild(inner);
      makeAccordion(shell,{id:'foSettingsApplication',icon:'▣',title:'Application & version',copy:'Installation de FIBRE OPS et informations de version.'});
      sec.querySelector('.fo-final-section-grid').appendChild(shell);
      final.appendChild(sec);
    }

    content.replaceChildren(final);
    return true;
  }

  function openSettings(){
    if(!initialized)initialize();
    if(openBridgeButton?.isConnected){openBridgeButton.click();return;}
    if(openBridgeButton){openBridgeButton.click();return;}
    const page=$('foSettingsPage');
    if(!page)return;
    page.classList.add('active');
    page.setAttribute('aria-hidden','false');
    document.body.classList.add('fo-settings-page-open');
  }

  function bindEntryPoints(){
    const settingsBtn=$('settingsBtn');
    if(settingsBtn)settingsBtn.onclick=openSettings;
    document.addEventListener('click',event=>{
      const profileButton=event.target instanceof Element?event.target.closest('[data-view="profil"]'):null;
      if(profileButton)setTimeout(syncProfileIdentity,50);
    });
  }

  function initialize(){
    if(initialized)return true;
    if(!$('view-profil')||!$('foSettingsPage')||!$('goalInput')||!$('logoutBtn'))return false;
    buildProfile();
    buildSettings();
    bindEntryPoints();
    initialized=true;
    document.body.classList.add('fo-profile-settings-final-ready');
    [50,250,700,1500,3000].forEach(ms=>setTimeout(syncProfileIdentity,ms));
    return true;
  }

  function boot(attempt=0){
    if(initialize())return;
    if(attempt<30)setTimeout(()=>boot(attempt+1),100);
  }

  window.FibreSettingsFinal={version:'v3-final',open:openSettings,initialize,syncIdentity:syncProfileIdentity};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot(),{once:true});else boot();
})();
