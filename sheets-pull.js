(function(){
  'use strict';

  const SHEETS_URL='https://script.google.com/macros/s/AKfycbwM6g4kJWdwFKGhj_4Jt77gMjnlH4khqFapjuWnb00EgZMbpLXlmO8tdKYl0gLXCIks/exec';
  const TECH='Brendan';
  const ENABLED_KEY='fibre_ops_sheets_sandbox_enabled_v2';
  const MAP_KEY='fibre_ops_sheets_sandbox_map_v2';
  const SNAP_KEY='fibre_ops_sheets_sandbox_snapshot_v2';
  const AUTO_MS=5*60*1000;
  let running=false,lastRun=0,timer=null,ui=null;

  function read(k,f){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v==null?f:v}catch{return f}}
  function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
  function enabled(){return localStorage.getItem(ENABLED_KEY)==='1'}
  function setEnabled(v){localStorage.setItem(ENABLED_KEY,v?'1':'0')}
  const normText=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const normRef=v=>String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  function normDate(v){const s=String(v||'').trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;const d=new Date(s);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function resultValue(v){return /echec|échec/i.test(String(v||''))?'Échec':'Réussite'}
  function operatorLabel(op){try{return typeof opLabel==='function'?opLabel(op):String(op||'')}catch{return String(op||'')}}
  function resolveOperator(v){const n=normText(v);try{return (operators||[]).find(o=>normText(o.operator)===n||normText(operatorLabel(o.operator))===n)?.operator||''}catch{return ''}}
  function resolveType(op,name){const n=normText(name);try{return (types||[]).find(t=>t.operator===op&&normText(t.name)===n&&t.active!==false)||null}catch{return null}}
  function canSync(){try{return !!user&&!!profile&&['admin','platform_admin'].includes(profile.role)&&!currentCompanyId()&&!hasTeam()}catch{return false}}
  function locals(){try{return (interventions||[]).filter(e=>!e.companyId&&!e.readOnlyHistory&&!e.teamId)}catch{return []}}
  function rowId(r){return String(r?.id||'').trim()}
  function keySheet(r){return `${normRef(r.num)}|${normText(r.typo)}`}
  function keyLocal(e){return `${normRef(e.num)}|${normText(e.typo)}`}
  function fp(r){return [keySheet(r),normText(r.typo),resultValue(r.statut),String(r.addr||'').trim(),String(r.comment||'').trim(),normText(r.solo),Number(r.montant)||0].join('|')}

  async function getRows(){const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);try{const r=await fetch(SHEETS_URL+'?tech='+encodeURIComponent(TECH)+'&_t='+Date.now(),{cache:'no-store',signal:c.signal});if(!r.ok)throw new Error('Sheets HTTP '+r.status);const d=await r.json();if(!Array.isArray(d))throw new Error('Format Sheets invalide');return d}finally{clearTimeout(t)}}
  async function postRow(body){await fetch(SHEETS_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body)})}

  function buildIndex(list){const byId=new Map(list.map(e=>[String(e.id),e])),byKey=new Map();for(const e of list){const k=keyLocal(e),a=byKey.get(k)||[];a.push(e);byKey.set(k,a)}return {byId,byKey}}
  function match(raw,list,idx,map){const sid=rowId(raw),ref=normRef(raw.num),typo=normText(raw.typo);if(!ref||!typo)return null;const sameRef=list.filter(e=>normRef(e.num)===ref);if(sameRef.length!==1)return null;const e=sameRef[0];if(normText(e.typo)!==typo)return null;if(sid&&map[sid]&&map[sid]!==e.id)return null;if(sid)map[sid]=e.id;return e}

  async function applyRow(raw,local,map){
    const date=normDate(raw.date),op=resolveOperator(raw.op),type=resolveType(op,raw.typo);if(!date||!op||!type)return 'skip';
    const desired={intervention_date:date,operator:op,intervention_type_id:type.id,result:resultValue(raw.statut),reference:String(raw.num||'').trim()||null,address:String(raw.addr||'').trim()||null,notes:String(raw.comment||'').trim()||null};
    if(!local){return 'review'; const payload={user_id:user.id,company_id:null,team_id:null,work_mode:'Personal',solo_user_id:user.id,...desired,operator_data:{legacy_sheet_id:rowId(raw)||null,legacy_sheet_sync:true,sandbox_sheet_sync:true}};const {data,error}=await supabase.from('interventions').insert(payload).select('id').single();if(error)throw error;if(rowId(raw)&&data?.id)map[rowId(raw)]=data.id;return 'add'}
    const patch={};if(normDate(local.date)!==date)patch.intervention_date=date;if(local.op!==op)patch.operator=op;if(String(local.typeId||'')!==String(type.id))patch.intervention_type_id=type.id;if(String(local.statut||'Réussite')!==desired.result)patch.result=desired.result;if(String(local.num||'')!==String(raw.num||''))patch.reference=desired.reference;if(String(local.addr||'')!==String(raw.addr||''))patch.address=desired.address;if(String(local.comment||'')!==String(raw.comment||''))patch.notes=desired.notes;
    if(Object.keys(patch).length){const {error}=await supabase.from('interventions').update(patch).eq('id',local.id);if(error)throw error;return 'update'}return 'same';
  }

  async function deleteMissing(rows,list,map,snap){
    if(!snap?.rows)return 0;
    const now=new Set(rows.map(rowId).filter(Boolean));let n=0;
    for(const sid of Object.keys(snap.rows)){if(now.has(sid))continue;const lid=map[sid];if(!lid)continue;const e=list.find(x=>x.id===lid);if(!e)continue;const {data,error}=await supabase.rpc('delete_my_intervention',{p_intervention_id:lid});if(error)throw error;if(data===true){delete map[sid];n++}}
    return n;
  }

  function bodyFor(e,sid){return {id:sid||e.id,num:e.num||'',date:e.date||'',addr:e.addr||'',typo:e.typo||'',statut:e.statut||'Réussite',op:operatorLabel(e.op),solo:e.workMode==='Binôme'?'Binôme':'Solo',techSolo:profile?.first_name||TECH,apie:false,montant:Number(e.montant)||0,comment:e.comment||'',tech:TECH}}
  async function pushLocalOnly(rows,list,map){const sk=new Set(rows.map(keySheet)),mapped=new Set(Object.values(map));let n=0;for(const e of list){if(mapped.has(e.id)||sk.has(keyLocal(e)))continue;await postRow(bodyFor(e,e.id));map[e.id]=e.id;n++}return n}
  function makeSnap(rows){const s={at:new Date().toISOString(),rows:{}};for(const r of rows){const id=rowId(r);if(id)s.rows[id]={key:keySheet(r),fp:fp(r)}}return s}

  async function sync(showToast=false){
    if(running||!navigator.onLine||!canSync())return;running=true;lastRun=Date.now();if(ui?.sync){ui.sync.disabled=true;ui.sync.textContent='Synchronisation…'}setStatus('Comparaison avec le duplicata TEST…');
    try{
      let map=read(MAP_KEY,{}),snap=read(SNAP_KEY,null),rows=await getRows(),list=locals(),idx=buildIndex(list),add=0,upd=0,skip=0;
      window.__FIBRE_SHEETS_REMOTE_APPLY__=true;
      for(const raw of rows){const r=match(raw,list,idx,map)?'same':'review';if(r==='add')add++;else if(r==='update')upd++;else if(r==='skip'||r==='review')skip++}
      const del=0; // Suppressions suspendues jusqu'à accord explicite.
      if(add||upd||del){await loadAll();renderAll();list=locals()}
      const pushed=0; // Écriture de nouvelles lignes suspendue.
      if(pushed)rows=await getRows();
      list=locals();idx=buildIndex(list);for(const raw of rows){const id=rowId(raw);if(!id)continue;const e=match(raw,list,idx,map);if(e)map[id]=e.id}
      save(MAP_KEY,map);save(SNAP_KEY,makeSnap(rows));
      setStatus(`Audit sans écriture · ${rows.length} lignes Sheets · ${list.length} app · ${skip} non rapprochée(s) · aucune création, modification ou suppression`);
      if(showToast&&typeof toast==='function')toast('✅ Sandbox synchronisé');
    }catch(e){console.warn('[Sheets sandbox pull]',e);setStatus('Erreur sandbox : '+String(e?.message||e).slice(0,150));if(showToast&&typeof toast==='function')toast('Erreur synchro sandbox')}
    finally{window.__FIBRE_SHEETS_REMOTE_APPLY__=false;running=false;if(ui?.sync){ui.sync.disabled=false;ui.sync.textContent='↔ Synchroniser maintenant'}}
  }

  async function compare(){try{const rows=await getRows(),list=locals(),lk=new Set(list.map(keyLocal)),sk=new Set(rows.map(keySheet)),counts=new Map();for(const r of rows){const k=normRef(r.num);if(k)counts.set(k,(counts.get(k)||0)+1)}const doubles=[...counts].filter(([k,n])=>n>1);const missing=rows.filter(r=>!lk.has(keySheet(r)));const onlyApp=list.filter(e=>!sk.has(keyLocal(e)));const amount=missing.reduce((s,r)=>s+(Number(r.montant)||0),0);setStatus(`Audit · Sheets ${rows.length} / App ${list.length} · ${missing.length} non rapprochées (${amount.toFixed(2)} €) · ${onlyApp.length} seulement app · ${doubles.length} numéro(s) répété(s) · aucune écriture`);console.info('[Sandbox audit] Numéros répétés (typologie à vérifier)',doubles,'Lignes à examiner',missing.map(r=>({num:r.num,typo:r.typo,montant:r.montant})));}catch(e){setStatus('Comparaison impossible : '+String(e?.message||e).slice(0,120))}}
  function setStatus(t){if(ui?.status)ui.status.textContent=t}

  function ensureUi(){
    if(document.getElementById('sheetsSandboxBlock'))return bindUi();const grid=document.querySelector('#settingsOverlay .settings-grid');if(!grid)return false;
    const b=document.createElement('div');b.className='setting-block wide';b.id='sheetsSandboxBlock';b.innerHTML=`<h4>🧪 Google Sheets · SANDBOX BRENDAN</h4><p>Bidirectionnel uniquement avec le duplicata TEST. Le vrai « Suivis octobre » n’est jamais ciblé.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button class="btn-primary" id="sheetsSandboxSync" type="button">↔ Synchroniser maintenant</button><button class="btn-ghost" id="sheetsSandboxCompare" type="button">Comparer sans modifier</button></div><button class="btn-ghost" id="sheetsSandboxAuto" type="button" style="width:100%;margin-top:8px"></button><div class="field-hint" id="sheetsSandboxStatus" style="margin-top:8px"></div><div class="field-hint" style="margin-top:6px">Auto : contrôle toutes les 5 min pendant que la page test est ouverte. Aucune écriture Supabase si rien ne change. La toute première synchro ne propage aucune suppression Sheets→App.</div>`;grid.appendChild(b);return bindUi();
  }
  function bindUi(){ui={sync:document.getElementById('sheetsSandboxSync'),compare:document.getElementById('sheetsSandboxCompare'),auto:document.getElementById('sheetsSandboxAuto'),status:document.getElementById('sheetsSandboxStatus')};if(!ui.sync)return false;ui.sync.onclick=()=>sync(true);ui.compare.onclick=compare;ui.auto.onclick=()=>{setEnabled(!enabled());renderAuto();/* synchro automatique suspendue */};renderAuto();if(!read(SNAP_KEY,null))setStatus('Première synchro = création de la base de sécurité, sans suppression.');return true}
  function renderAuto(){setEnabled(false);if(ui?.auto){ui.auto.textContent='Auto suspendu · audit anti-doublons';ui.auto.disabled=true}}

  function start(){if(!ensureUi()){setTimeout(start,400);return}if(!canSync()){setStatus('Sandbox réservé au compte principal dans son espace personnel solo.');setTimeout(start,900);return}renderAuto();/* Pas de polling Supabase pendant audit. */}
  window.addEventListener('online',()=>{if(enabled())sync(false)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&enabled()&&Date.now()-lastRun>AUTO_MS)sync(false)});
  start();
})();
