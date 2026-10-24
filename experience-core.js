// Pure helpers shared by the application and its regression tests.
(function(root){
  'use strict';
  function filterHistory(rows,filter,context){
    const clean=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const q=clean(filter.query).trim();
    return rows.filter(row=>{
      if(filter.period==='month'&&row.date.slice(0,7)!==context.month)return false;
      if(filter.period==='today'&&row.date!==context.today)return false;
      if(filter.period==='week'&&(row.date<context.weekStart||row.date>context.today))return false;
      if(filter.operator&&row.op!==filter.operator)return false;
      if(filter.result&&row.statut!==filter.result)return false;
      if(filter.workMode&&row.workMode!==filter.workMode)return false;
      return !q||[row.num,row.addr,row.typo,row.op,row.comment,row.supplementComment,row.workMode,context.memberName?.(row.soloUserId)].some(v=>clean(v).includes(q));
    }).sort((a,b)=>b.date.localeCompare(a.date)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  }
  function validDefaults(saved,ops,types,hasTeam,userId,members){
    const operator=ops.includes(saved?.operator)?saved.operator:(ops[0]||'');
    const typeId=types.some(t=>t.id===saved?.typeId&&t.operator===operator&&t.active)?saved.typeId:'';
    return {operator,typeId,result:saved?.result==='Échec'?'Échec':'Réussite',
      workMode:hasTeam?(saved?.workMode==='Solo'?'Solo':'Binôme'):'Personal',
      soloUserId:hasTeam&&members.some(m=>m.id===saved?.soloUserId)?saved.soloUserId:userId};
  }
  root.FibreExperienceCore={filterHistory,validDefaults};
})(typeof window!=='undefined'?window:globalThis);
