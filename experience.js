(function(){
  'use strict';
  if(window.FibreExperience)return;
  const byId=id=>document.getElementById(id);
  let readyAccount='',preferenceQueue=Promise.resolve(),preferencesDirty=false,detailId='',previousFocus=null;
  const safeRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')||fallback}catch{return fallback}};
  const localKey=name=>user?.id?'fibreops_experience_'+name+'_'+user.id:null;
  function localSave(name,value){const key=localKey(name);if(key)try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
  function preferences(){return settings?.preferences?.experience||{}}
  function entryStatus(text,state=''){const node=byId('entrySaveStatus');if(node){node.textContent=text;node.dataset.state=state}}
  function savePreferences(patch){
    const accountId=user?.id;
    const task=preferenceQueue.then(async()=>{
      if(!accountId||user?.id!==accountId)throw new Error('Session modifiée');
      const next={...(settings.preferences||{}),experience:{...preferences(),...patch}};
      const {error}=await supabase.from('user_settings').update({preferences:next}).eq('user_id',accountId);
      if(error)throw error;
      if(user?.id===accountId)settings.preferences=next;
    });
    preferenceQueue=task.catch(()=>{});return task;
  }
  function defaults(){return FibreExperienceCore.validDefaults(preferences().entryDefaults,activeOps(),types,hasTeam(),user.id,teamMembers)}
  function applyDefaults(){
    Object.assign(form,defaults());populateOperatorUI();setSeg('f-op',form.operator);setSeg('f-statut',form.result);setSeg('f-work-mode',form.workMode);
    if(byId('f-solo-tech'))byId('f-solo-tech').value=form.soloUserId;
    toggleSoloFields();preview();saveDraft();
  }
  function fillDefaultTypes(current=''){
    const op=byId('defaultOperator').value;
    byId('defaultType').innerHTML='<option value="">Choisir à chaque saisie</option>'+types.filter(t=>t.active&&t.operator===op).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    byId('defaultType').value=types.some(t=>t.id===current&&t.operator===op&&t.active)?current:'';
  }
  function renderDefaults(){
    if(preferencesDirty)return;
    const saved=defaults();
    byId('defaultOperator').innerHTML=activeOps().map(op=>`<option value="${esc(op)}">${esc(opLabel(op))}</option>`).join('')||'<option value="">Aucun opérateur actif</option>';
    byId('defaultOperator').value=saved.operator;fillDefaultTypes(saved.typeId);
    byId('defaultResult').value=saved.result;byId('defaultWork').value=saved.workMode==='Solo'?'Solo':'Binôme';byId('defaultWork').disabled=!hasTeam();
    byId('experienceStart').value=['dashboard','historique','finances'].includes(preferences().startView)?preferences().startView:'saisie';
  }
  async function updateDefaults(value,message){
    const buttons=['saveEntryDefaults','resetEntryDefaults','entrySaveDefaults'].map(byId);
    buttons.forEach(b=>{b.disabled=true});byId('preferencesStatus').textContent='Enregistrement des préférences…';
    try{await savePreferences({entryDefaults:value});preferencesDirty=false;renderDefaults();byId('preferencesStatus').textContent=message;toast(message)}
    catch(error){byId('preferencesStatus').textContent='Préférences non enregistrées : '+humanError(error);toast('Erreur : '+humanError(error))}
    finally{buttons.forEach(b=>{b.disabled=false})}
  }
  function historyState(){return {period:byId('histPeriod').value,operator:byId('histOperator').value,result:byId('histResult').value,workMode:byId('histWork').value,query:byId('histSearch').value,layout:byId('histTable').getAttribute('aria-pressed')==='true'?'table':'cards'}}
  function persistHistory(){localSave('history',historyState())}
  function historyRows(){
    const now=new Date(),monday=new Date(now.getFullYear(),now.getMonth(),now.getDate());monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const filter=historyState();
    const rows=FibreExperienceCore.filterHistory(interventions,filter,{month:ym(),today:iso(now),weekStart:iso(monday),memberName});
    byId('histFilterSummary').textContent=`${rows.length} intervention${rows.length>1?'s':''} affichée${rows.length>1?'s':''}${companyPricesHidden()?'':' · '+money(sum(rows))}`;
    return rows;
  }
  function historyTable(rows){
    if(historyState().layout!=='table')return false;
    byId('histList').innerHTML=rows.length?`<div class="experience-table-wrap"><table class="experience-table"><caption class="sr-only">Interventions correspondant aux filtres</caption><thead><tr><th>Date</th><th>Référence</th><th>Opérateur / typologie</th><th>Adresse</th><th>Résultat</th><th>Montant</th></tr></thead><tbody>${rows.map(row=>`<tr class="rw" role="button" tabindex="0" data-id="${esc(row.id)}" aria-label="${esc('Ouvrir intervention '+(row.num||'sans référence'))}" style="--row-op:${opColor(row.op)}"><td>${fr(row.date)}</td><td><b>${esc(row.num||'Sans réf')}</b>${row.readOnlyHistory?'<br><small>Lecture seule</small>':''}</td><td><span style="color:${opColor(row.op)}">${esc(opLabel(row.op))}</span><br>${esc(row.typo)}</td><td class="address-cell">${esc(row.addr||'—')}</td><td>${esc(row.statut)}</td><td class="amount-cell">${companyPricesHidden()?'—':money(row.montant)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Aucune intervention ne correspond à ces filtres.</div>';
    return true;
  }
  function setLayout(layout){byId('histCards').setAttribute('aria-pressed',String(layout!=='table'));byId('histTable').setAttribute('aria-pressed',String(layout==='table'))}
  function openIntervention(id){
    const row=interventions.find(item=>item.id===id);if(!row)return;
    if(!row.readOnlyHistory){openEdit(id);byId('m-date').focus();return;}
    detailId=id;previousFocus=document.activeElement;
    byId('interventionSheetTitle').textContent=row.num||'Sans référence';
    const mode=interventionWorkModeLabel(row);
    const field=(label,value,wide=false)=>`<div${wide?' class="wide"':''}><dt>${esc(label)}</dt><dd>${esc(value||'—')}</dd></div>`;
    byId('interventionSheetBody').innerHTML=`<div class="detail-total">${companyPricesHidden()?'Prix masqué':money(row.montant)}</div><p class="experience-muted">${row.readOnlyHistory?'Historique société conservé en lecture seule.':'Montant appliqué et identité financière conservés à l’enregistrement.'}</p><dl class="experience-detail-grid">${field('Date',fr(row.date))}${field('Résultat',row.statut)}${field('Opérateur',opLabel(row.op))}${field('Typologie',row.typo)}${field('Mode',mode)}${field('Origine',row.companyName||(row.companyId?companyContext?.company_name:'Espace personnel'))}${field('Adresse',row.addr,true)}${field('Commentaire',row.comment,true)}${row.supplementAmount&&!companyPricesHidden()?field('Complément',money(row.supplementAmount)+' · '+row.supplementComment,true):''}</dl>${row.addr?`<a class="btn-ghost" href="https://maps.google.com/?q=${encodeURIComponent(row.addr)}" target="_blank" rel="noopener noreferrer">Ouvrir l’itinéraire ↗</a>`:''}`;
    byId('interventionSheetEdit').hidden=!!row.readOnlyHistory;
    byId('interventionSheet').classList.add('active');byId('closeInterventionSheet').focus();
  }
  function closeIntervention(){byId('interventionSheet').classList.remove('active');if(previousFocus?.isConnected)previousFocus.focus()}
  function clock(value){return value?new Date(value).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}
  function databaseSaved(){
    localSave('databaseWrite',{at:new Date().toISOString()});
    byId('dailyTotalCard')?.classList.remove('experience-highlight');requestAnimationFrame(()=>byId('dailyTotalCard')?.classList.add('experience-highlight'));
    renderBackups();
  }
  function renderBackups(){
    if(!user)return;
    const last=safeRead(localKey('databaseWrite'),{}),sheet=window.FibreSheetsBeta?.status();
    let title='Sheets bêta',description='État du pont indisponible. Aucune confirmation de copie ne peut être donnée.',dot='wait';
    if(sheet){
      if(!sheet.available){title='Sheets bêta · ce compte';description='Le pont bêta est réservé au compte principal indépendant.';dot=''}
      else if(!sheet.enabled){title='Sheets bêta désactivé';description='La copie Google Sheets n’est pas activée sur cet appareil.'}
      else if(sheet.pending){title=`Sheets · ${sheet.pending} envoi${sheet.pending>1?'s':''} en attente`;description=sheet.error||'La file sera reprise au retour de la connexion.'}
      else if(sheet.lastVerifiedAt&&sheet.lastVerifiedAt>=sheet.lastSentAt){title='Dernier envoi Sheets vérifié';description='Le dernier changement transmis a été retrouvé dans Sheets le '+clock(sheet.lastVerifiedAt)+'. Ce contrôle ne certifie pas tout l’historique.';dot='ok'}
      else if(sheet.lastSentAt){title='Dernier envoi transmis à Sheets';description='Transmis le '+clock(sheet.lastSentAt)+'. Réception non vérifiée : utilise le bouton de contrôle.'}
      else{title='Sheets bêta prêt';description='Aucun envoi observé sur cet appareil pour ce compte. Les anciennes copies ne sont pas contrôlées automatiquement.';dot=''}
      if(sheet.error&&!sheet.pending){title='Sheets · contrôle nécessaire';description=sheet.error;dot='wait'}
    }
    byId('backupStatusRows').innerHTML=`<div class="experience-sync-row"><span class="experience-status-dot ${last.at?'ok':''}"></span><div><b>FIBRE OPS · ${last.at?'enregistrement confirmé':'données en ligne'}</b><small>${last.at?'Dernier enregistrement confirmé sur cet appareil : '+clock(last.at)+'.':'Aucun nouvel enregistrement observé sur cet appareil. Les données existantes restent dans la base.'}</small></div></div><div class="experience-sync-row"><span class="experience-status-dot ${dot}"></span><div><b>${esc(title)}</b><small>${esc(description)}</small></div></div>`;
    byId('verifySheetsReceipt').disabled=!sheet?.available||!sheet.enabled||!sheet.lastSentAt||!!sheet.pending;
    byId('retrySheetsQueue').disabled=!sheet?.available||!sheet.enabled||!sheet.pending||!navigator.onLine;
    byId('backupStatusHint').textContent='La copie JSON télécharge uniquement les données de ton compte actuellement chargées dans l’application. La copie Sheets reste un module bêta.';
  }
  function refresh(){
    if(!user||!profile)return;
    const label=[profile.first_name,profile.last_name].filter(Boolean).join(' ')||profile.email||'Mon profil';
    byId('experienceName').textContent=label;byId('experienceAvatar').textContent=(profile.first_name||'FO').slice(0,2).toUpperCase();byId('experienceRole').textContent=byId('settingsRole')?.textContent||'';
    byId('profileTariffHint').textContent=isCompanyTechnician()?'Consulte le catalogue défini par ta société. Les droits et les prix masqués restent respectés.':'Configure tes opérateurs et les tarifs de ton activité.';
    const current=byId('histOperator').value;byId('histOperator').innerHTML='<option value="">Tous les opérateurs</option>'+Object.keys(OPS).map(op=>`<option value="${op}">${esc(opLabel(op))}</option>`).join('');byId('histOperator').value=current;
    renderDefaults();renderFinance();renderBackups();
  }
  function renderFinance(){
    const month=iso().slice(0,7),activity=interventions.filter(item=>item.date.slice(0,7)===month),expenses=fuel.filter(item=>item.date.slice(0,7)===month);
    byId('financeActivity').textContent=companyPricesHidden()?activity.length+' interventions':money(sum(activity));
    byId('financeFuel').textContent=money(sum(expenses));
    byId('financeAfterFuel').textContent=companyPricesHidden()?'Les tarifs sont masqués par ta société.':'Après carburant : '+money(sum(activity)-sum(expenses))+'. Les autres frais ne sont pas déduits.';
    byId('financeBillingHint').textContent=billingCanUse()?'Factures, clients, comparaison des récapitulatifs et suivi des paiements.':'La facturation est réservée aux comptes indépendants et auto-entrepreneurs. Tes pleins restent accessibles ici.';
  }
  function viewChanged(name){if(name==='profil')refresh();if(name==='finances')renderFinance()}
  function ready(){
    if(!user||!profile||readyAccount===user.id)return;
    readyAccount=user.id;preferencesDirty=false;
    refresh();
    const history=safeRead(localKey('history'),{});
    for(const [id,key]of [['histPeriod','period'],['histOperator','operator'],['histResult','result'],['histWork','workMode']])if([...byId(id).options].some(option=>option.value===history[key]))byId(id).value=history[key];
    byId('histSearch').value=history.query||'';setLayout(history.layout);
    let hasDraft=false;try{hasDraft=!!localStorage.getItem(draftKey())}catch{}
    if(!hasDraft)applyDefaults();
    const start=preferences().startView;
    navigateView(['dashboard','historique','finances'].includes(start)?start:'saisie');
  }
  function initialize(){
    const grid=document.querySelector('#settingsOverlay .settings-grid');if(grid)byId('profileSettings').appendChild(grid);
    for(const [name,target]of [['carburant','finances'],['facturation','finances'],['tarifs','profil']]){
      const button=document.createElement('button');button.type='button';button.className='btn-ghost experience-back';button.textContent='← '+(target==='finances'?'Finances':'Profil');button.addEventListener('click',()=>navigateView(target));byId('view-'+name).prepend(button);
    }
    document.querySelectorAll('[data-experience-view]').forEach(button=>button.addEventListener('click',()=>navigateView(button.dataset.experienceView)));
    byId('entryUseDefaults').onclick=()=>{applyDefaults();toast('Préférences appliquées à la saisie')};
    byId('entrySaveDefaults').onclick=()=>updateDefaults({...form},'Choix de saisie mémorisés');
    byId('saveEntryDefaults').onclick=()=>updateDefaults({operator:byId('defaultOperator').value,typeId:byId('defaultType').value,result:byId('defaultResult').value,workMode:byId('defaultWork').value,soloUserId:user.id},'Préférences enregistrées');
    byId('resetEntryDefaults').onclick=()=>updateDefaults({},'Préférences réinitialisées · brouillon conservé');
    byId('defaultOperator').onchange=()=>{preferencesDirty=true;fillDefaultTypes()};
    ['defaultType','defaultResult','defaultWork'].forEach(id=>byId(id).onchange=()=>{preferencesDirty=true});
    byId('experienceStart').onchange=async()=>{const select=byId('experienceStart');select.disabled=true;try{await savePreferences({startView:select.value});toast('Écran de démarrage enregistré')}catch(error){renderDefaults();toast('Erreur : '+humanError(error))}finally{select.disabled=false}};
    ['histPeriod','histOperator','histResult','histWork'].forEach(id=>byId(id).onchange=()=>{persistHistory();renderHist()});
    byId('histSearch').addEventListener('input',persistHistory);
    byId('histCards').onclick=()=>{setLayout('cards');persistHistory();renderHist()};byId('histTable').onclick=()=>{setLayout('table');persistHistory();renderHist()};
    byId('histReset').onclick=()=>{byId('histPeriod').value='month';['histOperator','histResult','histWork','histSearch'].forEach(id=>byId(id).value='');persistHistory();renderHist()};
    byId('histList').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.rw')){event.preventDefault();openIntervention(event.target.dataset.id)}});
    byId('closeInterventionSheet').onclick=byId('interventionSheetBack').onclick=closeIntervention;
    byId('interventionSheetEdit').onclick=()=>{const row=interventions.find(item=>item.id===detailId);if(!row||row.readOnlyHistory)return;closeIntervention();openEdit(detailId);byId('m-date').focus()};
    byId('interventionSheet').onclick=event=>{if(event.target===byId('interventionSheet'))closeIntervention()};
    document.addEventListener('keydown',event=>{
      if(!byId('interventionSheet').classList.contains('active'))return;
      if(event.key==='Escape'){event.preventDefault();closeIntervention()}
      if(event.key==='Tab'){
        const nodes=[...byId('interventionSheet').querySelectorAll('button:not([hidden]),a[href]')].filter(node=>!node.disabled),first=nodes[0],last=nodes[nodes.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    });
    byId('downloadAccountBackup').onclick=()=>byId('backupBtn').click();
    byId('retrySheetsQueue').onclick=async()=>{const button=byId('retrySheetsQueue');button.disabled=true;try{await window.FibreSheetsBeta?.retry()}finally{renderBackups()}};
    byId('verifySheetsReceipt').onclick=async()=>{const button=byId('verifySheetsReceipt');button.disabled=true;button.textContent='Vérification…';try{const ok=await window.FibreSheetsBeta?.verifyLastReceipt();toast(ok?'Dernier envoi retrouvé dans Sheets':'Dernier envoi non confirmé dans Sheets')}catch(error){toast('Vérification impossible : '+humanError(error))}finally{button.textContent='Vérifier le dernier envoi Sheets';renderBackups()}};
    byId('syncPill').setAttribute('role','button');byId('syncPill').setAttribute('tabindex','0');byId('syncPill').setAttribute('aria-label','Voir le suivi des sauvegardes');
    byId('syncPill').onclick=()=>{navigateView('profil');byId('backupStatusCard').scrollIntoView({block:'center',behavior:'smooth'})};
    byId('syncPill').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();byId('syncPill').click()}};
    window.addEventListener('fibre-sheets-status',renderBackups);
    ready();
  }
  window.FibreExperience={ready,refresh,viewChanged,historyRows,historyTable,openIntervention,databaseSaved,entryStatus};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
