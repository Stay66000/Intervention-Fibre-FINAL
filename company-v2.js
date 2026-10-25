(function(){
  'use strict';
  if(window.FibreCompanyV2)return;
  const byId=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const currentProfile=()=>{try{return profile||null}catch{return null}};
  const currentWorkStatus=()=>{try{return companyWorkStatus||null}catch{return null}};
  const notify=msg=>{try{if(typeof toast==='function')return toast(msg)}catch{} console.info('[FIBRE OPS]',msg)};
  async function rpc(name,args={}){if(!window.supabase&&typeof supabase==='undefined')throw new Error('Supabase indisponible');const client=typeof supabase!=='undefined'?supabase:window.supabase;const {data,error}=await client.rpc(name,args);if(error)throw error;return data}
  function human(error){return String(error?.message||error||'Erreur').replace(/^.*?:\s*/,'').slice(0,220)}

  function originalOnboardingVisible(gate){return gate&&!gate.classList.contains('app-hidden')}
  function onboardingCard(){return byId('onboardingGate')?.querySelector('.gate-card')||null}
  function hideChooser(){const gate=byId('onboardingGate');gate?.classList.remove('company-v2-mode-pending');byId('companyV2Chooser')?.remove()}
  function chooserShell(){
    const shell=document.createElement('div');shell.id='companyV2Chooser';shell.className='company-v2-chooser';return shell;
  }
  function showChoices(){
    const shell=byId('companyV2Chooser');if(!shell)return;
    shell.innerHTML=`<div class="company-v2-chooser-head"><h2>Comment vas-tu utiliser FIBRE OPS ?</h2><p>On configure uniquement ce dont tu as besoin. Tu pourras changer de situation plus tard.</p></div>
      <div class="company-v2-choice-grid">
        <button type="button" class="company-v2-choice" data-company-v2-choice="solo"><span class="company-v2-icon">👷</span><b>Je travaille en indépendant</b><small>Mes opérateurs, mes tarifs, mes interventions et ma facturation personnelle.</small></button>
        <button type="button" class="company-v2-choice" data-company-v2-choice="company"><span class="company-v2-icon">🏢</span><b>Je gère une société</b><small>Techniciens, prix agence, tarifs techniciens, binômes et activité globale.</small></button>
        <button type="button" class="company-v2-choice" data-company-v2-choice="invite"><span class="company-v2-icon">✉️</span><b>Je rejoins une société</b><small>Retrouve une invitation envoyée à ton adresse e-mail.</small></button>
      </div>`;
    shell.querySelector('[data-company-v2-choice="solo"]').onclick=hideChooser;
    shell.querySelector('[data-company-v2-choice="company"]').onclick=showCompanyCreator;
    shell.querySelector('[data-company-v2-choice="invite"]').onclick=showInvitePicker;
  }
  function mountOnboardingChooser(){
    const gate=byId('onboardingGate'),card=onboardingCard();if(!gate||!card||byId('companyV2Chooser')||!originalOnboardingVisible(gate))return;
    gate.classList.add('company-v2-mode-pending');const shell=chooserShell();card.prepend(shell);showChoices();
  }
  function showCompanyCreator(){
    const shell=byId('companyV2Chooser'),p=currentProfile();if(!shell)return;
    shell.innerHTML=`<button class="btn-ghost company-v2-back" type="button">← Retour</button>
      <div class="company-v2-chooser-head"><h2>Créer ma société</h2><p>Tu deviendras le patron de cet espace. Les prix agence resteront réservés à la gestion société.</p></div>
      <div class="company-v2-form">
        <div class="company-v2-form-grid"><div class="field"><label>Prénom</label><input id="cv2First" maxlength="80" value="${esc(p?.first_name||byId('obFirst')?.value||'')}"></div><div class="field"><label>Nom</label><input id="cv2Last" maxlength="80" value="${esc(p?.last_name||byId('obLast')?.value||'')}"></div></div>
        <div class="field"><label>Nom / raison sociale</label><input id="cv2CompanyName" maxlength="120" placeholder="Ex. SEM.per Travaux"></div>
        <div class="company-v2-form-grid"><div class="field"><label>SIRET</label><input id="cv2Siret" inputmode="numeric" maxlength="14" placeholder="14 chiffres"></div><div class="field"><label>Téléphone</label><input id="cv2Phone" maxlength="40" placeholder="06 …"></div></div>
        <div class="field"><label>Adresse</label><input id="cv2Address" maxlength="180" placeholder="Adresse de la société"></div>
        <div class="company-v2-form-grid"><div class="field"><label>Code postal</label><input id="cv2Postal" maxlength="12"></div><div class="field"><label>Ville</label><input id="cv2City" maxlength="100"></div></div>
        <div><div class="field"><label>Opérateurs utilisés</label></div><div class="company-v2-ops"><label class="company-v2-op"><input type="checkbox" value="orange"> Orange</label><label class="company-v2-op"><input type="checkbox" value="sfr"> SFR</label><label class="company-v2-op"><input type="checkbox" value="bouygues"> Bouygues</label><label class="company-v2-op"><input type="checkbox" value="free"> Free</label></div></div>
        <button id="cv2CreateCompany" class="btn-primary" type="button">Créer ma société</button><div id="cv2CreateStatus" class="company-v2-status"></div>
      </div>`;
    shell.querySelector('.company-v2-back').onclick=showChoices;
    byId('cv2CreateCompany').onclick=createCompany;
  }
  async function createCompany(){
    const button=byId('cv2CreateCompany'),status=byId('cv2CreateStatus');
    const first=byId('cv2First').value.trim(),last=byId('cv2Last').value.trim(),name=byId('cv2CompanyName').value.trim(),siret=byId('cv2Siret').value.trim(),phone=byId('cv2Phone').value.trim(),address=byId('cv2Address').value.trim(),postal=byId('cv2Postal').value.trim(),city=byId('cv2City').value.trim();
    const operators=[...document.querySelectorAll('#companyV2Chooser .company-v2-op input:checked')].map(x=>x.value);
    if(!first||!last||name.length<2)return setStatus(status,'Renseigne ton identité et le nom de la société.','bad');
    if(siret&&!/^\d{14}$/.test(siret))return setStatus(status,'Le SIRET doit contenir 14 chiffres.','bad');
    if(!operators.length)return setStatus(status,'Sélectionne au moins un opérateur.','bad');
    button.disabled=true;setStatus(status,'Création de la société…');
    try{await rpc('company_v2_create_self_company',{p_first_name:first,p_last_name:last,p_name:name,p_siret:siret||null,p_phone:phone||null,p_address_line1:address||null,p_postal_code:postal||null,p_city:city||null,p_operators:operators});setStatus(status,'Société créée ✅','ok');setTimeout(()=>location.reload(),500)}
    catch(error){setStatus(status,/does not exist|Could not find/i.test(error?.message||'')?'La base Société V2 n’est pas encore branchée sur cette preview. Le front est prêt ; il faut activer la branche Supabase de test.':human(error),'bad');button.disabled=false}
  }
  function setStatus(node,text,state=''){if(!node)return;node.textContent=text;node.className='company-v2-status'+(state?' '+state:'')}
  async function showInvitePicker(){
    const shell=byId('companyV2Chooser');if(!shell)return;shell.innerHTML=`<button class="btn-ghost company-v2-back" type="button">← Retour</button><div class="company-v2-chooser-head"><h2>Invitations société</h2><p>On recherche les invitations liées à ton adresse e-mail.</p></div><div id="cv2Invites" class="company-v2-invites"><div class="company-v2-status">Recherche…</div></div>`;shell.querySelector('.company-v2-back').onclick=showChoices;
    try{const rows=await rpc('get_my_company_invites_v2');renderInvites(byId('cv2Invites'),rows,true)}catch(error){byId('cv2Invites').innerHTML=`<div class="company-v2-status bad">${esc(human(error))}</div>`}
  }
  function renderInvites(root,rows,onboarding=false){
    if(!root)return;const list=Array.isArray(rows)?rows:[];if(!list.length){root.innerHTML='<div class="company-v2-status">Aucune invitation en attente pour cette adresse.</div>';return}
    root.innerHTML=list.map(row=>`<div class="company-v2-invite"><b>${esc(row.company_name||'Société')}</b><small>${row.employment_type==='salaried'?'Salarié':'Auto-entrepreneur'}${row.hide_prices?' · tarifs masqués':''} · expire le ${new Date(row.expires_at).toLocaleDateString('fr-FR')}</small><div class="company-v2-invite-actions"><button class="btn-primary" data-cv2-accept="${esc(row.code)}" type="button">Rejoindre</button><button class="btn-ghost" data-cv2-decline="${esc(row.code)}" type="button">Refuser</button></div></div>`).join('');
    root.querySelectorAll('[data-cv2-accept]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{await rpc('accept_company_invite',{p_code:btn.dataset.cv2Accept});notify('Société rejointe ✅');location.reload()}catch(error){notify('Erreur : '+human(error));btn.disabled=false}});
    root.querySelectorAll('[data-cv2-decline]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{await rpc('reject_company_invite',{p_code:btn.dataset.cv2Decline});btn.closest('.company-v2-invite')?.remove();notify('Invitation refusée')}catch(error){notify('Erreur : '+human(error));btn.disabled=false}});
  }

  async function mountProfileInvites(){
    const view=byId('view-profil');if(!view||byId('companyV2ProfileInvites'))return;
    let rows=[];try{rows=await rpc('get_my_company_invites_v2')}catch{return}if(!rows?.length)return;
    const card=document.createElement('div');card.id='companyV2ProfileInvites';card.className='experience-card';card.innerHTML='<h3>Invitations société reçues</h3><p>Une société t’a invité à rejoindre son espace FIBRE OPS.</p><div class="company-v2-invites"></div>';view.querySelector('.view-head')?.insertAdjacentElement('afterend',card);renderInvites(card.querySelector('.company-v2-invites'),rows,false);
  }

  async function mountAdminV2(){
    const root=byId('companyAdminTools');if(!root||byId('companyV2AdminCard'))return;
    const card=document.createElement('div');card.id='companyV2AdminCard';card.className='company-v2-admin-card';card.innerHTML=`<h3>🏢 Identité de la société <span class="company-v2-pill">V2</span></h3><p>Informations utilisées pour l’administration, les exports et plus tard la facturation société.</p><div id="companyV2AdminBody"><div class="company-v2-status">Chargement…</div></div>`;root.prepend(card);
    const tariffs=document.createElement('div');tariffs.id='companyV2DefaultTariffs';tariffs.className='company-v2-admin-card';tariffs.innerHTML='<h3>💶 Tarifs techniciens par défaut</h3><p>Ces montants seront proposés automatiquement aux nouveaux techniciens. Tu pourras toujours personnaliser ensuite chaque technicien.</p><div class="company-v2-tariff-list"><div class="company-v2-status">Chargement…</div></div>';const firstGrid=root.querySelector('.company-admin-grid');if(firstGrid)root.insertBefore(tariffs,firstGrid);else root.appendChild(tariffs);
    await Promise.allSettled([loadCompanyProfile(),loadDefaultTariffs()]);
  }
  async function loadCompanyProfile(){
    const body=byId('companyV2AdminBody');if(!body)return;
    try{const rows=await rpc('company_v2_get_profile'),row=Array.isArray(rows)?rows[0]:rows;if(!row)throw new Error('Société introuvable');body.innerHTML=`<div class="company-v2-form-grid"><div class="field"><label>Nom / raison sociale</label><input id="cv2AdminName" value="${esc(row.name||'')}"></div><div class="field"><label>SIRET</label><input id="cv2AdminSiret" maxlength="14" inputmode="numeric" value="${esc(row.siret||'')}"></div></div><div class="field"><label>Adresse</label><input id="cv2AdminAddress" value="${esc(row.address_line1||'')}"></div><div class="company-v2-form-grid"><div class="field"><label>Code postal</label><input id="cv2AdminPostal" value="${esc(row.postal_code||'')}"></div><div class="field"><label>Ville</label><input id="cv2AdminCity" value="${esc(row.city||'')}"></div></div><div class="company-v2-form-grid"><div class="field"><label>E-mail société</label><input id="cv2AdminEmail" type="email" value="${esc(row.email||'')}"></div><div class="field"><label>Téléphone</label><input id="cv2AdminPhone" value="${esc(row.phone||'')}"></div></div><button id="cv2AdminSave" class="btn-primary" type="button">Enregistrer les informations société</button><div id="cv2AdminStatus" class="company-v2-status"></div>`;byId('cv2AdminSave').onclick=saveCompanyProfile}
    catch(error){body.innerHTML=`<div class="company-v2-status bad">${/does not exist|Could not find/i.test(error?.message||'')?'Profil société V2 prêt côté front · base test à activer.':esc(human(error))}</div>`}
  }
  async function saveCompanyProfile(){const btn=byId('cv2AdminSave'),status=byId('cv2AdminStatus');btn.disabled=true;setStatus(status,'Enregistrement…');try{await rpc('company_v2_update_profile',{p_name:byId('cv2AdminName').value.trim(),p_siret:byId('cv2AdminSiret').value.trim()||null,p_email:byId('cv2AdminEmail').value.trim()||null,p_phone:byId('cv2AdminPhone').value.trim()||null,p_address_line1:byId('cv2AdminAddress').value.trim()||null,p_postal_code:byId('cv2AdminPostal').value.trim()||null,p_city:byId('cv2AdminCity').value.trim()||null});setStatus(status,'Informations enregistrées ✅','ok')}catch(error){setStatus(status,human(error),'bad')}finally{btn.disabled=false}}
  async function loadDefaultTariffs(){
    const root=byId('companyV2DefaultTariffs')?.querySelector('.company-v2-tariff-list');if(!root)return;
    try{const rows=await rpc('company_v2_admin_get_types');if(!rows?.length){root.innerHTML='<div class="company-v2-status">Ajoute d’abord des typologies société.</div>';return}root.innerHTML=rows.map(r=>`<div class="company-v2-tariff-row"><div><b>${esc(r.name)}</b><small>${esc(String(r.operator||'').toUpperCase())} · prix agence ${Number(r.agency_amount||0).toFixed(2)} €</small></div><input type="number" min="0" step="0.01" value="${Number(r.default_technician_amount||0)}" data-cv2-default-tariff="${esc(r.id)}" aria-label="Tarif technicien par défaut"></div>`).join('')+'<button id="cv2SaveDefaultTariffs" class="btn-primary" type="button">Enregistrer les tarifs par défaut</button>';byId('cv2SaveDefaultTariffs').onclick=saveDefaultTariffs}
    catch(error){root.innerHTML=`<div class="company-v2-status bad">${/does not exist|Could not find/i.test(error?.message||'')?'Tarifs par défaut prêts côté front · base test à activer.':esc(human(error))}</div>`}
  }
  async function saveDefaultTariffs(){const btn=byId('cv2SaveDefaultTariffs');btn.disabled=true;try{for(const input of document.querySelectorAll('[data-cv2-default-tariff]'))await rpc('company_v2_set_default_tariff',{p_type_id:input.dataset.cv2DefaultTariff,p_amount:Math.max(0,Number(input.value)||0)});notify('Tarifs par défaut enregistrés ✅')}catch(error){notify('Erreur : '+human(error))}finally{btn.disabled=false}}

  function mountBackupPrivacy(){const card=byId('backupStatusCard');if(!card||byId('companyV2PriceShield'))return;const s=currentWorkStatus();if(!s?.hide_prices)return;const note=document.createElement('div');note.id='companyV2PriceShield';note.className='company-v2-price-shield';note.innerHTML='<b>🔒 Sauvegarde sans prix</b> · ta société masque tes tarifs. Ton Google Sheets personnel conserve les informations terrain et le statut Réussite / Échec, mais aucun montant.';card.querySelector('h3')?.insertAdjacentElement('afterend',note)}

  function patchCompanyEdit(){
    const btn=byId('m-save-btn');if(!btn||btn.dataset.companyV2Patched)return;btn.dataset.companyV2Patched='1';const legacy=btn.onclick;
    btn.onclick=async function(event){
      let companyTech=false;try{companyTech=typeof isCompanyTechnician==='function'&&isCompanyTechnician()}catch{}
      if(!companyTech)return legacy?.call(this,event);
      try{
        const item=interventions.find(x=>x.id===editId);if(!item)return;if(item.readOnlyHistory)return notify('Historique société conservé en lecture seule');
        const supplement=readInterventionSupplement('m');if(supplement.enabled&&(!(supplement.amount>0)||supplement.amount>10000))return notify('Indique un montant de complément valide');
        btn.disabled=true;await rpc('company_v2_update_my_intervention',{p_intervention_id:editId,p_date:byId('m-date').value,p_reference:byId('m-num').value.trim()||null,p_address:byId('m-addr').value.trim()||null,p_notes:byId('m-comment').value.trim()||null,p_operator_data:mergeSupplementOperatorData(item?.operatorData||{},supplement)});window.FibreExperience?.databaseSaved();byId('detailModal').classList.remove('active');await loadAll();renderAll();notify('✅ Informations mises à jour')
      }catch(error){notify('Erreur : '+human(error))}finally{btn.disabled=false}
    };
  }

  function refreshUi(){mountOnboardingChooser();mountProfileInvites();mountAdminV2();mountBackupPrivacy();patchCompanyEdit()}
  function init(){
    const gate=byId('onboardingGate');if(gate){const obs=new MutationObserver(()=>{if(originalOnboardingVisible(gate))mountOnboardingChooser()});obs.observe(gate,{attributes:true,attributeFilter:['class']})}
    document.addEventListener('click',e=>{const el=e.target instanceof Element?e.target.closest('[data-view="profil"],[data-experience-view="profil"],#openBetaAdmin,#settingsBtn'):null;if(el)setTimeout(refreshUi,120)});
    setTimeout(refreshUi,300);setTimeout(refreshUi,1400);setTimeout(refreshUi,3500);
  }
  window.FibreCompanyV2={refresh:refreshUi};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
