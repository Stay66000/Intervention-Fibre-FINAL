(function(){
  'use strict';

  const SHEETS_URL='https://script.google.com/macros/s/AKfycbxyJrikE3tF9uaiuMmJtGq8OafETWuLX354Zv6gufGWKX26NXxPNMMFX7p--rlIMWak1Q/exec';
  const TECH='Brendan';
  const OUTBOX_KEY='fibre_ops_sheets_test_outbox_v1';
  const ENABLED_KEY='fibre_ops_sheets_test_enabled_v1';
  const nativeFetch=window.fetch.bind(window);
  let outbox=readJson(OUTBOX_KEY,[]);
  let flushing=false;
  let enabled=localStorage.getItem(ENABLED_KEY)!=='0';
  let lastCheck=null;
  let ui=null;

  function readJson(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch{return fallback}}
  function saveOutbox(){try{localStorage.setItem(OUTBOX_KEY,JSON.stringify(outbox))}catch{}}
  function operatorLabel(op){try{return typeof opLabel==='function'?opLabel(op):String(op||'')}catch{return String(op||'')}}
  function memberFirstName(uid){
    try{
      const m=(teamMembers||[]).find(x=>x.id===uid);
      if(m&&m.first_name)return m.first_name;
      if(uid===user?.id&&profile?.first_name)return profile.first_name;
    }catch{}
    return TECH;
  }
  function canUseBridge(){
    try{return !!profile&&['admin','platform_admin'].includes(profile.role)}catch{return false}
  }
  function personalIntervention(e){return !!e&&!e.companyId&&!e.readOnlyHistory}
  function personalFuel(f){return !!f&&!f.companyId}

  function interventionBody(e,action='',oldNum=''){
    const body={
      id:e.id,
      num:e.num||'',
      date:e.date||'',
      addr:e.addr||'',
      typo:e.typo||'',
      statut:e.statut||'Réussite',
      op:operatorLabel(e.op),
      solo:e.workMode==='Binôme'?'Binôme':'Solo',
      techSolo:memberFirstName(e.soloUserId||e.userId),
      apie:false,
      montant:Number(e.montant)||0,
      comment:e.comment||'',
      tech:TECH
    };
    if(action)body.action=action;
    if(oldNum)body.oldNum=oldNum;
    return body;
  }
  function fuelBody(f,action=''){
    const body={type:'fuel',id:f.id,date:f.date||'',montant:Number(f.montant)||0,tech:memberFirstName(f.paidByUserId||f.userId),comment:f.comment||f.station||''};
    if(action)body.action=action;
    return body;
  }

  function render(message=''){
    if(!ui)return;
    ui.block.style.display=canUseBridge()?'block':'none';
    if(!canUseBridge())return;
    ui.state.textContent=enabled?'Copie Sheets active':'Copie Sheets désactivée';
    ui.toggle.textContent=enabled?'Désactiver':'Activer';
    if(message)ui.detail.textContent=message;
    else if(!navigator.onLine)ui.detail.textContent=`Hors-ligne${outbox.length?` · ${outbox.length} en attente`:''}`;
    else if(outbox.length)ui.detail.textContent=`${outbox.length} opération(s) en attente d’envoi`;
    else if(lastCheck)ui.detail.textContent=`Sheet joignable · vérifié à ${lastCheck.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
    else ui.detail.textContent='Mode test lié au Google Sheet de l’ancienne application.';
  }

  function ensureUI(){
    if(document.getElementById('legacySheetsTestBlock'))return bindUI();
    const grid=document.querySelector('#settingsOverlay .settings-grid');
    if(!grid)return false;
    const block=document.createElement('div');
    block.className='setting-block wide';
    block.id='legacySheetsTestBlock';
    block.innerHTML=`
      <h4>🧪 Google Sheets secours · TEST</h4>
      <p>Supabase reste principal. Les nouvelles interventions et les pleins personnels sont aussi envoyés vers le Sheet de l’ancienne app.</p>
      <div class="setting-row" style="gap:10px;align-items:flex-start">
        <div><b id="legacySheetsTestState">Initialisation…</b><div class="field-hint" id="legacySheetsTestDetail" style="margin:4px 0 0">Connexion au Sheet…</div></div>
        <button class="btn-ghost" id="legacySheetsTestToggle" type="button">Désactiver</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button class="btn-ghost" id="legacySheetsTestCheck" type="button">Vérifier le Sheet</button>
        <button class="btn-ghost" id="legacySheetsTestCompare" type="button">Comparer</button>
      </div>
      <div class="field-hint" style="margin-top:8px">Test sécurisé : la lecture du Sheet ne remplace pas automatiquement Supabase. Les données société ne sont jamais copiées.</div>`;
    const install=document.getElementById('installAppBlock');
    if(install&&install.parentNode===grid)grid.insertBefore(block,install.nextSibling);else grid.appendChild(block);
    return bindUI();
  }

  function bindUI(){
    ui={
      block:document.getElementById('legacySheetsTestBlock'),
      state:document.getElementById('legacySheetsTestState'),
      detail:document.getElementById('legacySheetsTestDetail'),
      toggle:document.getElementById('legacySheetsTestToggle'),
      check:document.getElementById('legacySheetsTestCheck'),
      compare:document.getElementById('legacySheetsTestCompare')
    };
    if(!ui.block)return false;
    ui.toggle.onclick=()=>{enabled=!enabled;localStorage.setItem(ENABLED_KEY,enabled?'1':'0');render();if(enabled){flush();check(false)}if(typeof toast==='function')toast(enabled?'✅ Copie Sheets activée':'Copie Sheets désactivée')};
    ui.check.onclick=()=>check(true);
    ui.compare.onclick=()=>compare();
    render();
    return true;
  }

  function queue(body){
    if(!enabled||!canUseBridge()||!body)return;
    outbox.push({body,queued_at:new Date().toISOString()});
    saveOutbox();render();flush();
  }

  async function flush(){
    if(flushing||!enabled||!navigator.onLine||!outbox.length||!canUseBridge())return;
    flushing=true;render('Envoi vers Google Sheets…');
    try{
      while(outbox.length){
        await nativeFetch(SHEETS_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify(outbox[0].body)});
        outbox.shift();saveOutbox();
      }
      render('Google Sheets à jour · Supabase reste principal.');
    }catch{
      render(`Sheets indisponible · ${outbox.length} opération(s) conservée(s) localement`);
    }finally{flushing=false}
  }

  async function getSheet(query){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),15000);
    try{
      const r=await nativeFetch(SHEETS_URL+'?'+query+'&_t='+Date.now(),{cache:'no-store',signal:ctl.signal});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      if(!Array.isArray(data))throw new Error('Format inattendu');
      return data;
    }finally{clearTimeout(timer)}
  }

  async function check(showToast){
    if(!canUseBridge())return;
    render('Lecture du Google Sheet…');
    if(ui?.check){ui.check.disabled=true;ui.check.textContent='Vérification…'}
    try{
      const [ints,fuels]=await Promise.all([getSheet('tech='+encodeURIComponent(TECH)),getSheet('type=fuel')]);
      lastCheck=new Date();
      render(`Sheet joignable · ${ints.length} intervention(s) · ${fuels.length} plein(s)`);
      if(showToast&&typeof toast==='function')toast(`✅ Sheets OK · ${ints.length} inter · ${fuels.length} pleins`);
      return {ints,fuels};
    }catch(e){
      render('Impossible de lire le Sheet pour le moment. La file d’attente locale reste conservée.');
      if(showToast&&typeof toast==='function')toast('Google Sheets indisponible pour le moment');
      return null;
    }finally{if(ui?.check){ui.check.disabled=false;ui.check.textContent='Vérifier le Sheet'}}
  }

  function normRef(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'')}
  async function compare(){
    const data=await check(false);if(!data)return;
    let local=[];try{local=(interventions||[]).filter(personalIntervention)}catch{}
    const localKeys=new Set(local.map(e=>`${e.date}|${normRef(e.num)}|${operatorLabel(e.op).toLowerCase()}`));
    const sheetKeys=new Set(data.ints.map(e=>`${String(e.date||'').slice(0,10)}|${normRef(e.num)}|${String(e.op||'').toLowerCase()}`));
    let sheetOnly=0,localOnly=0;
    for(const k of sheetKeys)if(!localKeys.has(k))sheetOnly++;
    for(const k of localKeys)if(!sheetKeys.has(k))localOnly++;
    render(`Comparaison · ${sheetOnly} seulement dans Sheets · ${localOnly} seulement dans Supabase`);
    if(typeof toast==='function')toast(`Comparaison : Sheets +${sheetOnly} · Supabase +${localOnly}`);
  }

  function urlString(input){try{return typeof input==='string'?input:String(input?.url||input||'')}catch{return ''}}
  function methodOf(init){return String(init?.method||'GET').toUpperCase()}
  function parseBody(init){try{return init?.body?JSON.parse(init.body):null}catch{return null}}
  function idFromUrl(url){try{const u=new URL(url,location.href),v=u.searchParams.get('id');return v&&v.startsWith('eq.')?decodeURIComponent(v.slice(3)):''}catch{return ''}}

  window.fetch=async function(input,init){
    const url=urlString(input),method=methodOf(init),isSupabase=url.includes('.supabase.co/');
    if(!isSupabase)return nativeFetch(input,init);

    const body=parseBody(init);
    let beforeIntervention=null,beforeFuel=null;
    let targetId='';
    try{
      if(url.includes('/rest/v1/rpc/delete_my_intervention')){
        targetId=body?.p_intervention_id||'';
        beforeIntervention=(interventions||[]).find(x=>x.id===targetId)||null;
      }else if(url.includes('/rest/v1/interventions')){
        targetId=idFromUrl(url);
        if(targetId)beforeIntervention=(interventions||[]).find(x=>x.id===targetId)||null;
      }else if(url.includes('/rest/v1/fuel_expenses')){
        targetId=idFromUrl(url);
        if(targetId)beforeFuel=(fuel||[]).find(x=>x.id===targetId)||null;
      }
    }catch{}

    const response=await nativeFetch(input,init);
    if(!response.ok||!enabled||!canUseBridge())return response;

    try{
      if(url.includes('/rest/v1/rpc/delete_my_intervention')&&method==='POST'&&personalIntervention(beforeIntervention)){
        queue(interventionBody(beforeIntervention,'delete'));
      }else if(url.includes('/rest/v1/interventions')&&method==='POST'&&body&&!body.company_id){
        const signature={date:body.intervention_date||'',num:body.reference||'',op:body.operator||''};
        setTimeout(()=>{
          try{
            const candidates=(interventions||[]).filter(personalIntervention).filter(e=>e.date===signature.date&&(e.num||'')===signature.num&&e.op===signature.op);
            const e=candidates.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
            if(e)queue(interventionBody(e));
          }catch{}
        },1200);
      }else if(url.includes('/rest/v1/interventions')&&(method==='PATCH'||method==='PUT')&&personalIntervention(beforeIntervention)){
        const oldNum=beforeIntervention.num||'';
        setTimeout(()=>{try{const e=(interventions||[]).find(x=>x.id===beforeIntervention.id);if(e)queue(interventionBody(e,'update',oldNum))}catch{}},1200);
      }else if(url.includes('/rest/v1/fuel_expenses')&&method==='POST'&&body&&!body.company_id){
        const signature={date:body.expense_date||'',amount:Number(body.amount)||0,station:body.station||''};
        setTimeout(()=>{
          try{
            const candidates=(fuel||[]).filter(personalFuel).filter(f=>f.date===signature.date&&Number(f.montant)===signature.amount&&(f.station||f.comment||'')===signature.station);
            const f=candidates[candidates.length-1];if(f)queue(fuelBody(f));
          }catch{}
        },700);
      }else if(url.includes('/rest/v1/fuel_expenses')&&(method==='PATCH'||method==='PUT')&&personalFuel(beforeFuel)){
        setTimeout(()=>{try{const f=(fuel||[]).find(x=>x.id===beforeFuel.id);if(f)queue(fuelBody(f,'update_fuel'))}catch{}},500);
      }else if(url.includes('/rest/v1/fuel_expenses')&&method==='DELETE'&&personalFuel(beforeFuel)){
        queue(fuelBody(beforeFuel,'delete_fuel'));
      }
    }catch(e){console.warn('[Sheets bridge]',e)}
    return response;
  };

  function start(){
    if(!ensureUI()){setTimeout(start,400);return}
    let ready=false;try{ready=!!profile&&!!user}catch{}
    if(!ready){render('Attente de la connexion FIBRE OPS…');setTimeout(start,500);return}
    render('Connexion au Google Sheet…');
    flush();
    setTimeout(()=>check(false),500);
  }

  window.addEventListener('online',()=>{render();flush();check(false)});
  window.addEventListener('offline',()=>render());
  start();
})();
