(function(){
  'use strict';
  if(window.FibreSheetsBeta)return;

  // SANDBOX UNIQUEMENT — ne pointe jamais vers le vrai « Suivis octobre ».
  const SHEETS_URL='https://script.google.com/macros/s/AKfycbwM6g4kJWdwFKGhj_4Jt77gMjnlH4khqFapjuWnb00EgZMbpLXlmO8tdKYl0gLXCIks/exec';
  const TECH='Brendan';
  const ENABLED_KEY='fibre_ops_sheets_sandbox_enabled_v2';
  const OUTBOX_KEY='fibre_ops_sheets_sandbox_outbox_v2';
  const MAP_KEY='fibre_ops_sheets_sandbox_map_v2';
  const nativeFetch=window.fetch.bind(window);
  let outbox=read(OUTBOX_KEY,[]),flushing=false,mutationCapability=null,mutationCapabilityAt=0;

  function read(k,f){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v==null?f:v}catch{return f}}
  function save(){try{localStorage.setItem(OUTBOX_KEY,JSON.stringify(outbox))}catch{}}
  function enabled(){return localStorage.getItem(ENABLED_KEY)==='1'}
  function mapping(){return read(MAP_KEY,{})}
  function operatorLabel(op){try{return typeof opLabel==='function'?opLabel(op):String(op||'')}catch{return String(op||'')}}
  function canUse(){try{return !!user&&!!profile&&['admin','platform_admin'].includes(profile.role)&&!currentCompanyId()}catch{return false}}
  function personal(e){return !!e&&!e.companyId&&!e.readOnlyHistory&&!e.teamId}
  function normText(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
  function normRef(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'')}

  function accountId(){try{return user?.id||''}catch{return ''}}
  const STATUS_PREFIX='fibre_ops_sheets_beta_receipt_v1_';
  function receiptFor(id=accountId()){return id?read(STATUS_PREFIX+id,{}):{}}
  function publish(patch={},id=accountId()){
    if(id)try{localStorage.setItem(STATUS_PREFIX+id,JSON.stringify({...receiptFor(id),...patch}))}catch{}
    window.dispatchEvent(new Event('fibre-sheets-status'));
  }
  function dateKey(value){const s=String(value||'').trim(),m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)}
  function canonical(row){return JSON.stringify([String(row.id||''),String(row.num||'').trim(),dateKey(row.date),String(row.addr||'').trim(),String(row.typo||'').trim(),String(row.statut||'Réussite').trim(),String(row.op||'').trim(),Math.round((Number(row.montant)||0)*100),String(row.comment||'').trim()])}
  async function fingerprint(row){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(row)));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
  async function rememberSent(body,id){
    const at=new Date().toISOString();
    try{publish({lastSentAt:at,lastVerifiedAt:null,error:'',receipt:{id:String(body.id||''),action:body.action||'create',digest:await fingerprint(body)}},id)}
    catch{publish({lastSentAt:at,lastVerifiedAt:null,receipt:null,error:'Transmission effectuée ; la vérification de réception n’est pas disponible sur cet appareil.'},id)}
  }
  async function verifyLastReceipt(){
    const id=accountId(),sent=receiptFor(id);
    if(!id||!canUse()||!enabled()||!sent.receipt)throw new Error('Aucun envoi vérifiable pour ce compte');
    try{
      const rows=await getSheetRows(),matches=rows.filter(row=>String(row.id||'')===sent.receipt.id);
      const found=sent.receipt.action==='delete'?matches.length===0:matches.length===1&&(await fingerprint(matches[0]))===sent.receipt.digest;
      const current=receiptFor(id);
      if(accountId()!==id||current.lastSentAt!==sent.lastSentAt)throw new Error('Un nouvel envoi est arrivé. Relance le contrôle.');
      publish(found?{lastVerifiedAt:new Date().toISOString(),error:''}:{error:'Le dernier changement transmis n’a pas encore été retrouvé dans Sheets. Relance le contrôle plus tard.'},id);
      return found;
    }catch(error){publish({error:'Vérification Sheets impossible : '+String(error?.message||error).slice(0,180)},id);throw error}
  }
  window.FibreSheetsBeta={status(){return {...receiptFor(),enabled:enabled(),available:canUse(),pending:canUse()?outbox.length:0}},verifyLastReceipt,retry:()=>flush()};

  async function mutationsSupported(force=false){
    const now=Date.now();
    if(!force&&mutationCapability!==null&&(now-mutationCapabilityAt)<30000)return mutationCapability;
    mutationCapability=false;mutationCapabilityAt=now;
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
    try{
      const r=await nativeFetch(SHEETS_URL+'?health=1&_t='+now,{cache:'no-store',signal:ctl.signal});
      if(!r.ok)return false;
      const data=await r.json();
      mutationCapability=!!(data&&data.supportsMutations===true&&String(data.version||'')==='2');
      return mutationCapability;
    }catch(e){console.warn('[Sheets sandbox capabilities]',e);mutationCapability=false;return false}
    finally{clearTimeout(timer)}
  }

  async function getSheetRows(){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
    try{
      const r=await nativeFetch(SHEETS_URL+'?tech='+encodeURIComponent(TECH)+'&_t='+Date.now(),{cache:'no-store',signal:ctl.signal});
      if(!r.ok)throw new Error('Sheets HTTP '+r.status);
      const data=await r.json();
      if(!Array.isArray(data))throw new Error('Format Sheets invalide');
      return data;
    }finally{clearTimeout(timer)}
  }

  async function resolveExistingSheetId(e,oldNum=''){
    if(!e)return '';
    try{const m=mapping();for(const sid of Object.keys(m))if(m[sid]===e.id&&String(sid).startsWith('INT-'))return sid}catch{}
    try{
      const rows=await getSheetRows();
      const refs=new Set([normRef(oldNum),normRef(e.num)].filter(Boolean));
      const wantedType=normText(e.typo),wantedOp=normText(operatorLabel(e.op));
      const matches=rows.filter(r=>{
        if(!refs.has(normRef(r?.num)))return false;
        if(wantedType&&normText(r?.typo)!==wantedType)return false;
        const rop=normText(r?.op);if(wantedOp&&rop&&rop!==wantedOp)return false;
        return !!String(r?.id||'').trim();
      });
      const legacy=matches.filter(r=>String(r?.id||'').trim().startsWith('INT-'));
      if(legacy.length===1)return String(legacy[0].id).trim();
      if(matches.length===1)return String(matches[0].id).trim();
      if(matches.length>1){console.warn('[Sheets sandbox] plusieurs lignes correspondent',matches);return ''}
    }catch(e2){console.warn('[Sheets sandbox lookup]',e2)}
    try{
      if(typeof supabase!=='undefined'&&supabase){
        const {data,error}=await supabase.from('interventions').select('operator_data').eq('id',e.id).maybeSingle();
        if(!error){const legacy=String(data?.operator_data?.legacy_sheet_id||'').trim();if(legacy)return legacy}
      }
    }catch(e2){console.warn('[Sheets sandbox legacy id]',e2)}
    return '';
  }

  function sheetCommentWithSupplement(e){
    const base=String(e?.comment||'').trim();
    const amount=Number(e?.supplementAmount||0);
    if(!(amount>0))return base;
    const label=String(e?.supplementComment||'Complément d’intervention').trim()||'Complément d’intervention';
    const moneyText=amount.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
    return [base,`${label} (+${moneyText})`].filter(Boolean).join(' · ');
  }
  function bodyFor(e,action='',oldNum='',idOverride=''){
    const body={id:idOverride||e.id,num:e.num||'',date:e.date||'',addr:e.addr||'',typo:e.typo||'',statut:e.statut||'Réussite',op:operatorLabel(e.op),solo:e.workMode==='Binôme'?'Binôme':'Solo',techSolo:profile?.first_name||TECH,apie:String(e.supplementComment||'').trim().toUpperCase()==='APIE',montant:Number(e.montant)||0,comment:sheetCommentWithSupplement(e),tech:TECH};
    if(action)body.action=action;if(oldNum)body.oldNum=oldNum;return body;
  }

  function queue(body){
    if(!enabled()||!canUse()||window.__FIBRE_SHEETS_REMOTE_APPLY__||!body)return;
    const s=JSON.stringify(body),last=outbox[outbox.length-1];
    if(last&&JSON.stringify(last.body)===s)return;
    outbox.push({body,at:new Date().toISOString()});save();publish();flush();
  }

  async function flush(){
    if(flushing||!enabled()||!navigator.onLine||!canUse()||!outbox.length)return;
    flushing=true;
    try{
      while(outbox.length){
        const item=outbox[0],action=String(item?.body?.action||'').toLowerCase();
        if((action==='update'||action==='delete')&&!(await mutationsSupported())){
          console.warn('[Sheets sandbox] mutation supprimée de la file : webhook v2 non actif',item.body);
          outbox.shift();save();publish({error:'Une modification n’a pas été transmise : le webhook bêta ne confirme pas la prise en charge des modifications.'});continue;
        }
        const owner=accountId();
        await nativeFetch(SHEETS_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify(item.body)});
        await rememberSent(item.body,owner);
        outbox.shift();save();publish();
      }
    }catch(e){console.warn('[Sheets sandbox bridge]',e);publish({error:'Envoi non confirmé. Les changements restent dans la file d’attente.'})}finally{flushing=false;publish()}
  }

  function urlOf(input){try{return typeof input==='string'?input:String(input?.url||input||'')}catch{return ''}}
  function methodOf(init){return String(init?.method||'GET').toUpperCase()}
  function parseBody(init){try{return init?.body?JSON.parse(init.body):null}catch{return null}}
  function idFromUrl(url){try{const u=new URL(url,location.href),v=u.searchParams.get('id');return v&&v.startsWith('eq.')?decodeURIComponent(v.slice(3)):''}catch{return ''}}
  function mutationBlockedToast(){try{if(typeof toast==='function')toast('Sheets TEST : ajout OK · modifications en pause jusqu’au webhook v2')}catch{}}

  window.fetch=async function(input,init){
    const url=urlOf(input),method=methodOf(init);
    if(!url.includes('.supabase.co/'))return nativeFetch(input,init);
    const body=parseBody(init);let before=null,targetId='';
    try{
      if(url.includes('/rest/v1/rpc/delete_my_intervention')){targetId=body?.p_intervention_id||'';before=(interventions||[]).find(x=>x.id===targetId)||null}
      else if(url.includes('/rest/v1/interventions')){targetId=idFromUrl(url);if(targetId)before=(interventions||[]).find(x=>x.id===targetId)||null}
    }catch{}
    const response=await nativeFetch(input,init);
    if(!response.ok||!enabled()||!canUse()||window.__FIBRE_SHEETS_REMOTE_APPLY__)return response;
    try{
      if(url.includes('/rest/v1/rpc/delete_my_intervention')&&method==='POST'&&personal(before)){
        const deleted=await response.clone().json();if(deleted!==true)return response;
        if(!(await mutationsSupported())){mutationBlockedToast();return response}
        const sheetId=await resolveExistingSheetId(before,before.num||'');if(sheetId)queue(bodyFor(before,'delete','',sheetId));
      }else if(url.includes('/rest/v1/interventions')&&method==='POST'&&body&&!body.company_id&&!body.team_id){
        const sig={date:body.intervention_date||'',num:body.reference||'',op:body.operator||''};
        setTimeout(()=>{try{const e=(interventions||[]).filter(personal).filter(x=>x.date===sig.date&&(x.num||'')===sig.num&&x.op===sig.op).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];if(e)queue(bodyFor(e))}catch{}},900);
      }else if(url.includes('/rest/v1/interventions')&&(method==='PATCH'||method==='PUT')&&personal(before)){
        if(!(await mutationsSupported())){mutationBlockedToast();return response}
        const oldNum=before.num||'',sheetId=await resolveExistingSheetId(before,oldNum);
        if(!sheetId){try{if(typeof toast==='function')toast('Sheets TEST : ligne introuvable, modification non envoyée')}catch{};return response}
        setTimeout(()=>{try{const e=(interventions||[]).find(x=>x.id===before.id);if(e)queue(bodyFor(e,'update',oldNum,sheetId))}catch{}},800);
      }
    }catch(e){console.warn('[Sheets sandbox outbound]',e)}
    return response;
  };

  window.addEventListener('online',flush);
  setTimeout(flush,1000);
})();
