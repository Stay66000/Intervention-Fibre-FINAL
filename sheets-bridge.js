(function(){
  'use strict';

  // SANDBOX UNIQUEMENT — ne pointe jamais vers le vrai « Suivis octobre ».
  const SHEETS_URL='https://script.google.com/macros/s/AKfycbwM6g4kJWdwFKGhj_4Jt77gMjnlH4khqFapjuWnb00EgZMbpLXlmO8tdKYl0gLXCIks/exec';
  const TECH='Brendan';
  const ENABLED_KEY='fibre_ops_sheets_sandbox_enabled_v2';
  const OUTBOX_KEY='fibre_ops_sheets_sandbox_outbox_v2';
  const MAP_KEY='fibre_ops_sheets_sandbox_map_v2';
  const nativeFetch=window.fetch.bind(window);
  let outbox=read(OUTBOX_KEY,[]),flushing=false;

  function read(k,f){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v==null?f:v}catch{return f}}
  function save(){try{localStorage.setItem(OUTBOX_KEY,JSON.stringify(outbox))}catch{}}
  function enabled(){return localStorage.getItem(ENABLED_KEY)==='1'}
  function mapping(){return read(MAP_KEY,{})}
  function operatorLabel(op){try{return typeof opLabel==='function'?opLabel(op):String(op||'')}catch{return String(op||'')}}
  function canUse(){try{return !!user&&!!profile&&['admin','platform_admin'].includes(profile.role)&&!currentCompanyId()}catch{return false}}
  function personal(e){return !!e&&!e.companyId&&!e.readOnlyHistory&&!e.teamId}

  async function sheetIdForLocal(localId){
    const m=mapping();
    for(const sid of Object.keys(m))if(m[sid]===localId)return sid;
    try{
      if(typeof supabase!=='undefined'&&supabase){
        const {data,error}=await supabase.from('interventions').select('operator_data').eq('id',localId).maybeSingle();
        if(!error){
          const legacy=String(data?.operator_data?.legacy_sheet_id||'').trim();
          if(legacy)return legacy;
        }
      }
    }catch(e){console.warn('[Sheets sandbox legacy id]',e)}
    return localId;
  }

  function bodyFor(e,action='',oldNum='',idOverride=''){
    const body={id:idOverride||e.id,num:e.num||'',date:e.date||'',addr:e.addr||'',typo:e.typo||'',statut:e.statut||'Réussite',op:operatorLabel(e.op),solo:e.workMode==='Binôme'?'Binôme':'Solo',techSolo:profile?.first_name||TECH,apie:false,montant:Number(e.montant)||0,comment:e.comment||'',tech:TECH};
    if(action)body.action=action;if(oldNum)body.oldNum=oldNum;return body;
  }

  function queue(body){
    if(!enabled()||!canUse()||window.__FIBRE_SHEETS_REMOTE_APPLY__||!body)return;
    const s=JSON.stringify(body),last=outbox[outbox.length-1];
    if(last&&JSON.stringify(last.body)===s)return;
    outbox.push({body,at:new Date().toISOString()});save();flush();
  }

  async function flush(){
    if(flushing||!enabled()||!navigator.onLine||!canUse()||!outbox.length)return;
    flushing=true;
    try{
      while(outbox.length){
        await nativeFetch(SHEETS_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify(outbox[0].body)});
        outbox.shift();save();
      }
    }catch(e){console.warn('[Sheets sandbox bridge]',e)}
    finally{flushing=false}
  }

  function urlOf(input){try{return typeof input==='string'?input:String(input?.url||input||'')}catch{return ''}}
  function methodOf(init){return String(init?.method||'GET').toUpperCase()}
  function parseBody(init){try{return init?.body?JSON.parse(init.body):null}catch{return null}}
  function idFromUrl(url){try{const u=new URL(url,location.href),v=u.searchParams.get('id');return v&&v.startsWith('eq.')?decodeURIComponent(v.slice(3)):''}catch{return ''}}

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
        const sheetId=await sheetIdForLocal(before.id);
        queue(bodyFor(before,'delete','',sheetId));
      }else if(url.includes('/rest/v1/interventions')&&method==='POST'&&body&&!body.company_id&&!body.team_id){
        const sig={date:body.intervention_date||'',num:body.reference||'',op:body.operator||''};
        setTimeout(()=>{try{const e=(interventions||[]).filter(personal).filter(x=>x.date===sig.date&&(x.num||'')===sig.num&&x.op===sig.op).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];if(e)queue(bodyFor(e))}catch{}},900);
      }else if(url.includes('/rest/v1/interventions')&&(method==='PATCH'||method==='PUT')&&personal(before)){
        const oldNum=before.num||'';
        const sheetId=await sheetIdForLocal(before.id);
        setTimeout(()=>{try{const e=(interventions||[]).find(x=>x.id===before.id);if(e)queue(bodyFor(e,'update',oldNum,sheetId))}catch{}},800);
      }
    }catch(e){console.warn('[Sheets sandbox outbound]',e)}
    return response;
  };

  window.addEventListener('online',flush);
  setTimeout(flush,1000);
})();
