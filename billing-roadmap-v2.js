(function(){
  'use strict';
  if(window.FibreBillingRoadmapV2)return;
  window.FibreBillingRoadmapV2=true;

  const $id=id=>document.getElementById(id);
  function notify(msg){try{if(typeof toast==='function')return toast(msg)}catch{}console.info('[FIBRE OPS BILLING V2]',msg)}
  function money2(v){try{return billingMoney(Number(v)||0)}catch{return `${(Number(v)||0).toFixed(2)} €`}}
  function currentMonth(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
  function personal(e){try{return Number(personalPart(e,user.id)||0)}catch{return Number(e?.amount||0)}}
  function rowsForMonth(month){return (typeof interventions!=='undefined'?interventions:[]).filter(e=>String(e.date||'').slice(0,7)===month&&!e.readOnlyHistory).map(e=>({e,amount:personal(e)}))}
  function totalForMonth(month){return rowsForMonth(month).reduce((s,r)=>s+r.amount,0)}

  function mountQuickInvoice(){
    const pane=$id('billingPane-invoices');if(!pane||$id('billingQuickV2'))return;
    const card=document.createElement('div');card.id='billingQuickV2';card.className='card billing-v2-card billing-quick-v2';
    card.innerHTML=`<div class="billing-v2-card-head"><div><h3>⚡ Facture rapide du mois</h3><p>FIBRE OPS calcule le total de tes interventions et préremplit la facture existante. Tu gardes toujours la main avant émission.</p></div></div>
      <div class="billing-quick-grid"><label>Mois <input id="billingQuickMonth" type="month"></label><div><small>Interventions</small><b id="billingQuickCount">0</b></div><div><small>Total FIBRE OPS</small><b id="billingQuickTotal">0,00 €</b></div></div>
      <div class="billing-quick-actions"><button id="billingQuickFill" type="button" class="btn-primary">Préremplir la facture</button><button id="billingQuickRecon" type="button" class="btn-ghost">Utiliser le dernier contrôle</button></div>`;
    pane.prepend(card);
    $id('billingQuickMonth').value=$id('billingInvoiceMonth')?.value||currentMonth();
    $id('billingQuickMonth').onchange=renderQuick;
    $id('billingQuickFill').onclick=()=>prefillInvoice(totalForMonth($id('billingQuickMonth').value),$id('billingQuickMonth').value,'FIBRE OPS');
    $id('billingQuickRecon').onclick=()=>{
      if(typeof billingReconResult==='undefined'||!billingReconResult)return notify('Lance d’abord une comparaison de décompte');
      prefillInvoice(Number(billingReconResult.oursTotal||0),typeof billingReconMonthValue==='function'?billingReconMonthValue():$id('billingQuickMonth').value,'contrôle FIBRE OPS');
    };
    renderQuick();
  }
  function renderQuick(){
    const month=$id('billingQuickMonth')?.value||currentMonth(),rows=rowsForMonth(month);
    if($id('billingQuickCount'))$id('billingQuickCount').textContent=String(rows.length);
    if($id('billingQuickTotal'))$id('billingQuickTotal').textContent=money2(rows.reduce((s,r)=>s+r.amount,0));
    if($id('billingQuickRecon'))$id('billingQuickRecon').disabled=!(typeof billingReconResult!=='undefined'&&billingReconResult);
  }
  function prefillInvoice(amount,month,source){
    if(!(amount>=0))return notify('Montant invalide');
    try{
      if(typeof billingResetInvoiceForm==='function')billingResetInvoiceForm(false);
      if($id('billingInvoiceMonth'))$id('billingInvoiceMonth').value=month;
      if($id('billingInvoiceAmount'))$id('billingInvoiceAmount').value=Number(amount).toFixed(2);
      if(typeof invoiceClients!=='undefined'&&invoiceClients.length===1&&$id('billingInvoiceClient'))$id('billingInvoiceClient').value=invoiceClients[0].id;
      if(typeof billingShowPane==='function')billingShowPane('invoices');
      if(typeof billingRenderPreview==='function')billingRenderPreview();
      $id('billingInvoiceClient')?.focus();
      notify(`✅ Facture préremplie depuis ${source} · ${money2(amount)}`);
    }catch(error){notify('Préremplissage impossible : '+(error?.message||error))}
  }

  function patchReconciliation(){
    if(typeof billingReconCompareData!=='function'||billingReconCompareData.__roadmapV2)return;
    const legacyCompare=billingReconCompareData;
    const enhanced=function(){
      const result=legacyCompare();
      const companyRows=Array.isArray(result.companyRows)?result.companyRows:[];
      const groups=new Map();
      companyRows.forEach(row=>{if(!row.ref)return;const list=groups.get(row.ref)||[];list.push(row);groups.set(row.ref,list)});
      const duplicates=[...groups.entries()].filter(([,list])=>list.length>1).map(([ref,list])=>({ref,count:list.length,rows:list}));
      const duplicateSet=new Set(duplicates.map(d=>d.ref));
      result.results.forEach(r=>{
        const ref=typeof billingReconNormalizeRef==='function'?billingReconNormalizeRef(r.ours.reference):String(r.ours.reference||'');
        if(duplicateSet.has(ref)&&!r.issues.some(x=>x.includes('Doublon')))r.issues.push(`Doublon : ${groups.get(ref).length} lignes dans le récap société`);
        r.ok=r.issues.length===0;
      });
      let claimable=0,overpaid=0,missingValue=0,underpaidValue=0;
      result.results.forEach(r=>{
        const ours=Number(r.ours?.amount||0),company=r.company?.amount===null||r.company?.amount===undefined?null:Number(r.company.amount||0);
        if(!r.company){claimable+=ours;missingValue+=ours;return}
        if(company!==null&&ours>company+0.009){claimable+=ours-company;underpaidValue+=ours-company}
        if(company!==null&&company>ours+0.009)overpaid+=company-ours;
      });
      result.duplicates=duplicates;
      result.claimable=claimable;
      result.missingValue=missingValue;
      result.underpaidValue=underpaidValue;
      result.overpaid=overpaid;
      result.errors=result.results.filter(r=>!r.ok);
      return result;
    };
    enhanced.__roadmapV2=true;
    billingReconCompareData=enhanced;

    if(typeof billingReconRenderResult==='function'){
      const legacyRender=billingReconRenderResult;
      const render=function(result){
        legacyRender(result);
        decorateRecon(result);
      };
      render.__roadmapV2=true;
      billingReconRenderResult=render;
    }
  }

  function decorateRecon(result){
    const summary=$id('billingReconSummary');if(!summary||!result)return;
    summary.querySelectorAll('.recon-v2-extra').forEach(x=>x.remove());
    const claim=document.createElement('div');claim.className=`recon-summary-card recon-v2-extra ${result.claimable>0.009?'error':''}`;
    claim.innerHTML=`<small>Potentiellement à réclamer</small><b>${money2(result.claimable||0)}</b>`;summary.appendChild(claim);
    const dup=document.createElement('div');dup.className=`recon-summary-card recon-v2-extra ${result.duplicates?.length?'error':''}`;
    dup.innerHTML=`<small>Références en doublon</small><b>${result.duplicates?.length||0}</b>`;summary.appendChild(dup);

    let panel=$id('billingReconV2Panel');
    if(!panel){panel=document.createElement('div');panel.id='billingReconV2Panel';panel.className='recon-v2-panel';summary.insertAdjacentElement('afterend',panel)}
    panel.innerHTML=`<div class="recon-v2-claim"><div><small>Écart favorable à vérifier / réclamer</small><b>${money2(result.claimable||0)}</b><span>Absentes : ${money2(result.missingValue||0)} · Sous-payées : ${money2(result.underpaidValue||0)}</span></div><div><small>Écart dans l’autre sens</small><b>${money2(result.overpaid||0)}</b><span>À contrôler avant facturation.</span></div></div>
      <div class="recon-v2-actions"><button id="reconV2InvoiceOurs" class="btn-primary" type="button">Créer la facture FIBRE OPS (${money2(result.oursTotal)})</button><button id="reconV2InvoiceCompany" class="btn-ghost" type="button">Préremplir avec le récap société (${money2(result.companyTotal)})</button><button id="reconV2Copy" class="btn-ghost" type="button">Copier le résumé</button></div>`;
    $id('reconV2InvoiceOurs').onclick=()=>prefillInvoice(Number(result.oursTotal||0),billingReconMonthValue(),'comparaison FIBRE OPS');
    $id('reconV2InvoiceCompany').onclick=()=>prefillInvoice(Number(result.companyTotal||0),billingReconMonthValue(),'récap société');
    $id('reconV2Copy').onclick=async()=>{
      const diff=Number(result.companyTotal||0)-Number(result.oursTotal||0);
      const txt=`Contrôle FIBRE OPS ${billingReconMonthValue()}\nFIBRE OPS : ${money2(result.oursTotal)}\nRécap société : ${money2(result.companyTotal)}\nDifférence : ${money2(diff)}\nPotentiellement à réclamer : ${money2(result.claimable||0)}\nLignes à vérifier : ${result.errors.length}\nDoublons : ${result.duplicates?.length||0}`;
      try{await navigator.clipboard.writeText(txt);notify('Résumé copié')}catch{notify(txt)}
    };
    renderQuick();
  }

  function mountReconHint(){
    const info=$id('billingReconFileInfo');if(!info||$id('reconV2Hint'))return;
    const hint=document.createElement('div');hint.id='reconV2Hint';hint.className='recon-v2-hint';hint.innerHTML='<b>Contrôle V2</b> · détecte aussi les références en doublon et calcule le montant potentiellement absent ou sous-payé.';
    info.insertAdjacentElement('afterend',hint);
  }

  function init(){
    mountQuickInvoice();mountReconHint();patchReconciliation();
    document.addEventListener('click',e=>{
      const el=e.target instanceof Element?e.target.closest('[data-view="facturation"],#billingHistoryBtn,[data-billing-pane="invoices"],[data-billing-pane="reconcile"]'):null;
      if(el)setTimeout(()=>{mountQuickInvoice();mountReconHint();patchReconciliation();renderQuick()},100);
    });
    setTimeout(()=>{mountQuickInvoice();mountReconHint();patchReconciliation()},1000);
  }
  window.FibreBillingRoadmapV2={prefillInvoice,renderQuick};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
