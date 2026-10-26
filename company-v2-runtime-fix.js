(function(){
  'use strict';
  if(window.FibreCompanyV2RuntimeFix)return;
  window.FibreCompanyV2RuntimeFix=true;

  function isCompanyTech(){
    try{return typeof isCompanyTechnician==='function'&&isCompanyTechnician()}catch{return false}
  }
  function client(){
    try{return typeof supabase!=='undefined'?supabase:window.supabase}catch{return window.supabase}
  }
  function notify(msg){try{if(typeof toast==='function')return toast(msg)}catch{}console.info('[FIBRE OPS]',msg)}
  function human(error){return String(error?.message||error||'Erreur').replace(/^.*?:\s*/,'').slice(0,220)}

  function patchRpc(){
    const sb=client();
    if(!sb||typeof sb.rpc!=='function'||sb.__companyV2RpcPatched)return;
    const original=sb.rpc.bind(sb);
    sb.rpc=function(name,args){
      if(name==='company_get_my_interventions'&&isCompanyTech()){
        return original('company_v2_get_my_interventions',args||{});
      }
      return original(name,args||{});
    };
    sb.__companyV2RpcPatched=true;
  }

  function patchEdit(){
    const btn=document.getElementById('m-save-btn');
    if(!btn||btn.dataset.companyV2SafeEdit==='1')return;
    btn.dataset.companyV2SafeEdit='1';
    const legacy=btn.onclick;
    btn.onclick=async function(event){
      if(!isCompanyTech())return legacy?.call(this,event);
      try{
        const item=(typeof interventions!=='undefined'?interventions:[]).find(x=>x.id===editId);
        if(!item)return;
        if(item.readOnlyHistory)return notify('Historique société conservé en lecture seule');
        const hidden=!!(typeof companyWorkStatus!=='undefined'&&companyWorkStatus?.hide_prices);
        const supplement=hidden?{enabled:false,amount:0,label:''}:readInterventionSupplement('m');
        if(!hidden&&supplement.enabled&&(!(supplement.amount>0)||supplement.amount>10000))return notify('Indique un montant de complément valide');
        btn.disabled=true;
        const data=hidden?(item?.operatorData||{}):mergeSupplementOperatorData(item?.operatorData||{},supplement);
        const sb=client();
        const {error}=await sb.rpc('company_v2_update_my_intervention',{
          p_intervention_id:editId,
          p_intervention_date:document.getElementById('m-date').value,
          p_reference:document.getElementById('m-num').value.trim()||null,
          p_address:document.getElementById('m-addr').value.trim()||null,
          p_notes:document.getElementById('m-comment').value.trim()||null,
          p_operator_data:data
        });
        if(error)throw error;
        window.FibreExperience?.databaseSaved();
        document.getElementById('detailModal')?.classList.remove('active');
        await loadAll();renderAll();notify('✅ Informations mises à jour');
      }catch(error){notify('Erreur : '+human(error))}
      finally{btn.disabled=false}
    };
  }

  function apply(){patchRpc();patchEdit()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  setTimeout(apply,300);setTimeout(apply,1200);setTimeout(apply,3000);
})();
