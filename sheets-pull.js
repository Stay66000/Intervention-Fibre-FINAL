(function(){
  'use strict';

  const SHEETS_URL='https://script.google.com/macros/s/AKfycbxyJrikE3tF9uaiuMmJtGq8OafETWuLX354Zv6gufGWKX26NXxPNMMFX7p--rlIMWak1Q/exec';
  const TECH='Brendan';
  let running=false,lastRun=0,timer=null,uiBtn=null,uiStatus=null;

  const normText=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const normRef=v=>String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  function normDate(v){
    const s=String(v||'').trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    const d=new Date(s);if(Number.isNaN(d.getTime()))return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function resultValue(v){return /echec|échec/i.test(String(v||''))?'Échec':'Réussite'}
  function operatorLabel(op){try{return typeof opLabel==='function'?opLabel(op):String(op||'')}catch{return String(op||'')}}
  function resolveOperator(v){
    const n=normText(v);
    try{return (operators||[]).find(o=>normText(o.operator)===n||normText(operatorLabel(o.operator))===n)?.operator||''}catch{return ''}
  }
  function resolveType(op,name){
    const n=normText(name);
    try{return (types||[]).find(t=>t.operator===op&&normText(t.name)===n&&t.active!==false)||null}catch{return null}
  }
  function canSync(){
    try{return !!user&&!!profile&&['admin','platform_admin'].includes(profile.role)&&!currentCompanyId()&&!hasTeam()}catch{return false}
  }
  function setStatus(text){if(uiStatus)uiStatus.textContent=text}
  function techOk(row){try{return !row?.tech||normText(row.tech)===normText(profile?.first_name||TECH)}catch{return true}}
  function fuelMarker(id){return id?`[FIBRE_OPS_SHEET_ID:${String(id)}]`:''}
  function legacyFuelId(row){const m=String(row?.notes||'').match(/\[FIBRE_OPS_SHEET_ID:([^\]]+)\]/);return m?m[1]:''}

  async function getSheet(query){
    const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),15000);
    try{
      const r=await fetch(SHEETS_URL+'?'+query+'&_t='+Date.now(),{cache:'no-store',signal:ctl.signal});
      if(!r.ok)throw new Error('Sheets HTTP '+r.status);
      const data=await r.json();
      if(!Array.isArray(data))throw new Error('Format Sheets invalide');
      return data;
    }finally{clearTimeout(to)}
  }

  function personalInterventions(){
    try{return (interventions||[]).filter(e=>!e.companyId&&!e.readOnlyHistory&&!e.teamId)}catch{return []}
  }
  function personalFuel(){
    try{return (fuel||[]).filter(f=>!f.companyId&&!f.teamId)}catch{return []}
  }

  async function syncInterventions(rows){
    const locals=personalInterventions();
    const exact=new Map(),byRefOp=new Map(),byRefCandidates=new Map();
    for(const e of locals){
      const ref=normRef(e.num),op=normText(operatorLabel(e.op));
      exact.set(`${normDate(e.date)}|${ref}|${op}`,e);
      if(ref)byRefOp.set(`${ref}|${op}`,e);
      if(ref){const a=byRefCandidates.get(ref)||[];a.push(e);byRefCandidates.set(ref,a)}
    }
    let added=0,updated=0,skipped=0;
    for(const raw of rows){
      const date=normDate(raw.date),op=resolveOperator(raw.op),type=resolveType(op,raw.typo),ref=normRef(raw.num);
      if(!date||!op||!type){skipped++;continue}
      const opN=normText(operatorLabel(op));
      let local=exact.get(`${date}|${ref}|${opN}`)||byRefOp.get(`${ref}|${opN}`)||null;
      if(!local&&ref&&(byRefCandidates.get(ref)||[]).length===1)local=byRefCandidates.get(ref)[0];
      const desired={
        intervention_date:date,
        operator:op,
        intervention_type_id:type.id,
        result:resultValue(raw.statut),
        reference:String(raw.num||'').trim()||null,
        address:String(raw.addr||'').trim()||null,
        notes:String(raw.comment||'').trim()||null
      };
      if(!local){
        const payload={user_id:user.id,company_id:null,team_id:null,work_mode:'Personal',solo_user_id:user.id,...desired,operator_data:{legacy_sheet_id:String(raw.id||'')||null,legacy_sheet_sync:true}};
        const {data,error}=await supabase.from('interventions').insert(payload).select('id').single();
        if(error)throw error;
        const shadow={id:data?.id||'',date,op,typeId:type.id,statut:desired.result,num:String(raw.num||''),addr:String(raw.addr||''),comment:String(raw.comment||''),companyId:null,teamId:null,readOnlyHistory:false};
        exact.set(`${date}|${ref}|${opN}`,shadow);if(ref)byRefOp.set(`${ref}|${opN}`,shadow);
        added++;continue;
      }
      const patch={};
      if(normDate(local.date)!==date)patch.intervention_date=date;
      if(local.op!==op)patch.operator=op;
      if(String(local.typeId||'')!==String(type.id))patch.intervention_type_id=type.id;
      if(String(local.statut||'Réussite')!==desired.result)patch.result=desired.result;
      if(String(local.num||'')!==String(raw.num||''))patch.reference=desired.reference;
      if(String(local.addr||'')!==String(raw.addr||''))patch.address=desired.address;
      if(String(local.comment||'')!==String(raw.comment||''))patch.notes=desired.notes;
      if(Object.keys(patch).length){
        const {error}=await supabase.from('interventions').update(patch).eq('id',local.id);
        if(error)throw error;
        updated++;
      }
    }
    return {added,updated,skipped};
  }

  async function syncFuel(rows){
    const wanted=rows.filter(techOk),locals=personalFuel(),byLegacy=new Map(),byKey=new Map();
    for(const f of locals){
      const legacy=legacyFuelId(f);if(legacy)byLegacy.set(legacy,f);
      byKey.set(`${normDate(f.date)}|${Number(f.montant)||0}|${normText(f.station||f.comment||'')}`,f);
    }
    let added=0,updated=0,skipped=0;
    for(const raw of wanted){
      const date=normDate(raw.date),amount=Number(raw.montant)||0,comment=String(raw.comment||'').trim(),legacy=String(raw.id||'');
      if(!date||amount<=0){skipped++;continue}
      let local=(legacy&&byLegacy.get(legacy))||byKey.get(`${date}|${amount}|${normText(comment)}`)||null;
      if(!local){
        const {data,error}=await supabase.from('fuel_expenses').insert({user_id:user.id,company_id:null,team_id:null,paid_by_user_id:user.id,expense_date:date,amount,station:comment||'Import Google Sheets',notes:fuelMarker(legacy)||null}).select('id').single();
        if(error)throw error;
        local={id:data?.id||'',date,montant:amount,station:comment||'Import Google Sheets',comment:comment||'Import Google Sheets',notes:fuelMarker(legacy),companyId:null,teamId:null};
        if(legacy)byLegacy.set(legacy,local);byKey.set(`${date}|${amount}|${normText(comment)}`,local);added++;continue;
      }
      const patch={};
      if(normDate(local.date)!==date)patch.expense_date=date;
      if(Number(local.montant)!==amount)patch.amount=amount;
      if(String(local.station||local.comment||'')!==(comment||'Import Google Sheets'))patch.station=comment||'Import Google Sheets';
      if(legacy&&legacyFuelId(local)!==legacy)patch.notes=fuelMarker(legacy);
      if(Object.keys(patch).length){
        const {error}=await supabase.from('fuel_expenses').update(patch).eq('id',local.id);
        if(error)throw error;
        updated++;
      }
    }
    return {added,updated,skipped};
  }

  async function sync(showToast=false){
    if(running||!navigator.onLine||!canSync())return;
    running=true;lastRun=Date.now();
    if(uiBtn){uiBtn.disabled=true;uiBtn.textContent='Synchronisation…'}
    setStatus('Lecture de Google Sheets…');
    try{
      const [sheetInts,sheetFuel]=await Promise.all([getSheet('tech='+encodeURIComponent(TECH)),getSheet('type=fuel')]);
      const ints=await syncInterventions(sheetInts),fuels=await syncFuel(sheetFuel);
      const changes=ints.added+ints.updated+fuels.added+fuels.updated,skipped=ints.skipped+fuels.skipped;
      if(changes){await loadAll();renderAll()}
      setStatus(changes
        ? `Sheets → FIBRE OPS : +${ints.added} inter, ${ints.updated} maj, +${fuels.added} plein, ${fuels.updated} maj${skipped?` · ${skipped} ignoré(s)`:''}`
        : `Sheets → FIBRE OPS : déjà à jour${skipped?` · ${skipped} ligne(s) incompatible(s)`:''}`);
      if(showToast&&typeof toast==='function')toast(changes?'✅ Import Sheets terminé':'✅ Sheets déjà synchronisé');
    }catch(e){
      console.warn('[Sheets pull]',e);
      const msg=String(e?.message||e||'Erreur inconnue').slice(0,150);
      setStatus('Erreur Sheets → FIBRE OPS : '+msg);
      if(showToast&&typeof toast==='function')toast('Erreur import Sheets : '+msg);
    }finally{
      running=false;if(uiBtn){uiBtn.disabled=false;uiBtn.textContent='↩ Importer Sheets → FIBRE OPS'}
    }
  }

  function ensureUi(){
    const block=document.getElementById('legacySheetsTestBlock');if(!block)return false;
    const h=block.querySelector('h4');if(h)h.textContent='🧪 Google Sheets secours · TEST BIDIRECTIONNEL';
    const p=block.querySelector('p');if(p)p.textContent='FIBRE OPS envoie vers Supabase + Sheets. Cette version récupère aussi les ajouts/modifications du Sheet vers ton espace personnel.';
    let box=document.getElementById('legacySheetsPullBox');
    if(!box){box=document.createElement('div');box.id='legacySheetsPullBox';box.style.marginTop='10px';box.innerHTML='<button class="btn-primary" id="legacySheetsPullBtn" type="button" style="width:100%">↩ Importer Sheets → FIBRE OPS</button><div class="field-hint" id="legacySheetsPullStatus" style="margin-top:7px"></div>';block.appendChild(box)}
    uiBtn=document.getElementById('legacySheetsPullBtn');uiStatus=document.getElementById('legacySheetsPullStatus');uiBtn.onclick=()=>sync(true);return true;
  }

  function start(){
    if(!ensureUi()){setTimeout(start,400);return}
    if(!canSync()){setStatus('Import réservé au compte principal dans son espace personnel solo.');setTimeout(start,900);return}
    setStatus('Synchro automatique active · contrôle toutes les 2 min · aucune requête Supabase si rien ne change.');
    setTimeout(()=>sync(false),700);
    if(!timer)timer=setInterval(()=>{if(!document.hidden&&Date.now()-lastRun>90000)sync(false)},120000);
  }

  window.addEventListener('online',()=>sync(false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRun>60000)sync(false)});
  start();
})();