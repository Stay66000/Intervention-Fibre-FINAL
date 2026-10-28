(function(){
  'use strict';
  if(window.FibreFinanceV2)return;
  window.FibreFinanceV2=true;

  const $id=id=>document.getElementById(id);
  let settingsRow=null,entries=[];
  let mounted=false;

  function notify(msg){try{if(typeof toast==='function')return toast(msg)}catch{}console.info('[FIBRE OPS FINANCE]',msg)}
  function money2(v){try{return typeof billingMoney==='function'?billingMoney(Number(v)||0):new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(v)||0)}catch{return `${(Number(v)||0).toFixed(2)} €`}}
  function monthNow(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
  function canUse(){try{return typeof billingCanUse==='function'&&billingCanUse()}catch{return false}}
  function sb(){try{return typeof supabase!=='undefined'?supabase:window.supabase}catch{return window.supabase}}
  function personalAmount(e){try{return typeof personalPart==='function'?Number(personalPart(e,user.id)||0):Number(e?.amount||0)}catch{return Number(e?.amount||0)}}

  function inject(){
    const tabs=$id('billingSectionTabs'),view=$id('view-facturation');
    if(!tabs||!view||$id('billingFinanceTab'))return;
    const tab=document.createElement('button');
    tab.type='button';tab.id='billingFinanceTab';tab.dataset.billingPane='finance';tab.textContent='💰 Finance';
    tabs.appendChild(tab);
    const pane=document.createElement('div');pane.className='billing-v2-pane';pane.id='billingPane-finance';
    pane.innerHTML=`
      <div class="card billing-v2-card finance-v2-head">
        <div class="billing-v2-card-head"><div><h3>Trésorerie indépendant</h3><p>Produit → facturé → encaissé → réserves → réellement disponible.</p></div></div>
        <div class="finance-v2-toolbar"><label>Mois <input id="financeV2Month" type="month"></label><button id="financeV2Refresh" class="btn-ghost" type="button">↻ Actualiser</button></div>
        <div id="financeV2Kpis" class="finance-v2-kpis"></div>
        <div id="financeV2Available" class="finance-v2-available"></div>
      </div>

      <div class="card billing-v2-card">
        <div class="billing-v2-card-head"><div><h3>Réserves automatiques</h3><p>Les taux restent entièrement configurables. FIBRE OPS ne les impose pas.</p></div></div>
        <div class="finance-v2-rates">
          <label><span>URSSAF</span><div><input id="financeV2Urssaf" type="number" min="0" max="100" step="0.01"><b>%</b></div></label>
          <label><span>Impôt estimé</span><div><input id="financeV2Tax" type="number" min="0" max="100" step="0.01"><b>%</b></div></label>
          <label><span>Marge sécurité</span><div><input id="financeV2Buffer" type="number" min="0" max="100" step="0.01"><b>%</b></div></label>
        </div>
        <button id="financeV2SaveRates" type="button" class="btn-primary">Enregistrer mes taux</button>
        <div class="finance-v2-note">Les réserves sont calculées sur l'argent réellement encaissé, pas sur le simple chiffre d'affaires produit.</div>
      </div>

      <div class="card billing-v2-card">
        <div class="billing-v2-card-head"><div><h3>Mouvements manuels</h3><p>Pour les encaissements ou dépenses qui ne passent pas par une facture FIBRE OPS. Le carburant enregistré dans l'app est déjà compté automatiquement.</p></div></div>
        <div class="finance-v2-entry-grid">
          <div class="field"><label>Type</label><select id="financeV2EntryType"><option value="income">Encaissement</option><option value="expense">Dépense</option></select></div>
          <div class="field"><label>Date</label><input id="financeV2EntryDate" type="date"></div>
          <div class="field"><label>Catégorie</label><input id="financeV2EntryCategory" maxlength="80" value="Autre"></div>
          <div class="field"><label>Montant</label><input id="financeV2EntryAmount" type="number" min="0.01" step="0.01" placeholder="0,00"></div>
          <div class="field finance-v2-label"><label>Libellé</label><input id="financeV2EntryLabel" maxlength="180" placeholder="Ex. règlement complémentaire / assurance / matériel"></div>
        </div>
        <button id="financeV2AddEntry" type="button" class="btn-primary">Ajouter le mouvement</button>
        <div id="financeV2Entries" class="finance-v2-entries"></div>
      </div>`;
    const seller=$id('billingPane-seller');
    if(seller)seller.insertAdjacentElement('afterend',pane);else view.appendChild(pane);
    $id('financeV2Month').value=monthNow();
    $id('financeV2EntryDate').value=new Date().toISOString().slice(0,10);
    tab.onclick=async()=>{billingShowPane('finance');await refresh()};
    $id('financeV2Month').onchange=render;
    $id('financeV2Refresh').onclick=refresh;
    $id('financeV2SaveRates').onclick=saveRates;
    $id('financeV2AddEntry').onclick=addEntry;
    $id('financeV2Entries').addEventListener('click',deleteEntry);
    mounted=true;
  }

  async function load(){
    if(!canUse())return;
    const client=sb();if(!client)return;
    const [sR,eR]=await Promise.all([
      client.from('finance_settings').select('*').eq('user_id',user.id).maybeSingle(),
      client.from('finance_cash_entries').select('*').eq('user_id',user.id).order('entry_date',{ascending:false})
    ]);
    if(sR.error)throw sR.error;if(eR.error)throw eR.error;
    settingsRow=sR.data||null;entries=eR.data||[];
    if(typeof invoiceRows==='undefined'||!Array.isArray(invoiceRows))invoiceRows=[];
  }

  function selectedMonth(){return $id('financeV2Month')?.value||monthNow()}
  function calc(){
    const month=selectedMonth();
    const own=(typeof interventions!=='undefined'?interventions:[]).filter(e=>String(e.date||'').slice(0,7)===month&&!e.readOnlyHistory);
    const produced=own.reduce((sum,e)=>sum+personalAmount(e),0);
    const invoices=(typeof invoiceRows!=='undefined'?invoiceRows:[]).filter(i=>String(i.billing_month||i.issue_date||'').slice(0,7)===month&&i.status!=='cancelled');
    const invoiced=invoices.filter(i=>i.status==='issued'||i.status==='paid').reduce((s,i)=>s+Number(i.total_amount||0),0);
    const paidInvoices=(typeof invoiceRows!=='undefined'?invoiceRows:[]).filter(i=>i.status==='paid'&&String(i.paid_at||i.issue_date||'').slice(0,7)===month);
    const invoiceCollected=paidInvoices.reduce((s,i)=>s+Number(i.total_amount||0),0);
    const monthEntries=entries.filter(e=>String(e.entry_date||'').slice(0,7)===month);
    const manualIncome=monthEntries.filter(e=>e.entry_type==='income').reduce((s,e)=>s+Number(e.amount||0),0);
    const manualExpenses=monthEntries.filter(e=>e.entry_type==='expense').reduce((s,e)=>s+Number(e.amount||0),0);
    const fuelExpense=(typeof fuel!=='undefined'?fuel:[]).filter(f=>String(f.date||'').slice(0,7)===month).reduce((s,f)=>s+Number(f.montant||0),0);
    const collected=invoiceCollected+manualIncome;
    const rates={
      urssaf:Number(settingsRow?.urssaf_rate||0),
      tax:Number(settingsRow?.income_tax_rate||0),
      buffer:Number(settingsRow?.safety_buffer_rate||0)
    };
    const urssaf=collected*rates.urssaf/100,tax=collected*rates.tax/100,buffer=collected*rates.buffer/100;
    const expenses=manualExpenses+fuelExpense;
    const available=collected-urssaf-tax-buffer-expenses;
    const issuedOutstanding=(typeof invoiceRows!=='undefined'?invoiceRows:[]).filter(i=>i.status==='issued').reduce((s,i)=>s+Number(i.total_amount||0),0);
    return {produced,invoiced,collected,invoiceCollected,manualIncome,manualExpenses,fuelExpense,expenses,urssaf,tax,buffer,available,issuedOutstanding,monthEntries,rates};
  }

  function render(){
    if(!mounted||!canUse())return;
    const c=calc();
    $id('financeV2Urssaf').value=String(c.rates.urssaf||'');
    $id('financeV2Tax').value=String(c.rates.tax||'');
    $id('financeV2Buffer').value=String(c.rates.buffer||'');
    $id('financeV2Kpis').innerHTML=`
      <div><small>Produit</small><b>${money2(c.produced)}</b><span>Interventions du mois</span></div>
      <div><small>Facturé</small><b>${money2(c.invoiced)}</b><span>Factures émises / payées</span></div>
      <div><small>Encaissé</small><b>${money2(c.collected)}</b><span>${money2(c.invoiceCollected)} factures + ${money2(c.manualIncome)} manuel</span></div>
      <div><small>À encaisser</small><b>${money2(c.issuedOutstanding)}</b><span>Factures encore ouvertes</span></div>`;
    $id('financeV2Available').innerHTML=`
      <div class="finance-v2-available-main"><small>Réellement disponible estimé</small><b>${money2(c.available)}</b></div>
      <div class="finance-v2-breakdown">
        <span>Encaissé <b>${money2(c.collected)}</b></span>
        <span>URSSAF (${c.rates.urssaf.toFixed(2)} %) <b>− ${money2(c.urssaf)}</b></span>
        <span>Impôt (${c.rates.tax.toFixed(2)} %) <b>− ${money2(c.tax)}</b></span>
        <span>Sécurité (${c.rates.buffer.toFixed(2)} %) <b>− ${money2(c.buffer)}</b></span>
        <span>Dépenses <b>− ${money2(c.expenses)}</b></span>
      </div>
      <div class="finance-v2-sub">Dépenses : carburant ${money2(c.fuelExpense)} · manuel ${money2(c.manualExpenses)}</div>`;
    renderEntries(c.monthEntries);
  }

  function renderEntries(list){
    const root=$id('financeV2Entries');if(!root)return;
    if(!list.length){root.innerHTML='<div class="admin-empty">Aucun mouvement manuel sur ce mois.</div>';return}
    root.innerHTML=list.map(e=>`<div class="finance-v2-entry ${e.entry_type}"><div><b>${escapeHtml(e.label)}</b><small>${formatDate(e.entry_date)} · ${escapeHtml(e.category)}</small></div><strong>${e.entry_type==='income'?'+':'−'} ${money2(e.amount)}</strong><button class="btn-ghost" data-finance-delete="${e.id}" type="button">✕</button></div>`).join('');
  }
  function escapeHtml(v){try{return typeof esc==='function'?esc(v):String(v)}catch{return String(v)}}
  function formatDate(v){try{return typeof fr==='function'?fr(v):v}catch{return v}}

  async function saveRates(){
    if(!canUse())return;
    const values={
      user_id:user.id,
      urssaf_rate:Math.max(0,Math.min(100,Number($id('financeV2Urssaf').value)||0)),
      income_tax_rate:Math.max(0,Math.min(100,Number($id('financeV2Tax').value)||0)),
      safety_buffer_rate:Math.max(0,Math.min(100,Number($id('financeV2Buffer').value)||0)),
      updated_at:new Date().toISOString()
    };
    const client=sb();
    let res;
    if(settingsRow)res=await client.from('finance_settings').update(values).eq('user_id',user.id);
    else res=await client.from('finance_settings').insert(values);
    if(res.error)return notify('Erreur finance : '+res.error.message);
    settingsRow={...(settingsRow||{}),...values};render();notify('✅ Taux de réserve enregistrés');
  }

  async function addEntry(){
    if(!canUse())return;
    const date=$id('financeV2EntryDate').value,type=$id('financeV2EntryType').value,category=$id('financeV2EntryCategory').value.trim()||'Autre',label=$id('financeV2EntryLabel').value.trim(),amount=Number($id('financeV2EntryAmount').value);
    if(!date||!label||!(amount>0))return notify('Date, libellé et montant valides requis');
    const {data,error}=await sb().from('finance_cash_entries').insert({user_id:user.id,entry_date:date,entry_type:type,category,label,amount}).select('*').single();
    if(error)return notify('Erreur : '+error.message);
    entries.unshift(data);$id('financeV2EntryAmount').value='';$id('financeV2EntryLabel').value='';render();notify('✅ Mouvement ajouté');
  }
  async function deleteEntry(event){
    const btn=event.target.closest('[data-finance-delete]');if(!btn)return;
    const id=btn.dataset.financeDelete;if(!confirm('Supprimer ce mouvement manuel ?'))return;
    const {error}=await sb().from('finance_cash_entries').delete().eq('id',id).eq('user_id',user.id);
    if(error)return notify('Erreur : '+error.message);
    entries=entries.filter(e=>e.id!==id);render();notify('Mouvement supprimé');
  }

  async function refresh(){
    if(!canUse()){
      const pane=$id('billingPane-finance');if(pane)pane.innerHTML='<div class="card"><div class="empty">Le module Finance V2 est réservé aux comptes indépendants et auto-entrepreneurs autorisés à voir leurs montants.</div></div>';
      return;
    }
    try{await load();render()}catch(error){notify('Erreur finance : '+(error?.message||error))}
  }

  function init(){inject();setTimeout(inject,900)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
