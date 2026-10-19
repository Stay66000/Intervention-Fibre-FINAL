(function(){
  'use strict';

  const SHEETS_URL='https://script.google.com/macros/s/AKfycbxyJrikE3tF9uaiuMmJtGq8OafETWuLX354Zv6gufGWKX26NXxPNMMFX7p--rlIMWak1Q/exec';
  const TECH='Brendan';
  const nativeFetch=window.fetch.bind(window);
  let running=false,lastRun=0,timer=null,uiBtn=null,uiStatus=null;

  function normText(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
  function normDate(v){
    const s=String(v||'').trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    const d=new Date(s);
    return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function normRef(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'')}
  function resultValue(v){return /echec|échec/i.test(String(v||''))?'Échec':'Réussite'}
  function techOk(row){return !row?.tech||normText(row.tech)===normText(profile?.first_name||TECH)}
  function operatorLabel(op){try{return typeof opLabel==='function'?opLabel(op):String(op||'')}catch{return String(op||'')}}
  function resolveOperator(v){
    const n=normText(v);
    return (operators||[]).find(o=>normText(o.operator)===n||normText(operatorLabel(o.operator))===n)?.operator||'';
  }
  function resolveType(op,name){
    const n=normText(name);
    return (types||[]).find(t=>t.operator===op&&normText(t.name)===n)||null;
  }
  function interventionKey(x,op){
    return `${normDate(x.date||x.intervention_date)}|${normRef(x.num||x.reference)}|${normText(operatorLabel(op||x.op||x.operator))}`;
  }
  function legacyFuelId(row){
    const m=String(row?.notes||'').match(/\[FIBRE_OPS_SHEET_ID:([^\]]+)\]/);
    return m?m[1]:'';
  }
  function fuelMarker(id){return id?`[FIBRE_OPS_SHEET_ID:${String(id)}]`:''}
  function canSync(){
    try{return !!user&&!!profile&&['admin','platform_admin'].includes(profile.role)&&!currentCompanyId()&&!hasTeam()}catch{return false}
  }
  function setStatus(text){
    if(uiStatus)uiStatus.textContent=text;
  }

  async function getSheet(query){
    const ctl=new AbortController();
    const to=setTimeout(()=>ctl.abort(),15000);
    try{
      const r=await nativeFetch(SHEETS_URL+'?'+query+'&_t='+Date.now(),{cache:'no-store',signal:ctl.signal});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json();
      if(!Array.isArray(data))throw new Error('Format Sheets invalide');
      return data;
    }finally{clearTimeout(to)}
  }

  async function authHeaders(){
    const {data,error}=await supabase.auth.getSession();
    if(error||!data?.session?.access_token)throw new Error('Session Supabase introuvable');
    return {
      'apikey':SUPABASE_KEY,
      'Authorization':'Bearer '+data.session.access_token,
      'Content-Type':'application/json'
    };
  }

  async function rest(path,{method='GET',body=null,prefer='return=representation'}={}){
    const headers=await authHeaders();
    if(prefer)headers['Prefer']=prefer;
    const r=await nativeFetch(SUPABASE_URL+'/rest/v1/'+path,{
      method,headers,cache:'no-store',body:body===null?undefined:JSON.stringify(body)
    });
    const text=await r.text();
    let data=null;
    if(text){try{data=JSON.parse(text)}catch{data=text}}
    if(!r.ok)throw new Error(typeof data==='object'&&(data?.message||data?.details)?(data.message||data.details):('HTTP '+r.status));
    return data;
  }

  async function loadPersonal(){
    const uid=encodeURIComponent(user.id);
    const intSelect=encodeURIComponent('id,user_id,company_id,team_id,intervention_date,operator,intervention_type_id,intervention_type_name,result,reference,address,notes,operator_data,created_at');
    const fuelSelect=encodeURIComponent('id,user_id,company_id,team_id,paid_by_user_id,expense_date,amount,station,notes,created_at');
    const [ints,fuels]=await Promise.all([
      rest(`interventions?select=${intSelect}&user_id=eq.${uid}&company_id=is.null&team_id=is.null`,{prefer:''}),
      rest(`fuel_expenses?select=${fuelSelect}&user_id=eq.${uid}&company_id=is.null&team_id=is.null`,{prefer:''})
    ]);
    return {ints:Array.isArray(ints)?ints:[],fuels:Array.isArray(fuels)?fuels:[]};
  }

  async function syncInterventions(sheetRows,localRows){
    const byId=new Map(localRows.map(r=>[String(r.id),r])),byLegacy=new Map(),byKey=new Map();
    localRows.forEach(r=>{
      const legacy=r.operator_data&&typeof r.operator_data==='object'?String(r.operator_data.legacy_sheet_id||''):'';
      if(legacy)byLegacy.set(legacy,r);
      byKey.set(interventionKey({date:r.intervention_date,num:r.reference,operator:r.operator},r.operator),r);
    });
    let added=0,updated=0,skipped=0;
    for(const raw of sheetRows){
      const date=normDate(raw.date),op=resolveOperator(raw.op),type=resolveType(op,raw.typo),legacyId=String(raw.id||'');
      if(!date||!op||!type){skipped++;continue}
      const key=interventionKey({date,num:raw.num,op},op);
      let local=(legacyId&&byId.get(legacyId))||(legacyId&&byLegacy.get(legacyId))||byKey.get(key)||null;
      if(!local){
        const rows=await rest('interventions',{
          method:'POST',
          body:{
            user_id:user.id,company_id:null,team_id:null,work_mode:'Personal',solo_user_id:user.id,
            intervention_date:date,operator:op,intervention_type_id:type.id,result:resultValue(raw.statut),
            reference:String(raw.num||'').trim()||null,address:String(raw.addr||'').trim()||null,
            notes:String(raw.comment||'').trim()||null,
            operator_data:{legacy_sheet_id:legacyId||null,legacy_sheet_sync:true}
          }
        });
        local=Array.isArray(rows)?rows[0]:rows;
        if(local){localRows.push(local);byId.set(String(local.id),local);if(legacyId)byLegacy.set(legacyId,local);byKey.set(key,local)}
        added++;
        continue;
      }

      const patch={};
      if(String(local.intervention_date||'')!==date)patch.intervention_date=date;
      if(String(local.reference||'')!==String(raw.num||''))patch.reference=String(raw.num||'').trim()||null;
      if(String(local.address||'')!==String(raw.addr||''))patch.address=String(raw.addr||'').trim()||null;
      if(String(local.notes||'')!==String(raw.comment||''))patch.notes=String(raw.comment||'').trim()||null;
      if(legacyId&&String(local.id)!==legacyId){
        const meta=local.operator_data&&typeof local.operator_data==='object'?local.operator_data:{};
        if(String(meta.legacy_sheet_id||'')!==legacyId)patch.operator_data={...meta,legacy_sheet_id:legacyId,legacy_sheet_sync:true};
      }
      if(Object.keys(patch).length){
        const rows=await rest(`interventions?id=eq.${encodeURIComponent(local.id)}`,{method:'PATCH',body:patch});
        const fresh=Array.isArray(rows)?rows[0]:rows;if(fresh)Object.assign(local,fresh);
        updated++;
      }
    }
    return {added,updated,skipped};
  }

  async function syncFuel(sheetRows,localRows){
    const rowsWanted=sheetRows.filter(techOk),byId=new Map(localRows.map(r=>[String(r.id),r])),byLegacy=new Map(),byKey=new Map();
    localRows.forEach(r=>{
      const legacy=legacyFuelId(r);if(legacy)byLegacy.set(legacy,r);
      byKey.set(`${normDate(r.expense_date)}|${Number(r.amount)||0}|${normText(r.station||'')}`,r);
    });
    let added=0,updated=0,skipped=0;
    for(const raw of rowsWanted){
      const date=normDate(raw.date),amount=Number(raw.montant)||0,legacyId=String(raw.id||''),comment=String(raw.comment||'').trim();
      if(!date||amount<=0){skipped++;continue}
      const key=`${date}|${amount}|${normText(comment)}`;
      let local=(legacyId&&byId.get(legacyId))||(legacyId&&byLegacy.get(legacyId))||byKey.get(key)||null;
      if(!local){
        const rows=await rest('fuel_expenses',{
          method:'POST',
          body:{
            user_id:user.id,company_id:null,team_id:null,paid_by_user_id:user.id,
            expense_date:date,amount,station:comment||'Import Google Sheets',notes:fuelMarker(legacyId)||null
          }
        });
        local=Array.isArray(rows)?rows[0]:rows;
        if(local){localRows.push(local);byId.set(String(local.id),local);if(legacyId)byLegacy.set(legacyId,local);byKey.set(key,local)}
        added++;
        continue;
      }
      const patch={};
      if(String(local.expense_date||'')!==date)patch.expense_date=date;
      if(Number(local.amount)!==amount)patch.amount=amount;
      if(String(local.station||'')!==(comment||'Import Google Sheets'))patch.station=comment||'Import Google Sheets';
      if(legacyId&&String(local.id)!==legacyId&&legacyFuelId(local)!==legacyId)patch.notes=fuelMarker(legacyId);
      if(Object.keys(patch).length){
        const rows=await rest(`fuel_expenses?id=eq.${encodeURIComponent(local.id)}`,{method:'PATCH',body:patch});
        const fresh=Array.isArray(rows)?rows[0]:rows;if(fresh)Object.assign(local,fresh);
        updated++;
      }
    }
    return {added,updated,skipped};
  }

  async function sync(showToast=false){
    if(running||!navigator.onLine||!canSync())return;
    running=true;lastRun=Date.now();
    if(uiBtn){uiBtn.disabled=true;uiBtn.textContent='Synchronisation…'}
    setStatus('Lecture du Sheet et comparaison avec Supabase…');
    try{
      const [sheetInts,sheetFuel,local]=await Promise.all([
        getSheet('tech='+encodeURIComponent(TECH)),
        getSheet('type=fuel'),
        loadPersonal()
      ]);
      const ints=await syncInterventions(sheetInts,local.ints);
      const fuels=await syncFuel(sheetFuel,local.fuels);
      const changes=ints.added+ints.updated+fuels.added+fuels.updated;
      const skipped=ints.skipped+fuels.skipped;
      if(changes){
        await loadAll();
        renderAll();
      }
      const text=changes
        ? `Sheets → FIBRE OPS : +${ints.added} inter, ${ints.updated} maj, +${fuels.added} plein, ${fuels.updated} maj${skipped?` · ${skipped} ignoré(s)`:''}`
        : `Sheets → FIBRE OPS : déjà à jour${skipped?` · ${skipped} ligne(s) non compatible(s)`:''}`;
      setStatus(text);
      if(showToast&&typeof toast==='function')toast(changes?'✅ Import Sheets terminé':'✅ Sheets déjà synchronisé');
    }catch(e){
      console.warn('[Sheets pull]',e);
      setStatus('Sheets → FIBRE OPS indisponible pour le moment.');
      if(showToast&&typeof toast==='function')toast('Erreur import Sheets → FIBRE OPS');
    }finally{
      running=false;
      if(uiBtn){uiBtn.disabled=false;uiBtn.textContent='↩ Importer Sheets → FIBRE OPS'}
    }
  }

  function ensureUi(){
    const block=document.getElementById('legacySheetsTestBlock');
    if(!block)return false;
    const h=block.querySelector('h4');if(h)h.textContent='🧪 Google Sheets secours · TEST BIDIRECTIONNEL';
    const p=block.querySelector('p');if(p)p.textContent='Netlify envoie vers Supabase + Sheets, et le mode test récupère aussi automatiquement les ajouts/modifications du Sheet vers ton espace personnel.';
    let box=document.getElementById('legacySheetsPullBox');
    if(!box){
      box=document.createElement('div');box.id='legacySheetsPullBox';box.style.marginTop='10px';
      box.innerHTML='<button class="btn-primary" id="legacySheetsPullBtn" type="button" style="width:100%">↩ Importer Sheets → FIBRE OPS</button><div class="field-hint" id="legacySheetsPullStatus" style="margin-top:7px">Import automatique au démarrage et toutes les 60 s. Les suppressions depuis Sheets restent désactivées pendant le test.</div>';
      block.appendChild(box);
    }
    uiBtn=document.getElementById('legacySheetsPullBtn');
    uiStatus=document.getElementById('legacySheetsPullStatus');
    uiBtn.onclick=()=>sync(true);
    return true;
  }

  function start(){
    if(!ensureUi()){setTimeout(start,350);return}
    if(!canSync()){setStatus('Import Sheets → Supabase réservé au compte principal dans son espace personnel solo.');setTimeout(start,700);return}
    setStatus('Synchronisation automatique Sheets → FIBRE OPS active.');
    setTimeout(()=>sync(false),500);
    if(!timer)timer=setInterval(()=>{if(!document.hidden&&Date.now()-lastRun>45000)sync(false)},60000);
  }

  window.addEventListener('online',()=>sync(false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRun>15000)sync(false)});
  start();
})();