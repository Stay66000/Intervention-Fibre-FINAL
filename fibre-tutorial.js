(function(){
  'use strict';

  const STATE_DEFAULTS={
    welcome_seen:false,
    intervention_tip_seen:false,
    capture_tip_seen:false,
    first_intervention_completed:false,
    history_tip_seen:false,
    dashboard_tip_seen:false,
    settings_tip_seen:false,
    tutorial_enabled:true
  };
  const TIP_KEYS=['intervention_tip_seen','capture_tip_seen','first_intervention_completed','history_tip_seen','dashboard_tip_seen','settings_tip_seen'];
  let tutorialState=null;
  let tutorialUserId='';
  let currentCard=null;
  let currentDescriptor=null;
  let queue=[];
  let lastActiveView='';
  let storedStateExisted=false;
  let welcomeTimer=null;

  function appUser(){try{return typeof user!=='undefined'&&user?.id?user:null}catch{return null}}
  function appProfile(){try{return typeof profile!=='undefined'?profile:null}catch{return null}}
  function appInterventions(){try{return Array.isArray(interventions)?interventions:[]}catch{return []}}
  function stateKey(uid){return `fibre_ops_tutorial_${uid}`}
  function eligible(){
    if(!appUser())return false;
    if(document.body.classList.contains('company-admin-manager'))return false;
    if(document.getElementById('betaAdminOverlay')?.classList.contains('active'))return false;
    return true;
  }
  function enabled(){return !!tutorialState?.tutorial_enabled&&eligible()}
  function loadState(){
    const u=appUser();if(!u)return false;
    if(tutorialUserId===u.id&&tutorialState)return true;
    tutorialUserId=u.id;
    let raw=null;
    try{raw=localStorage.getItem(stateKey(u.id))}catch{}
    storedStateExisted=!!raw;
    let parsed={};
    try{parsed=raw?JSON.parse(raw):{}}catch{}
    tutorialState={...STATE_DEFAULTS,...(parsed&&typeof parsed==='object'?parsed:{})};
    if(!storedStateExisted&&appInterventions().length>0)tutorialState.first_intervention_completed=true;
    saveState();
    return true;
  }
  function saveState(){
    if(!tutorialUserId||!tutorialState)return;
    try{localStorage.setItem(stateKey(tutorialUserId),JSON.stringify(tutorialState))}catch{}
  }
  function mark(key,value=true){if(!tutorialState||!(key in STATE_DEFAULTS))return;tutorialState[key]=value;saveState()}
  function seen(key){return !!tutorialState?.[key]}

  function removeCard(markSeen=true){
    if(!currentCard)return;
    if(markSeen&&currentDescriptor?.key)mark(currentDescriptor.key,true);
    currentCard.remove();currentCard=null;currentDescriptor=null;
    window.removeEventListener('resize',positionCurrent,true);
    window.removeEventListener('scroll',positionCurrent,true);
    setTimeout(pump,80);
  }
  function positionCurrent(){
    if(!currentCard||!currentDescriptor)return;
    const anchor=currentDescriptor.anchor;
    if(!anchor||currentCard.classList.contains('fibre-tutorial-welcome'))return;
    if(window.innerWidth<=760){currentCard.style.left='';currentCard.style.top='';return}
    const rect=anchor.getBoundingClientRect();
    const cw=currentCard.offsetWidth||360,ch=currentCard.offsetHeight||160;
    let left=Math.max(12,Math.min(window.innerWidth-cw-12,rect.left));
    let top=rect.bottom+10;
    if(top+ch>window.innerHeight-12)top=Math.max(12,rect.top-ch-10);
    currentCard.style.left=left+'px';currentCard.style.top=top+'px';
  }
  function showDescriptor(d){
    if(!enabled()||!d||seen(d.key))return pump();
    const card=document.createElement('aside');
    card.className='fibre-tutorial-card'+(d.welcome?' fibre-tutorial-welcome':'');
    card.setAttribute('role','status');
    card.setAttribute('aria-live','polite');
    if(d.anchor)card.dataset.anchor='1';
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
    card.append(head,text,actions);document.body.appendChild(card);
    currentCard=card;currentDescriptor=d;
    window.addEventListener('resize',positionCurrent,true);window.addEventListener('scroll',positionCurrent,true);
    requestAnimationFrame(positionCurrent);
  }
  function enqueue(d){
    if(!d?.key||seen(d.key)||!enabled())return;
    if(currentDescriptor?.key===d.key||queue.some(x=>x.key===d.key))return;
    queue.push(d);pump();
  }
  function pump(){
    if(currentCard||!enabled())return;
    while(queue.length){const d=queue.shift();if(!seen(d.key)){showDescriptor(d);break}}
  }

  function showWelcome(){
    enqueue({key:'welcome_seen',welcome:true,title:'Bienvenue sur FIBRE OPS 👋',text:'Ton espace est prêt. FIBRE OPS va te guider au fur et à mesure de ton utilisation, uniquement quand tu en as besoin.',actions:[{label:'Commencer 🚀',primary:true}]});
  }
  function showInterventionTip(){
    enqueue({key:'intervention_tip_seen',anchor:document.querySelector('#view-saisie .view-head'),title:'Ta première intervention 🛠️',text:'Renseigne simplement les informations de ton intervention. FIBRE OPS s’occupe ensuite de l’organiser et de mettre à jour ton activité automatiquement.',actions:[{label:'Compris 👍',primary:true}]});
  }
  function showCaptureTip(){
    const cap=document.getElementById('cap-file');
    enqueue({key:'capture_tip_seen',anchor:cap?.closest('.cap-row')||cap?.parentElement,title:'Gagne du temps 📸',text:'La capture est utilisée pour préremplir automatiquement certaines informations de l’intervention.',actions:[{label:'Tester une capture',primary:true,run:()=>setTimeout(()=>document.getElementById('cap-file')?.click(),80)},{label:'Plus tard',primary:false}]});
  }
  function showHistoryTip(){
    enqueue({key:'history_tip_seen',anchor:document.querySelector('#view-historique .view-head'),title:'Ton historique 📋',text:'Toutes tes interventions sont regroupées ici. Tu peux les consulter, rechercher une intervention et retrouver rapidement ton activité passée.',actions:[{label:'Compris',primary:true}]});
  }
  function showDashboardTip(){
    if(!appInterventions().length)return;
    enqueue({key:'dashboard_tip_seen',anchor:document.querySelector('#view-dashboard .dash-head')||document.querySelector('#view-dashboard .view-head'),title:'Ton activité en un coup d’œil 📊',text:'Le tableau de bord utilise tes interventions pour te donner une vue rapide de ton activité et de tes principaux indicateurs. Plus tu utilises FIBRE OPS, plus cette vue devient utile.',actions:[{label:'Continuer',primary:true}]});
  }
  function showSettingsTip(){
    enqueue({key:'settings_tip_seen',anchor:document.querySelector('#settingsOverlay .settings-title'),title:'Ton espace, tes réglages ⚙️',text:'Ici tu peux personnaliser FIBRE OPS : opérateurs, tarifs, préférences et paramètres de ton compte. Tu peux également retrouver l’aide et relancer les conseils depuis cette page.',actions:[{label:'Compris',primary:true}]});
  }
  function showFirstInterventionNotice(){
    if(!enabled()||seen('first_intervention_completed'))return;
    mark('first_intervention_completed',true);
    const n=document.createElement('div');n.className='fibre-tutorial-notice';n.setAttribute('role','status');n.innerHTML='<b>Première intervention enregistrée 🎉</b><span>Elle est maintenant disponible dans ton historique et prise en compte dans ton tableau de bord.</span><button type="button" aria-label="Fermer">✕</button>';
    document.body.appendChild(n);
    const close=()=>n.remove();n.querySelector('button').onclick=close;setTimeout(close,5600);
  }

  function activeView(){return document.querySelector('main > section.view.active')?.id?.replace(/^view-/,'')||''}
  function handleView(){
    if(!loadState()||!enabled())return;
    const v=activeView();if(!v)return;
    if(v!==lastActiveView)lastActiveView=v;
    if(v==='saisie')showInterventionTip();
    else if(v==='historique')showHistoryTip();
    else if(v==='dashboard')showDashboardTip();
  }

  function injectSettings(){
    const grid=document.querySelector('#settingsOverlay .settings-grid');if(!grid||document.getElementById('fibreTutorialSettings'))return;
    const block=document.createElement('div');block.id='fibreTutorialSettings';block.className='setting-block wide fibre-tutorial-settings';
    block.innerHTML=`<h4>🎓 Tutoriel & aide</h4><p>Découvre les fonctionnalités de FIBRE OPS au fur et à mesure de leur utilisation.</p>
      <div class="display-toggle-row"><div class="display-toggle-copy"><b>Tutoriel activé</b><small>Aucune aide contextuelle n’apparaît quand il est désactivé.</small></div><label class="display-switch" aria-label="Tutoriel activé"><input id="fibreTutorialToggle" type="checkbox"><span aria-hidden="true"></span></label></div>
      <div class="fibre-tutorial-settings-actions"><button class="btn-ghost" type="button" id="fibreTutorialReplayTips">Revoir les astuces</button><button class="btn-ghost" type="button" id="fibreTutorialRestart">Recommencer le tutoriel</button></div>`;
    grid.appendChild(block);
    const toggle=block.querySelector('#fibreTutorialToggle');toggle.checked=!!tutorialState?.tutorial_enabled;
    toggle.addEventListener('change',()=>{
      tutorialState.tutorial_enabled=toggle.checked;saveState();
      if(!toggle.checked){queue=[];removeCard(false)}else{maybeWelcome();handleView()}
      try{if(typeof toast==='function')toast(toggle.checked?'Tutoriel activé':'Tutoriel désactivé')}catch{}
    });
    block.querySelector('#fibreTutorialReplayTips').onclick=()=>{
      TIP_KEYS.forEach(k=>tutorialState[k]=false);saveState();queue=[];removeCard(false);handleView();
      try{if(typeof toast==='function')toast('Astuces réinitialisées')}catch{}
    };
    block.querySelector('#fibreTutorialRestart').onclick=()=>{
      Object.assign(tutorialState,{...STATE_DEFAULTS,tutorial_enabled:tutorialState.tutorial_enabled});saveState();queue=[];removeCard(false);maybeWelcome(true);
      try{if(typeof toast==='function')toast('Tutoriel réinitialisé')}catch{}
    };
  }

  function injectBillingGuide(){
    const tabs=document.getElementById('billingSectionTabs');
    const seller=tabs?.querySelector('[data-billing-pane="seller"]');
    const view=document.getElementById('view-facturation');
    if(!tabs||!view||document.getElementById('billingTutorialTab'))return;
    tabs.classList.add('fibre-tutorial-billing-tabs');
    const btn=document.createElement('button');btn.type='button';btn.id='billingTutorialTab';btn.dataset.billingPane='tutorial';btn.textContent='🎓 Guide';
    tabs.insertBefore(btn,seller||null);
    const pane=document.createElement('div');pane.className='billing-v2-pane fibre-tutorial-billing-pane';pane.id='billingPane-tutorial';
    pane.innerHTML=`<div class="card billing-v2-card"><div class="billing-v2-card-head"><div><h3>Guide · Comparer les récapitulatifs</h3><p>Contrôle rapidement le récap FIBRE OPS face au fichier envoyé par ton donneur d’ordre.</p></div><span class="billing-v2-step">Aide</span></div>
      <div class="fibre-tutorial-billing-guide">
        <div class="fibre-tutorial-billing-intro">La comparaison ne modifie aucune intervention : elle sert uniquement à repérer les écarts avant facturation.</div>
        <div class="fibre-billing-guide-steps">
          <div class="fibre-billing-guide-step"><strong>1 · Choisis le mois</strong><span>FIBRE OPS prépare automatiquement ton récap du mois sélectionné.</span></div>
          <div class="fibre-billing-guide-step"><strong>2 · Importe le récap société</strong><span>Utilise le fichier .xlsx ou .csv reçu de ton donneur d’ordre.</span></div>
          <div class="fibre-billing-guide-step"><strong>3 · Vérifie les colonnes</strong><span>Référence et montant sont obligatoires. Typologie, statut et opérateur améliorent le contrôle.</span></div>
          <div class="fibre-billing-guide-step"><strong>4 · Lance la comparaison</strong><span>Les lignes identiques passent en OK ; les différences sont signalées pour vérification.</span></div>
        </div>
        <div class="fibre-billing-guide-demo">
          <div class="fibre-billing-guide-demo-row"><b>0468550601</b><span>36,00 €</span><span>36,00 €</span><span class="ok">OK</span></div>
          <div class="fibre-billing-guide-demo-row"><b>Exemple écart</b><span>160,00 €</span><span>150,00 €</span><span class="bad">À vérifier</span></div>
        </div>
        <div class="fibre-billing-guide-diffs"><span>Intervention manquante</span><span>Montant différent</span><span>Typologie différente</span><span>Statut différent</span><span>Ligne en plus société</span></div>
        <button class="btn-primary" type="button" id="billingTutorialOpenCompare">Ouvrir la comparaison 🔍</button>
      </div></div>`;
    const sellerPane=document.getElementById('billingPane-seller');view.insertBefore(pane,sellerPane||null);
    btn.addEventListener('click',()=>{try{if(typeof billingShowPane==='function')billingShowPane('tutorial')}catch{}});
    pane.querySelector('#billingTutorialOpenCompare').addEventListener('click',()=>{try{if(typeof billingShowPane==='function')billingShowPane('reconcile')}catch{document.querySelector('[data-billing-pane="reconcile"]')?.click()}});
  }

  function maybeWelcome(force=false){
    if(!loadState()||!enabled()||seen('welcome_seen'))return;
    const p=appProfile();
    const app=document.getElementById('appShell'),ob=document.getElementById('onboardingGate');
    if(!p?.onboarding_completed||!app||app.classList.contains('app-hidden')||!ob?.classList.contains('app-hidden'))return;
    clearTimeout(welcomeTimer);welcomeTimer=setTimeout(()=>{if(force||enabled())showWelcome()},force?40:450);
  }

  function observeToast(){
    const t=document.getElementById('toast');if(!t)return;
    const check=()=>{const text=t.textContent||'';if(/Intervention(?:\s+\S+)?\s+enregistrée/i.test(text))showFirstInterventionNotice()};
    new MutationObserver(check).observe(t,{childList:true,subtree:true,characterData:true});
  }
  function observeUi(){
    const main=document.querySelector('main');if(main)new MutationObserver(()=>handleView()).observe(main,{subtree:true,attributes:true,attributeFilter:['class']});
    const settings=document.getElementById('settingsOverlay');if(settings)new MutationObserver(()=>{if(settings.classList.contains('active')){injectSettings();showSettingsTip()}}).observe(settings,{attributes:true,attributeFilter:['class']});
    const app=document.getElementById('appShell'),ob=document.getElementById('onboardingGate');
    const watcher=new MutationObserver(()=>{if(loadState()){injectSettings();injectBillingGuide();maybeWelcome();handleView()}});
    if(app)watcher.observe(app,{attributes:true,attributeFilter:['class']});if(ob)watcher.observe(ob,{attributes:true,attributeFilter:['class']});
    document.getElementById('settingsBtn')?.addEventListener('click',()=>setTimeout(()=>{injectSettings();showSettingsTip()},30));
    const cap=document.getElementById('cap-file')?.closest('label');
    if(cap){cap.addEventListener('mouseenter',showCaptureTip,{passive:true});cap.addEventListener('touchstart',showCaptureTip,{passive:true})}
  }

  function bootTutorial(){
    if(!loadState()){setTimeout(bootTutorial,250);return}
    injectSettings();injectBillingGuide();observeToast();observeUi();maybeWelcome();handleView();
    setInterval(()=>{if(loadState()){injectSettings();injectBillingGuide();maybeWelcome();handleView()}},1200);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootTutorial,{once:true});else bootTutorial();
})();
