(function(){
  'use strict';

  const STATE_DEFAULTS={
    welcome_seen:false,
    intervention_tip_seen:false,
    capture_tip_seen:false,
    capture_nd_seen:false,
    capture_address_seen:false,
    capture_typology_seen:false,
    first_intervention_completed:false,
    history_tip_seen:false,
    dashboard_tip_seen:false,
    settings_tip_seen:false,
    tariffs_tip_seen:false,
    billing_invoice_tip_seen:false,
    billing_clients_tip_seen:false,
    billing_reconcile_tip_seen:false,
    tutorial_enabled:true
  };
  const TIP_KEYS=[
    'intervention_tip_seen','capture_tip_seen','capture_nd_seen','capture_address_seen','capture_typology_seen',
    'first_intervention_completed','history_tip_seen','dashboard_tip_seen','settings_tip_seen','tariffs_tip_seen',
    'billing_invoice_tip_seen','billing_clients_tip_seen','billing_reconcile_tip_seen'
  ];

  let tutorialState=null;
  let tutorialStorageKey='';
  let currentCard=null;
  let currentDescriptor=null;
  let currentHighlight=null;
  let queue=[];
  let lastActiveView='';
  let welcomeTimer=null;
  let billingPatched=false;

  function appUser(){try{return typeof user!=='undefined'&&user?.id?user:null}catch{return null}}
  function appProfile(){try{return typeof profile!=='undefined'?profile:null}catch{return null}}
  function appSettings(){try{return typeof settings!=='undefined'?settings:null}catch{return null}}
  function appInterventions(){try{return Array.isArray(interventions)?interventions:[]}catch{return []}}
  function tutorialNonce(){
    try{return String(appSettings()?.preferences?.tutorial_reset_nonce||'v1')}catch{return 'v1'}
  }
  function stateKey(uid){return `fibre_ops_tutorial_${uid}_${tutorialNonce()}`}
  function eligible(){
    if(!appUser())return false;
    if(document.body.classList.contains('company-admin-manager'))return false;
    if(document.getElementById('betaAdminOverlay')?.classList.contains('active'))return false;
    return true;
  }
  function enabled(){return !!tutorialState?.tutorial_enabled&&eligible()}
  function loadState(){
    const u=appUser();if(!u)return false;
    const key=stateKey(u.id);
    if(tutorialStorageKey===key&&tutorialState)return true;
    tutorialStorageKey=key;
    let raw=null;
    try{raw=localStorage.getItem(key)}catch{}
    let parsed={};
    try{parsed=raw?JSON.parse(raw):{}}catch{}
    tutorialState={...STATE_DEFAULTS,...(parsed&&typeof parsed==='object'?parsed:{})};
    if(!raw&&appInterventions().length>0)tutorialState.first_intervention_completed=true;
    saveState();
    return true;
  }
  function saveState(){
    if(!tutorialStorageKey||!tutorialState)return;
    try{localStorage.setItem(tutorialStorageKey,JSON.stringify(tutorialState))}catch{}
  }
  function mark(key,value=true){if(!tutorialState||!(key in STATE_DEFAULTS))return;tutorialState[key]=value;saveState()}
  function seen(key){return !!tutorialState?.[key]}

  function clearHighlight(){
    if(currentHighlight){
      currentHighlight.classList.remove('fibre-tutorial-highlight');
      currentHighlight=null;
    }
  }
  function removeCard(markSeen=true){
    if(!currentCard)return;
    if(markSeen&&currentDescriptor?.key)mark(currentDescriptor.key,true);
    clearHighlight();
    currentCard.remove();currentCard=null;currentDescriptor=null;
    window.removeEventListener('resize',positionCurrent,true);
    window.removeEventListener('scroll',positionCurrent,true);
    setTimeout(pump,90);
  }
  function positionCurrent(){
    if(!currentCard||!currentDescriptor)return;
    const anchor=currentDescriptor.anchor;
    if(!anchor||currentCard.classList.contains('fibre-tutorial-welcome'))return;
    if(window.innerWidth<=760){currentCard.style.left='';currentCard.style.top='';return}
    const rect=anchor.getBoundingClientRect();
    const cw=currentCard.offsetWidth||370,ch=currentCard.offsetHeight||170;
    let left=Math.max(12,Math.min(window.innerWidth-cw-12,rect.left));
    let top=rect.bottom+10;
    if(top+ch>window.innerHeight-12)top=Math.max(12,rect.top-ch-10);
    currentCard.style.left=left+'px';currentCard.style.top=top+'px';
  }
  function showDescriptor(d){
    if(!enabled()||!d||seen(d.key))return pump();
    const anchor=d.anchor&&document.documentElement.contains(d.anchor)?d.anchor:null;
    if(d.reveal&&anchor){
      try{anchor.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'})}catch{}
    }
    if(anchor){
      currentHighlight=anchor;
      currentHighlight.classList.add('fibre-tutorial-highlight');
    }

    const card=document.createElement('aside');
    card.className='fibre-tutorial-card'+(d.welcome?' fibre-tutorial-welcome':'');
    card.setAttribute('role','status');
    card.setAttribute('aria-live','polite');
    if(anchor)card.dataset.anchor='1';

    const head=document.createElement('div');head.className='fibre-tutorial-card-head';
    const title=document.createElement('h3');title.textContent=d.title;
    const close=document.createElement('button');close.className='fibre-tutorial-close';close.type='button';close.setAttribute('aria-label','Fermer le conseil');close.textContent='✕';
    head.append(title,close);

    const text=document.createElement('p');text.textContent=d.text;
    const actions=document.createElement('div');actions.className='fibre-tutorial-actions';
    (d.actions||[{label:'Compris',primary:true}]).forEach(a=>{
      const b=document.createElement('button');b.type='button';b.className=a.primary?'btn-primary':'btn-ghost';b.textContent=a.label;
      b.addEventListener('click',()=>{
        mark(d.key,true);
        removeCard(false);
        try{a.run?.()}catch(err){console.warn('[FIBRE OPS tutorial action]',err)}
      });
      actions.appendChild(b);
    });
    close.addEventListener('click',()=>removeCard(true));
    card.append(head,text,actions);
    document.body.appendChild(card);
    currentCard=card;currentDescriptor={...d,anchor};
    window.addEventListener('resize',positionCurrent,true);
    window.addEventListener('scroll',positionCurrent,true);
    requestAnimationFrame(positionCurrent);
  }
  function enqueue(d){
    if(!d?.key||seen(d.key)||!enabled())return;
    if(currentDescriptor?.key===d.key||queue.some(x=>x.key===d.key))return;
    queue.push(d);pump();
  }
  function pump(){
    if(currentCard||!enabled())return;
    while(queue.length){
      const d=queue.shift();
      if(!seen(d.key)){showDescriptor(d);break}
    }
  }

  function showWelcome(){
    enqueue({
      key:'welcome_seen',welcome:true,
      title:'Bienvenue sur FIBRE OPS 👋',
      text:'Ton espace est prêt. FIBRE OPS va te guider au fur et à mesure de ton utilisation, uniquement quand tu en as besoin.',
      actions:[{label:'Commencer 🚀',primary:true}]
    });
  }
  function showInterventionTip(){
    enqueue({
      key:'intervention_tip_seen',anchor:document.querySelector('#view-saisie .view-head'),
      title:'Ta première intervention 🛠️',
      text:'Renseigne simplement les informations de ton intervention. FIBRE OPS l’organise ensuite automatiquement dans ton activité.',
      actions:[{label:'Compris 👍',primary:true}]
    });
  }
  function showCaptureTip(){
    const cap=document.getElementById('cap-file');
    enqueue({
      key:'capture_tip_seen',anchor:cap?.closest('.cap-row')||cap?.parentElement,
      title:'Gagne du temps 📸',
      text:'Ajoute une capture compatible pour préremplir automatiquement le ND et l’adresse quand ils sont détectés.',
      actions:[
        {label:'Tester une capture',primary:true,run:()=>setTimeout(()=>document.getElementById('cap-file')?.click(),80)},
        {label:'Plus tard',primary:false}
      ]
    });
  }
  function showCaptureSuccess(){
    if(!loadState()||!enabled())return;
    const nd=document.getElementById('f-num');
    const addr=document.getElementById('f-addr');
    const type=document.getElementById('f-typo');

    if(nd?.value.trim()){
      enqueue({
        key:'capture_nd_seen',anchor:nd.closest('.field')||nd,reveal:true,
        title:'Ton ND est ici ✅',
        text:'Ici, ton ND s’est inséré automatiquement grâce à la capture.',
        actions:[{label:'Suivant',primary:true}]
      });
    }else mark('capture_nd_seen',true);

    if(addr?.value.trim()){
      enqueue({
        key:'capture_address_seen',anchor:addr.closest('.field')||addr,reveal:true,
        title:'Adresse préremplie 📍',
        text:'Et ici, l’adresse de ton client a été préremplie automatiquement.',
        actions:[{label:'Suivant',primary:true}]
      });
    }else mark('capture_address_seen',true);

    enqueue({
      key:'capture_typology_seen',anchor:type?.closest('.field')||type,reveal:true,
      title:'À toi de choisir la typologie 👇',
      text:'Sélectionne ta typologie après avoir inséré ta capture. FIBRE OPS calculera ensuite le montant correspondant.',
      actions:[{label:'Compris',primary:true}]
    });
  }
  function showHistoryTip(){
    const billingBtn=document.getElementById('billingHistoryBtn');
    const billingAvailable=billingBtn&&document.getElementById('view-finances')?.classList.contains('active')&&getComputedStyle(billingBtn).display!=='none'&&!billingBtn.disabled;
    if(billingAvailable){
      enqueue({
        key:'history_tip_seen',anchor:billingBtn,reveal:true,
        title:'Le bouton qui fait gagner un temps fou 🧾',
        text:'Dans Finances, touche Factures & encaissements : tu peux créer tes factures ET comparer ton récap FIBRE OPS avec celui du donneur d’ordre pour repérer les écarts.',
        actions:[
          {label:'Découvrir Facturation 🚀',primary:true,run:()=>setTimeout(()=>billingBtn.click(),80)},
          {label:'Plus tard',primary:false}
        ]
      });
    }else{
      enqueue({
        key:'history_tip_seen',anchor:document.querySelector('#view-historique .view-head'),
        title:'Ton historique 📋',
        text:'Toutes tes interventions sont regroupées ici. Tu peux les rechercher et retrouver rapidement ton activité passée.',
        actions:[{label:'Compris',primary:true}]
      });
    }
  }
  function showDashboardTip(){
    if(!appInterventions().length)return;
    enqueue({
      key:'dashboard_tip_seen',anchor:document.querySelector('#view-dashboard .dash-head')||document.querySelector('#view-dashboard .view-head'),
      title:'Ton activité en un coup d’œil 📊',
      text:'Le tableau de bord utilise tes interventions pour te donner une vue rapide de ton activité et de tes principaux indicateurs.',
      actions:[{label:'Continuer',primary:true}]
    });
  }
  function showSettingsTip(){
    enqueue({
      key:'settings_tip_seen',anchor:document.querySelector('#view-profil .view-head, #settingsOverlay .settings-title'),
      title:'Ton espace, tes réglages ⚙️',
      text:'Personnalise FIBRE OPS ici et retrouve la carte Tutoriel & aide pour réactiver ou recommencer les conseils.',
      actions:[{label:'Compris',primary:true}]
    });
  }
  function showTariffsTip(){
    const companyTech=document.body.classList.contains('company-technician-mode');
    enqueue({
      key:'tariffs_tip_seen',anchor:document.getElementById('personalTariffsCard'),reveal:true,
      title:companyTech?'Tes tarifs société 🔒':'Gère tes opérateurs & tarifs 💶',
      text:companyTech
        ? 'Dans une société, les opérateurs et tarifs sont gérés par ton patron. Ici tu peux consulter les typologies et tes montants quand ils sont visibles.'
        : 'Désactive un opérateur pour le retirer des nouvelles saisies sans supprimer ton historique. Tu peux le réactiver plus tard et ajuster tes typologies et tarifs ici.',
      actions:[{label:'Compris',primary:true}]
    });
  }
  function showFirstInterventionNotice(){
    if(!enabled()||seen('first_intervention_completed'))return;
    mark('first_intervention_completed',true);
    const n=document.createElement('div');n.className='fibre-tutorial-notice';n.setAttribute('role','status');
    n.innerHTML='<b>Première intervention enregistrée 🎉</b><span>Elle est maintenant disponible dans ton historique et prise en compte dans ton tableau de bord.</span><button type="button" aria-label="Fermer">✕</button>';
    document.body.appendChild(n);
    const close=()=>n.remove();n.querySelector('button').onclick=close;setTimeout(close,5600);
  }

  function billingPaneAnchor(name){
    return document.querySelector(`[data-billing-pane="${name}"]`)||document.getElementById(`billingPane-${name}`);
  }
  function showBillingTip(name){
    if(!enabled()||!document.getElementById('view-facturation')?.classList.contains('active'))return;
    if(name==='invoices'){
      const hasProfile=(()=>{
        try{return typeof invoiceProfile!=='undefined'&&!!invoiceProfile}catch{return false}
      })();
      enqueue({
        key:'billing_invoice_tip_seen',anchor:billingPaneAnchor('invoices'),
        title:'Créer une facture 🧾',
        text:hasProfile
          ? 'Choisis ton client, le mois et le montant. Enregistre d’abord le brouillon, puis valide la facture quand tout est bon : elle sera alors figée.'
          : 'Ici tu crées ta facture : client, mois et montant. Avant la première validation, renseigne une fois “Ma société” ; ensuite ses coordonnées seront réutilisées automatiquement.',
        actions:[{label:'Compris',primary:true}]
      });
    }else if(name==='clients'){
      enqueue({
        key:'billing_clients_tip_seen',anchor:billingPaneAnchor('clients'),
        title:'Tes clients, une seule fois 🏢',
        text:'Ajoute ici ton donneur d’ordre. Une fois enregistré, il apparaît directement dans “Société cliente” quand tu prépares une facture.',
        actions:[{label:'Compris',primary:true}]
      });
    }else if(name==='reconcile'){
      enqueue({
        key:'billing_reconcile_tip_seen',anchor:billingPaneAnchor('reconcile'),
        title:'Compare les récaps en quelques clics 🔍',
        text:'Choisis le mois, importe le fichier .xlsx ou .csv du donneur d’ordre, puis touche “Comparer les récaps”. Les écarts ressortent sans modifier tes interventions.',
        actions:[{label:'Compris',primary:true}]
      });
    }
  }

  function activeView(){return document.querySelector('main > section.view.active')?.id?.replace(/^view-/,'')||''}
  function activeBillingPane(){
    const p=document.querySelector('#view-facturation .billing-v2-pane.active');
    return p?.id?.replace('billingPane-','')||'';
  }
  function handleView(){
    if(!loadState()||!enabled())return;
    const v=activeView();if(!v)return;
    if(v!==lastActiveView)lastActiveView=v;
    if(v==='saisie')showInterventionTip();
    else if(v==='historique')setTimeout(showHistoryTip,80);
    else if(v==='dashboard')showDashboardTip();
    else if(v==='tarifs')showTariffsTip();
    else if(v==='profil'){injectSettings();showSettingsTip()}
    else if(v==='facturation')setTimeout(()=>showBillingTip(activeBillingPane()||'invoices'),80);
  }

  function injectSettings(){
    const grid=document.querySelector('#view-profil .settings-grid, #settingsOverlay .settings-grid');
    if(!grid||document.getElementById('fibreTutorialSettings'))return;
    const block=document.createElement('div');block.id='fibreTutorialSettings';block.className='setting-block wide fibre-tutorial-settings';
    block.innerHTML=`<h4>🎓 Tutoriel & aide</h4><p>Découvre les fonctionnalités de FIBRE OPS au fur et à mesure de leur utilisation.</p>
      <div class="display-toggle-row"><div class="display-toggle-copy"><b>Tutoriel activé</b><small>Aucune aide contextuelle n’apparaît quand il est désactivé.</small></div><label class="display-switch" aria-label="Tutoriel activé"><input id="fibreTutorialToggle" type="checkbox"><span aria-hidden="true"></span></label></div>
      <div class="fibre-tutorial-settings-actions"><button class="btn-ghost" type="button" id="fibreTutorialReplayTips">Revoir les astuces</button><button class="btn-ghost" type="button" id="fibreTutorialRestart">Recommencer le tutoriel</button></div>`;
    grid.appendChild(block);

    const toggle=block.querySelector('#fibreTutorialToggle');toggle.checked=!!tutorialState?.tutorial_enabled;
    toggle.addEventListener('change',()=>{
      tutorialState.tutorial_enabled=toggle.checked;saveState();
      if(!toggle.checked){queue=[];removeCard(false)}
      else{maybeWelcome();handleView()}
      try{if(typeof toast==='function')toast(toggle.checked?'Tutoriel activé':'Tutoriel désactivé')}catch{}
    });
    block.querySelector('#fibreTutorialReplayTips').onclick=()=>{
      TIP_KEYS.forEach(k=>tutorialState[k]=false);saveState();queue=[];removeCard(false);handleView();
      try{if(typeof toast==='function')toast('Astuces réinitialisées')}catch{}
    };
    block.querySelector('#fibreTutorialRestart').onclick=()=>{
      Object.assign(tutorialState,{...STATE_DEFAULTS,tutorial_enabled:tutorialState.tutorial_enabled});
      saveState();queue=[];removeCard(false);maybeWelcome(true);
      try{if(typeof toast==='function')toast('Tutoriel réinitialisé')}catch{}
    };
  }

  function maybeWelcome(force=false){
    if(!loadState()||!enabled()||seen('welcome_seen'))return;
    const p=appProfile();
    const app=document.getElementById('appShell'),ob=document.getElementById('onboardingGate');
    if(!p?.onboarding_completed||!app||app.classList.contains('app-hidden')||!ob?.classList.contains('app-hidden'))return;
    clearTimeout(welcomeTimer);
    welcomeTimer=setTimeout(()=>{if(force||enabled())showWelcome()},force?40:450);
  }

  function observeToast(){
    const t=document.getElementById('toast');if(!t)return;
    const check=()=>{
      const text=t.textContent||'';
      if(/Intervention(?:\s+\S+)?\s+enregistrée/i.test(text))showFirstInterventionNotice();
    };
    new MutationObserver(check).observe(t,{childList:true,subtree:true,characterData:true});
  }
  function observeCapture(){
    const msg=document.getElementById('cap-msg');
    if(msg){
      const check=()=>{
        if(/^✓\s*Informations détectées/i.test(msg.textContent||''))setTimeout(showCaptureSuccess,120);
      };
      new MutationObserver(check).observe(msg,{childList:true,subtree:true,characterData:true});
    }
    const cap=document.getElementById('cap-file')?.closest('label');
    if(cap){
      cap.addEventListener('mouseenter',showCaptureTip,{passive:true});
      cap.addEventListener('touchstart',showCaptureTip,{passive:true});
      cap.addEventListener('focusin',showCaptureTip);
    }
  }
  function patchBillingOnboarding(){
    if(billingPatched)return;
    try{
      if(typeof billingEnter==='function'){
        billingEnter=async function(){
          if(typeof billingCanUse==='function'&&!billingCanUse())return;
          await loadBillingData();
          billingShowPane(billingActivePane||'invoices');
        };
      }
      billingPatched=true;
    }catch(err){
      console.warn('[FIBRE OPS tutorial] billing patch unavailable',err);
    }
  }
  function observeBilling(){
    const root=document.getElementById('view-facturation');if(!root)return;
    new MutationObserver(()=>{
      if(root.classList.contains('active')){
        setTimeout(()=>showBillingTip(activeBillingPane()||'invoices'),50);
      }
    }).observe(root,{subtree:true,attributes:true,attributeFilter:['class']});

    document.getElementById('billingSectionTabs')?.addEventListener('click',e=>{
      const b=e.target.closest('[data-billing-pane]');if(!b)return;
      setTimeout(()=>showBillingTip(b.dataset.billingPane),70);
    });
  }
  function observeUi(){
    const main=document.querySelector('main');
    if(main)new MutationObserver(()=>handleView()).observe(main,{subtree:true,attributes:true,attributeFilter:['class']});

    const settingsEl=document.getElementById('settingsOverlay');
    if(settingsEl)new MutationObserver(()=>{
      if(settingsEl.classList.contains('active')){injectSettings();showSettingsTip()}
    }).observe(settingsEl,{attributes:true,attributeFilter:['class']});

    const app=document.getElementById('appShell'),ob=document.getElementById('onboardingGate');
    const watcher=new MutationObserver(()=>{
      if(loadState()){injectSettings();maybeWelcome();handleView()}
    });
    if(app)watcher.observe(app,{attributes:true,attributeFilter:['class']});
    if(ob)watcher.observe(ob,{attributes:true,attributeFilter:['class']});

    document.getElementById('settingsBtn')?.addEventListener('click',()=>setTimeout(()=>{injectSettings();showSettingsTip()},30));
  }

  function bootTutorial(){
    if(!loadState()){setTimeout(bootTutorial,250);return}
    patchBillingOnboarding();
    injectSettings();
    observeToast();
    observeCapture();
    observeBilling();
    observeUi();
    maybeWelcome();
    handleView();
    setInterval(()=>{
      if(loadState()){
        patchBillingOnboarding();
        injectSettings();
        maybeWelcome();
        handleView();
      }
    },1200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootTutorial,{once:true});
  else bootTutorial();
})();
