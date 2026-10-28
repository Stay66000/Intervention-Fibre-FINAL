(function(){
  'use strict';

  // SANDBOX UNIQUEMENT — lecture du duplicata TEST Brendan.
  const SHEETS_URL='https://script.google.com/macros/s/AKfycbwM6g4kJWdwFKGhj_4Jt77gMjnlH4khqFapjuWnb00EgZMbpLXlmO8tdKYl0gLXCIks/exec';
  const TECH='Brendan';
  let busy=false,ui=null,lastAudit=null;

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
  function resolveOperator(v){const n=normText(v);try{return (operators||[]).find(o=>normText(o.operator)===n||normText(operatorLabel(o.operator))===n)?.operator||''}catch{return ''}}
  function resolveType(op,name){const n=normText(name);try{return (types||[]).find(t=>t.operator===op&&normText(t.name)===n&&t.active!==false)||null}catch{return null}}
  function canUse(){try{return !!user&&!!profile&&['admin','platform_admin'].includes(profile.role)&&!currentCompanyId()&&!hasTeam()}catch{return false}}
  function locals(){try{return (interventions||[]).filter(e=>!e.companyId&&!e.readOnlyHistory&&!e.teamId)}catch{return []}}
  function key(ref,typo){return `${normRef(ref)}|${normText(typo)}`}
  function sheetKey(r){return key(r?.num,r?.typo)}
  function localKey(e){return key(e?.num,e?.typo)}
  function setStatus(t){if(ui?.status)ui.status.textContent=t}

  function cleanAddress(v){
    let s=String(v||'');
    s=s.replace(/[\u0000-\u001F\u007F]/g,' ');
    s=s.replace(/\bIE\b/gi,' ');
    s=s.replace(/\s*,\s*,+/g,', ');
    s=s.replace(/\s+([,;])/g,'$1');
    s=s.replace(/([,;])(?=\S)/g,'$1 ');
    s=s.replace(/\s{2,}/g,' ').trim();
    s=s.replace(/^\s*[,;\-]+\s*/,'').replace(/\s*[,;\-]+\s*$/,'');
    return s.trim();
  }
  function cleaningEnabled(){return !!ui?.clean?.checked}

  async function getRows(){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),15000);
    try{
      const r=await fetch(SHEETS_URL+'?tech='+encodeURIComponent(TECH)+'&_t='+Date.now(),{cache:'no-store',signal:ctl.signal});
      if(!r.ok)throw new Error('Sheets HTTP '+r.status);
      const data=await r.json();
      if(!Array.isArray(data))throw new Error('Format Sheets invalide');
      return data.filter(r=>normRef(r?.num));
    }finally{clearTimeout(timer)}
  }

  function analyse(rows,list){
    const sheetByKey=new Map(),localByKey=new Map(),localByRef=new Map();
    for(const r of rows){const k=sheetKey(r),a=sheetByKey.get(k)||[];a.push(r);sheetByKey.set(k,a)}
    for(const e of list){
      const k=localKey(e),a=localByKey.get(k)||[];a.push(e);localByKey.set(k,a);
      const ref=normRef(e.num),b=localByRef.get(ref)||[];b.push(e);localByRef.set(ref,b);
    }

    const candidates=[],existing=[],conflicts=[],invalid=[];
    for(const raw of rows){
      const ref=normRef(raw.num),typo=normText(raw.typo),k=sheetKey(raw);
      const op=resolveOperator(raw.op),type=resolveType(op,raw.typo),date=normDate(raw.date);
      if(!ref||!typo||!date||!op||!type){invalid.push({raw,reason:'date/opérateur/typologie non reconnu'});continue}
      if((sheetByKey.get(k)||[]).length>1){conflicts.push({raw,reason:'doublon dans Sheets : même numéro + même typologie'});continue}
      const sameKey=localByKey.get(k)||[];
      if(sameKey.length>1){conflicts.push({raw,reason:'doublon déjà présent dans FIBRE OPS : même numéro + même typologie'});continue}
      if(sameKey.length===1){existing.push({raw,local:sameKey[0]});continue}
      const sameRef=localByRef.get(ref)||[];
      if(sameRef.length){conflicts.push({raw,reason:'même numéro dans FIBRE OPS mais typologie différente',local:sameRef});continue}
      candidates.push({raw,op,type,date});
    }
    return {rows,list,candidates,existing,conflicts,invalid};
  }

  async function audit(showToast=false){
    if(busy||!canUse())return null;
    busy=true;toggleBusy(true,'Analyse…');setStatus('Lecture du duplicata TEST…');
    try{
      const rows=await getRows(),list=locals(),a=analyse(rows,list);lastAudit=a;
      const amount=a.candidates.reduce((s,x)=>s+(Number(x.raw.montant)||0),0);
      setStatus(`Audit · Sheets ${rows.length} / App ${list.length} · ${a.candidates.length} à importer (${amount.toFixed(2)} € Sheets) · ${a.existing.length} déjà présentes · ${a.conflicts.length} conflit(s) · ${a.invalid.length} invalide(s) · aucune suppression`);
      console.info('[Sandbox import audit] Candidats',a.candidates.map(x=>({num:x.raw.num,typo:x.raw.typo,montant:x.raw.montant,date:x.raw.date,adresse:x.raw.addr})), 'Conflits',a.conflicts.map(x=>({num:x.raw.num,typo:x.raw.typo,raison:x.reason})));
      if(showToast&&typeof toast==='function')toast(`Audit : ${a.candidates.length} inter à importer · ${a.conflicts.length} conflit(s)`);
      return a;
    }catch(e){setStatus('Audit impossible : '+String(e?.message||e).slice(0,160));if(showToast&&typeof toast==='function')toast('Erreur audit Sheets');return null}
    finally{busy=false;toggleBusy(false)}
  }

  async function importMissing(){
    if(busy||!canUse())return;
    const a=await audit(false);if(!a)return;
    if(!a.candidates.length){if(typeof toast==='function')toast('✅ Aucune intervention sûre à importer');return}
    const sheetAmount=a.candidates.reduce((s,x)=>s+(Number(x.raw.montant)||0),0);
    const clean=cleaningEnabled();
    const ok=confirm(`Importer ${a.candidates.length} intervention(s) sûres depuis le duplicata TEST vers FIBRE OPS ?\n\nTotal affiché dans Sheets : ${sheetAmount.toFixed(2)} €\nNettoyage adresses : ${clean?'ACTIVÉ':'désactivé'}\n\nLes conflits seront ignorés. Aucune intervention existante ne sera supprimée ni écrasée.`);
    if(!ok)return;

    busy=true;toggleBusy(true,'Import…');let added=0,failed=[];
    try{
      window.__FIBRE_SHEETS_REMOTE_APPLY__=true;
      for(const x of a.candidates){
        const current=locals();
        const ref=normRef(x.raw.num),k=sheetKey(x.raw);
        if(current.some(e=>localKey(e)===k)||current.some(e=>normRef(e.num)===ref)){failed.push({raw:x.raw,reason:'conflit apparu avant insertion'});continue}
        const rawAddress=String(x.raw.addr||'').trim();
        const finalAddress=clean?cleanAddress(rawAddress):rawAddress;
        const payload={
          user_id:user.id,company_id:null,team_id:null,work_mode:'Personal',solo_user_id:user.id,
          intervention_date:x.date,operator:x.op,intervention_type_id:x.type.id,
          result:resultValue(x.raw.statut),reference:String(x.raw.num||'').trim()||null,
          address:finalAddress||null,notes:String(x.raw.comment||'').trim()||null,
          operator_data:{legacy_sheet_id:String(x.raw.id||'')||null,legacy_sheet_sync:true,sandbox_sheet_sync:true,sandbox_sheet_amount:Number(x.raw.montant)||0,address_cleaned:clean}
        };
        const {error}=await supabase.from('interventions').insert(payload);
        if(error)failed.push({raw:x.raw,reason:error.message});else added++;
      }
      if(added){await loadAll();renderAll()}
      const after=await audit(false);
      const appTotal=locals().reduce((s,e)=>s+(Number(e.montant)||0),0);
      setStatus(`Import terminé · +${added} intervention(s) · ${failed.length} bloquée(s) · App actuelle ${appTotal.toFixed(2)} € · nettoyage adresse ${clean?'ON':'OFF'} · aucune suppression`);
      console.info('[Sandbox import] Bloquées',failed);
      if(typeof toast==='function')toast(`✅ ${added} intervention(s) importée(s)${failed.length?` · ${failed.length} bloquée(s)`:''}`);
      return after;
    }catch(e){setStatus('Erreur import : '+String(e?.message||e).slice(0,160));if(typeof toast==='function')toast('Erreur import Sheets')}
    finally{window.__FIBRE_SHEETS_REMOTE_APPLY__=false;busy=false;toggleBusy(false)}
  }

  function toggleBusy(v,label){
    if(!ui)return;
    for(const b of [ui.audit,ui.import])if(b)b.disabled=v;
    if(ui.clean)ui.clean.disabled=v;
    if(v&&ui.import)ui.import.textContent=label||'Traitement…';
    else if(ui.import)ui.import.textContent='⬇ Importer les manquantes';
  }

  function ensureUi(){
    if(document.getElementById('sheetsSandboxBlock'))return bindUi();
    const grid=document.querySelector('#view-profil .settings-grid, #settingsOverlay .settings-grid');if(!grid)return false;
    const b=document.createElement('div');b.className='setting-block wide';b.id='sheetsSandboxBlock';
    b.innerHTML=`<h4>🧪 Google Sheets · SANDBOX BRENDAN</h4><p>Import manuel depuis le duplicata TEST uniquement. Règle anti-doublon : numéro d’intervention + typologie.</p><label style="display:flex;align-items:flex-start;gap:8px;margin:10px 0"><input id="sheetsSandboxCleanAddr" type="checkbox" checked style="margin-top:3px"><span><b>Nettoyer les adresses à l’import</b><br><small>Supprime les marqueurs parasites évidents comme « IE », les caractères invisibles et les espaces/virgules en double. Ne modifie pas automatiquement les noms de rues mal encodés.</small></span></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button class="btn-ghost" id="sheetsSandboxAudit" type="button">🔎 Comparer sans modifier</button><button class="btn-primary" id="sheetsSandboxImport" type="button">⬇ Importer les manquantes</button></div><div class="field-hint" id="sheetsSandboxStatus" style="margin-top:8px">Aucune suppression automatique. Aucun polling Supabase.</div><div class="field-hint" style="margin-top:6px">Si un numéro existe déjà avec une autre typologie, ou si le même numéro + typologie apparaît plusieurs fois, la ligne est bloquée en conflit et n’est pas importée.</div>`;
    grid.appendChild(b);return bindUi();
  }
  function bindUi(){
    ui={audit:document.getElementById('sheetsSandboxAudit'),import:document.getElementById('sheetsSandboxImport'),clean:document.getElementById('sheetsSandboxCleanAddr'),status:document.getElementById('sheetsSandboxStatus')};
    if(!ui.audit||!ui.import)return false;
    ui.audit.onclick=()=>audit(true);ui.import.onclick=importMissing;return true;
  }
  function start(){if(!ensureUi()){setTimeout(start,400);return}if(!canUse()){setStatus('Connexion au compte principal…');setTimeout(start,800);return}setStatus('Prêt · FIBRE OPS est relié au classeur TEST. Compare d’abord, puis importe uniquement les lignes sûres.')}
  // Interface d'import TEST retirée de la version visible.
  // Le bridge Sheets sortant reste géré séparément par sheets-bridge.js.
  const oldBlock=document.getElementById('sheetsSandboxBlock');
  if(oldBlock)oldBlock.remove();
})();
