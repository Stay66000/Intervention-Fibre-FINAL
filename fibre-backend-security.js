// FIBRE OPS — pont frontend vers le backend durci
(function(){
  'use strict';
  if(window.__fibreSecurityLoaded)return;
  window.__fibreSecurityLoaded=true;

  const INVITE_ENDPOINT='company-invite-technician-access';

  function el(id){return document.getElementById(id)}
  function notify(message){try{if(typeof toast==='function')return toast(message)}catch{} console.log('[FIBRE OPS]',message)}

  async function invokeSecureInvite(payload){
    if(typeof supabase==='undefined')throw new Error('Supabase indisponible');
    const {data:{session},error}=await supabase.auth.getSession();
    if(error||!session?.access_token)throw new Error('Session introuvable');
    const base=typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:'';
    const key=typeof SUPABASE_KEY!=='undefined'?SUPABASE_KEY:'';
    const r=await fetch(base+'/functions/v1/'+INVITE_ENDPOINT,{
      method:'POST',
      headers:{
        'apikey':key,
        'Authorization':'Bearer '+session.access_token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(payload)
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data?.error||('Erreur '+r.status));
    return data;
  }

  function bindCompanyInviteButton(){
    const btn=el('companyCreateAccessBtn');
    if(!btn||btn.dataset.foSecureInviteBound==='1')return;
    btn.dataset.foSecureInviteBound='1';
    btn.textContent='Envoyer l’invitation par e-mail';

    btn.onclick=async()=>{
      const first=String(el('companyCreateFirst')?.value||'').trim();
      const last=String(el('companyCreateLast')?.value||'').trim();
      const email=String(el('companyCreateEmail')?.value||'').trim().toLowerCase();
      const employmentType=String(el('companyCreateEmployment')?.value||'auto');
      const hidePrices=employmentType==='salaried'&&Boolean(el('companyCreateHidePrices')?.checked);
      if(!first||!email)return notify('Prénom et e-mail requis');

      btn.disabled=true;
      btn.textContent='Envoi de l’invitation…';
      try{
        const data=await invokeSecureInvite({
          first_name:first,
          last_name:last,
          email,
          employment_type:employmentType,
          hide_prices:hidePrices
        });

        const result=el('companyCredentialsResult');
        if(result){
          result.classList.add('visible');
          result.innerHTML=`
            <b>✅ Invitation sécurisée envoyée</b><br>
            E-mail : <code>${escapeHtml(data.email||email)}</code><br>
            Statut : <b>${employmentType==='salaried'?'Salarié':'Auto-entrepreneur'}${hidePrices?' · prix masqués':''}</b><br>
            <span class="field-hint">Le technicien reçoit un lien FIBRE OPS et choisit lui-même son mot de passe. Aucun mot de passe temporaire n’est généré ni affiché au patron.</span>`;
        }

        if(el('companyCreateFirst'))el('companyCreateFirst').value='';
        if(el('companyCreateLast'))el('companyCreateLast').value='';
        if(el('companyCreateEmail'))el('companyCreateEmail').value='';
        if(el('companyCreateHidePrices'))el('companyCreateHidePrices').checked=false;
        try{if(typeof syncCompanyWorkChoiceUI==='function')syncCompanyWorkChoiceUI()}catch{}
        try{if(typeof refreshCompanyAdminTools==='function')await refreshCompanyAdminTools()}catch{}
        notify('📩 Invitation envoyée au technicien');
      }catch(err){
        notify('Erreur : '+(err?.message||err));
      }finally{
        btn.disabled=false;
        btn.textContent='Envoyer l’invitation par e-mail';
      }
    };
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function inviteRequested(){
    try{return new URLSearchParams(location.search).get('invite')==='1'}catch{return false}
  }

  let checkingPassword=false;
  async function showInvitePasswordGate(){
    if(checkingPassword)return;
    checkingPassword=true;
    try{await checkInvitePasswordGate()}finally{checkingPassword=false}
  }
  async function checkInvitePasswordGate(){
    if(el('foInvitePasswordGate')||typeof supabase==='undefined')return;
    const {data:{session}}=await supabase.auth.getSession().catch(()=>({data:{session:null}}));
    if(!session)return;
    const {data:setup,error:setupError}=await supabase.rpc('get_my_password_setup_status');
    if(setupError||setup?.provisioning_pending||setup?.password_required!==true)return;

    const gate=document.createElement('div');
    gate.id='foInvitePasswordGate';
    gate.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(7,10,15,.96);display:flex;align-items:center;justify-content:center;padding:18px;font-family:inherit';
    gate.innerHTML=`
      <div style="width:min(460px,100%);background:var(--surface,#171e28);border:1px solid var(--line,rgba(158,178,206,.16));border-radius:20px;padding:20px;color:var(--ink,#eef2f7);box-shadow:0 20px 70px rgba(0,0,0,.45)">
        <div style="font-size:12px;color:var(--accent-text,#6be3f0);font-weight:800;margin-bottom:8px">INVITATION FIBRE OPS</div>
        <h2 style="margin:0 0 8px;font-size:23px">Crée ton mot de passe</h2>
        <p style="margin:0 0 18px;color:var(--ink-muted,#92a0b4);line-height:1.5">Ton adresse e-mail a été invitée par une société. Choisis maintenant ton propre mot de passe. Le patron ne pourra pas le voir.</p>
        <label style="display:block;font-size:12px;color:var(--ink-muted,#92a0b4);margin-bottom:5px">Mot de passe</label>
        <input id="foInvitePassword" type="password" minlength="8" autocomplete="new-password" placeholder="8 caractères minimum" style="width:100%;padding:11px 12px;border-radius:11px;border:1px solid var(--line,rgba(158,178,206,.16));background:var(--surface-alt,#1d2632);color:var(--ink,#eef2f7);margin-bottom:12px">
        <label style="display:block;font-size:12px;color:var(--ink-muted,#92a0b4);margin-bottom:5px">Confirmer</label>
        <input id="foInvitePasswordConfirm" type="password" minlength="8" autocomplete="new-password" style="width:100%;padding:11px 12px;border-radius:11px;border:1px solid var(--line,rgba(158,178,206,.16));background:var(--surface-alt,#1d2632);color:var(--ink,#eef2f7);margin-bottom:14px">
        <div id="foInvitePasswordStatus" style="min-height:20px;font-size:12px;color:var(--ink-muted,#92a0b4);margin-bottom:8px"></div>
        <button id="foInvitePasswordSubmit" type="button" style="width:100%;min-height:48px;border:0;border-radius:12px;background:var(--accent,#35d0e0);color:var(--accent-ink,#052a31);font-weight:800;cursor:pointer">Créer mon mot de passe</button>
      </div>`;
    document.body.appendChild(gate);

    const submit=el('foInvitePasswordSubmit');
    const run=async()=>{
      const p=String(el('foInvitePassword')?.value||'');
      const c=String(el('foInvitePasswordConfirm')?.value||'');
      const status=el('foInvitePasswordStatus');
      if(p.length<8){if(status)status.textContent='Mot de passe : 8 caractères minimum.';return}
      if(p!==c){if(status)status.textContent='Les mots de passe ne correspondent pas.';return}
      submit.disabled=true;submit.textContent='Enregistrement…';
      try{
        const {error}=await supabase.auth.updateUser({
          password:p
        });
        if(error)throw error;
        const url=new URL(location.href);url.searchParams.delete('invite');
        history.replaceState(null,'',url.pathname+(url.searchParams.toString()?'?'+url.searchParams.toString():'')+url.hash);
        if(status)status.textContent='✅ Mot de passe créé. Connexion conservée.';
        setTimeout(()=>location.reload(),450);
      }catch(err){
        if(status)status.textContent='Erreur : '+(err?.message||err);
        submit.disabled=false;submit.textContent='Créer mon mot de passe';
      }
    };
    submit?.addEventListener('click',run);
    el('foInvitePasswordConfirm')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run()}});
  }

  function sanitizePlatformAdminRows(){
    document.querySelectorAll('.admin-company-row small').forEach(node=>{
      const txt=String(node.textContent||'');
      const clean=txt.replace(/\s*·\s*(?:patron\s+.+|aucun patron attribué)\s*$/i,'');
      if(clean!==txt)node.textContent=clean;
    });
  }

  function init(){
    bindCompanyInviteButton();
    showInvitePasswordGate();
    sanitizePlatformAdminRows();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.addEventListener('fibreops-password-required',showInvitePasswordGate);
  const observer=new MutationObserver(()=>{
    bindCompanyInviteButton();
    sanitizePlatformAdminRows();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
