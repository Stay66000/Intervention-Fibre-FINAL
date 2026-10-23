(function(){
  'use strict';

  const TABLE='intervention_supplement_types';
  let supplementPresets=[];
  let loading=false;

  function injectStyles(){
    if(document.getElementById('fibreSupplementPresetStyles'))return;
    const style=document.createElement('style');
    style.id='fibreSupplementPresetStyles';
    style.textContent=`
      .supp-catalog{margin-top:13px;padding-top:13px;border-top:1px dashed var(--border-strong)}
      .supp-catalog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}
      .supp-catalog-title{font-weight:800;font-size:13px;color:var(--ink)}
      .supp-catalog-copy{font-size:11.5px;color:var(--ink-dim);margin-top:2px}
      .supp-rate-row{display:grid;grid-template-columns:minmax(0,1fr) 105px auto auto;gap:7px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}
      .supp-rate-row input,.supp-rate-add input{width:100%;min-height:38px;padding:7px 9px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
      .supp-rate-row.is-off{opacity:.65}
      .supp-rate-add{display:grid;grid-template-columns:minmax(0,1fr) 105px auto;gap:7px;margin-top:7px;padding-top:9px;border-top:1px dashed var(--border-strong)}
      .supp-rate-badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:10.5px;font-weight:800;background:var(--success-bg);color:var(--success)}
      .intervention-supplement-presets .saved-supp-preset{min-height:32px;padding:5px 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 36%,var(--line));background:var(--accent-soft);color:var(--accent-text);font-weight:800;font-size:11.5px;cursor:pointer}
      .intervention-supplement-presets .saved-supp-preset strong{font-family:var(--font-num);margin-left:4px}
      .intervention-supplement-presets .saved-supp-empty{font-size:11.5px;color:var(--ink-dim)}
      @media(max-width:560px){
        .supp-rate-row{grid-template-columns:minmax(0,1fr) 90px;}
        .supp-rate-row .supp-save,.supp-rate-row .supp-toggle{grid-row:2}
        .supp-rate-add{grid-template-columns:minmax(0,1fr) 90px auto}
      }
    `;
    document.head.appendChild(style);
  }

  function canUseCatalog(){
    try{return !!user&&!isCompanyTechnician()}catch{return false}
  }

  function currentRows(){
    try{
      if(hasTeam())return supplementPresets.filter(x=>x.team_id===team.id);
      return supplementPresets.filter(x=>!x.team_id&&x.user_id===user.id);
    }catch{return []}
  }

  async function loadPresets({rerender=true}={}){
    if(loading)return;
    loading=true;
    try{
      if(!canUseCatalog()){
        supplementPresets=[];
        if(rerender)refreshUi();
        return;
      }
      let q=supabase.from(TABLE)
        .select('id,user_id,team_id,operator,name,amount,active,sort_order,created_at,updated_at')
        .order('operator').order('sort_order').order('created_at');
      if(hasTeam())q=q.eq('team_id',team.id);
      else q=q.eq('user_id',user.id).is('team_id',null);
      const {data,error}=await q;
      if(error)throw error;
      supplementPresets=(data||[]).map(x=>({...x,amount:Number(x.amount)||0}));
      if(rerender)refreshUi();
    }catch(err){
      console.warn('[FIBRE OPS supplement presets]',err);
      try{toast('Compléments : impossible de charger les tarifs enregistrés')}catch{}
    }finally{loading=false}
  }

  function byOperator(op,activeOnly=false){
    return currentRows().filter(x=>x.operator===op&&(!activeOnly||x.active));
  }

  function moneyText(v){
    try{return money(Number(v)||0)}catch{return (Number(v)||0).toFixed(2)+' €'}
  }

  function decorateTariffs(){
    const root=document.getElementById('tariffRows');
    if(!root||!canUseCatalog())return;
    root.querySelectorAll('.tariff-operator[data-op]').forEach(card=>{
      const op=card.dataset.op||'';
      const rows=byOperator(op,false);
      const block=document.createElement('div');
      block.className='supp-catalog';
      block.dataset.suppCatalog=op;
      block.innerHTML=`
        <div class="supp-catalog-head">
          <div><div class="supp-catalog-title">➕ Compléments d’intervention</div><div class="supp-catalog-copy">Enregistre ici les suppléments proposés automatiquement sur les interventions ${esc(opLabel(op))}.</div></div>
          <span class="supp-rate-badge">${rows.filter(x=>x.active).length} actif${rows.filter(x=>x.active).length>1?'s':''}</span>
        </div>
        ${rows.map(x=>`<div class="supp-rate-row ${x.active?'':'is-off'}" data-supp-row="${x.id}">
          <input class="supp-name" maxlength="80" value="${esc(x.name)}" ${x.active?'':'disabled'} aria-label="Nom du complément">
          <input class="supp-amount" type="number" min="0.01" max="10000" step="0.01" value="${Number(x.amount).toFixed(2)}" ${x.active?'':'disabled'} aria-label="Tarif du complément">
          <button class="btn-ghost supp-save" type="button" data-supp-save="${x.id}" ${x.active?'':'disabled'}>Sauver</button>
          <button class="btn-ghost supp-toggle" type="button" data-supp-toggle="${x.id}">${x.active?'Désactiver':'Réactiver'}</button>
        </div>`).join('')}
        <div class="supp-rate-add">
          <input data-supp-add-name maxlength="80" placeholder="Ex. APIE">
          <input data-supp-add-amount type="number" min="0.01" max="10000" step="0.01" placeholder="0,00">
          <button class="btn-primary" type="button" data-supp-add="${esc(op)}">+</button>
        </div>`;
      card.appendChild(block);
    });
  }

  function presetContainer(prefix){
    return document.querySelector(`#${prefix}-supplement-card .intervention-supplement-presets`);
  }

  function operatorFor(prefix){
    try{
      if(prefix==='f')return form.operator||'';
      return document.getElementById('m-supplement-card')?.dataset.operator||'';
    }catch{return ''}
  }

  function renderPresetButtons(prefix){
    const box=presetContainer(prefix);if(!box)return;
    const op=operatorFor(prefix);
    const rows=byOperator(op,true);
    box.innerHTML=rows.length
      ? rows.map(x=>`<button type="button" class="saved-supp-preset" data-use-supp="${x.id}" data-prefix="${prefix}">${esc(x.name)} <strong>+${moneyText(x.amount)}</strong></button>`).join('')+`<small>Ou saisis un complément personnalisé ci-dessous.</small>`
      : `<span class="saved-supp-empty">Aucun complément enregistré pour ${esc(opLabel(op||''))}. Tu peux en créer dans Tarifs.</span>`;
  }

  function refreshUi(){
    try{decorateTariffs()}catch(err){console.warn('[supplements tariffs]',err)}
    try{renderPresetButtons('f');renderPresetButtons('m')}catch(err){console.warn('[supplements buttons]',err)}
  }

  function usePreset(id,prefix){
    const p=currentRows().find(x=>x.id===id&&x.active);if(!p)return;
    const enabled=document.getElementById(prefix+'-supp-enabled');
    const amount=document.getElementById(prefix+'-supp-amount');
    const comment=document.getElementById(prefix+'-supp-comment');
    if(!enabled||!amount||!comment)return;
    enabled.checked=true;
    amount.value=Number(p.amount).toFixed(2);
    comment.value=p.name;
    try{syncSupplementCard(prefix)}catch{}
    if(prefix==='f'){
      try{preview()}catch{}
      try{saveDraft()}catch{}
    }
  }

  async function addPreset(button){
    if(!canUseCatalog())return;
    const op=button.dataset.suppAdd||'';
    const block=button.closest('.supp-catalog');
    const name=block?.querySelector('[data-supp-add-name]')?.value.trim()||'';
    const amount=Number(block?.querySelector('[data-supp-add-amount]')?.value||0);
    if(!name||!Number.isFinite(amount)||amount<=0||amount>10000)return toast('Nom et tarif de complément valides requis');
    const rows=byOperator(op,false);
    const payload={user_id:user.id,team_id:hasTeam()?team.id:null,operator:op,name,amount,active:true,sort_order:rows.length};
    const {data,error}=await supabase.from(TABLE).insert(payload).select('id,user_id,team_id,operator,name,amount,active,sort_order,created_at,updated_at').single();
    if(error)return toast('Erreur complément : '+error.message);
    supplementPresets.push({...data,amount:Number(data.amount)||0});
    try{renderTariffs()}catch{refreshUi()}
    renderPresetButtons('f');renderPresetButtons('m');
    toast(`✅ Complément ${name} enregistré`);
  }

  async function savePreset(id,row){
    const p=currentRows().find(x=>x.id===id);if(!p)return;
    const name=row?.querySelector('.supp-name')?.value.trim()||'';
    const amount=Number(row?.querySelector('.supp-amount')?.value||0);
    if(!name||!Number.isFinite(amount)||amount<=0||amount>10000)return toast('Nom et tarif de complément valides requis');
    const {data,error}=await supabase.from(TABLE).update({name,amount}).eq('id',id).select('id,user_id,team_id,operator,name,amount,active,sort_order,created_at,updated_at').single();
    if(error)return toast('Erreur complément : '+error.message);
    Object.assign(p,data,{amount:Number(data.amount)||0});
    try{renderTariffs()}catch{refreshUi()}
    renderPresetButtons('f');renderPresetButtons('m');
    toast('✅ Tarif du complément mis à jour');
  }

  async function togglePreset(id){
    const p=currentRows().find(x=>x.id===id);if(!p)return;
    const next=!p.active;
    const {data,error}=await supabase.from(TABLE).update({active:next}).eq('id',id).select('id,user_id,team_id,operator,name,amount,active,sort_order,created_at,updated_at').single();
    if(error)return toast('Erreur complément : '+error.message);
    Object.assign(p,data,{amount:Number(data.amount)||0});
    try{renderTariffs()}catch{refreshUi()}
    renderPresetButtons('f');renderPresetButtons('m');
    toast(next?'✅ Complément réactivé':'Complément désactivé · historique conservé');
  }

  document.addEventListener('click',e=>{
    const use=e.target.closest('[data-use-supp]');
    if(use){e.preventDefault();usePreset(use.dataset.useSupp,use.dataset.prefix||'f');return;}
    const add=e.target.closest('[data-supp-add]');
    if(add){e.preventDefault();addPreset(add);return;}
    const save=e.target.closest('[data-supp-save]');
    if(save){e.preventDefault();savePreset(save.dataset.suppSave,save.closest('.supp-rate-row'));return;}
    const toggle=e.target.closest('[data-supp-toggle]');
    if(toggle){e.preventDefault();togglePreset(toggle.dataset.suppToggle);return;}
    setTimeout(()=>{renderPresetButtons('f');renderPresetButtons('m')},0);
  });

  document.addEventListener('change',()=>setTimeout(()=>{renderPresetButtons('f');renderPresetButtons('m')},0));

  injectStyles();

  try{
    if(typeof renderTariffs==='function'){
      const baseRenderTariffs=renderTariffs;
      renderTariffs=function(){
        const out=baseRenderTariffs.apply(this,arguments);
        decorateTariffs();
        return out;
      };
    }
  }catch(err){console.warn('[supplements hook renderTariffs]',err)}

  try{
    if(typeof loadAll==='function'){
      const baseLoadAll=loadAll;
      loadAll=async function(){
        const out=await baseLoadAll.apply(this,arguments);
        await loadPresets({rerender:false});
        return out;
      };
    }
  }catch(err){console.warn('[supplements hook loadAll]',err)}

  const modal=document.getElementById('detailModal');
  if(modal){new MutationObserver(()=>{if(modal.classList.contains('active'))setTimeout(()=>renderPresetButtons('m'),0)}).observe(modal,{attributes:true,attributeFilter:['class']});}

  setTimeout(()=>loadPresets(),250);

  window.FibreSupplementPresets={reload:loadPresets,list:()=>currentRows().map(x=>({...x}))};
})();
