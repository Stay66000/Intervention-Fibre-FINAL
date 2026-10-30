(function(){
  'use strict';
  if(window.FibreGoogleBackup)return;

  const PROD_ORIGIN='https://intervention-fibre-final.pages.dev';
  const $=id=>document.getElementById(id);
  const textDate=value=>{
    if(!value)return '—';
    try{return new Date(value).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return '—'}
  };
  const notify=message=>{try{if(typeof toast==='function')return toast(message)}catch{} console.info('[FIBRE OPS]',message)};
  async function session(){
    try{return (await supabase.auth.getSession()).data?.session||null}catch{return null}
  }
  async function invoke(name,body){
    const s=await session();
    if(!s)throw new Error('Connecte-toi à FIBRE OPS.');
    const {data,error}=await supabase.functions.invoke(name,{body});
    if(error)throw new Error(error.message||'Requête impossible');
    if(data?.error)throw new Error(data.error);
    return data;
  }

  function googleButton(label){
    const button=document.createElement('button');
    button.type='button';
    button.className='google-auth-btn';
    button.innerHTML='<span class="google-g" aria-hidden="true">G</span><span>'+label+'</span>';
    button.onclick=async()=>{
      button.disabled=true;
      const old=button.lastElementChild?.textContent||label;
      if(button.lastElementChild)button.lastElementChild.textContent='Ouverture de Google…';
      try{
        const {error}=await supabase.auth.signInWithOAuth({
          provider:'google',
          options:{redirectTo:PROD_ORIGIN+'/'}
        });
        if(error)throw error;
      }catch(error){
        notify('Connexion Google impossible : '+(error?.message||'erreur'));
        button.disabled=false;
        if(button.lastElementChild)button.lastElementChild.textContent=old;
      }
    };
    return button;
  }
  function injectGoogleAuth(){
    const login=$('authLoginPane');
    if(login&&!$('googleAuthLogin')){
      const block=document.createElement('div');block.className='google-auth-wrap';block.id='googleAuthLogin';
      block.appendChild(googleButton('Continuer avec Google'));
      const sep=document.createElement('div');sep.className='google-auth-sep';sep.innerHTML='<span>ou avec e-mail</span>';block.appendChild(sep);
      const firstField=login.querySelector('.field');login.insertBefore(block,firstField);
    }
    const signup=$('authSignupPane');
    if(signup&&!$('googleAuthSignup')){
      const block=document.createElement('div');block.className='google-auth-wrap';block.id='googleAuthSignup';
      block.appendChild(googleButton('Créer / continuer avec Google'));
      const sep=document.createElement('div');sep.className='google-auth-sep';sep.innerHTML='<span>ou créer avec e-mail</span>';block.appendChild(sep);
      const firstField=signup.querySelector('.auth-name-grid,.field');signup.insertBefore(block,firstField);
    }
  }

  function backupPanel(){
    const card=$('backupStatusCard');
    if(!card)return null;
    let panel=$('googleBackupPanel');
    if(panel)return panel;
    panel=document.createElement('div');panel.id='googleBackupPanel';panel.className='google-backup-panel';
    panel.innerHTML=
      '<div class="google-backup-head"><div><b>Google Sheets personnel</b><small>Un fichier dans ton propre Drive, avec un onglet par mois.</small></div><span id="googleBackupBadge" class="google-backup-badge">Non configuré</span></div>'+ 
      '<div id="googleBackupMeta" class="google-backup-meta">La sauvegarde Google n’est pas encore configurée.</div>'+ 
      '<div class="google-backup-actions">'+ 
        '<button type="button" class="btn-primary" id="googleBackupConnect">Connecter mon Google Drive</button>'+ 
        '<a class="btn-soft" id="googleBackupOpen" target="_blank" rel="noopener noreferrer" hidden>Ouvrir mon backup</a>'+ 
        '<button type="button" class="btn-ghost" id="googleBackupRetry" hidden>Relancer les sauvegardes</button>'+ 
        '<button type="button" class="btn-ghost google-backup-disconnect" id="googleBackupDisconnect" hidden>Déconnecter Google</button>'+ 
      '</div>'+ 
      '<p class="google-backup-note">Le fichier appartient à ton compte Google. FIBRE OPS n’utilise que l’autorisation nécessaire aux fichiers créés avec l’application.</p>';
    const title=card.querySelector('h3');
    title?.insertAdjacentElement('afterend',panel);

    $('googleBackupConnect').onclick=connectDrive;
    $('googleBackupRetry').onclick=retryBackup;
    $('googleBackupDisconnect').onclick=disconnectDrive;
    return panel;
  }

  let loading=false,lastStatus=null,statusAccount='';
  const reconciliationTasks=new Map();
  const opened=new Set();
  function paint(data){
    backupPanel();
    lastStatus=data;
    window.dispatchEvent(new Event('fibre-sheets-status'));
    const c=data?.connection;
    const badge=$('googleBackupBadge'),meta=$('googleBackupMeta');
    const connect=$('googleBackupConnect'),open=$('googleBackupOpen'),retry=$('googleBackupRetry'),disconnect=$('googleBackupDisconnect');
    if(!badge||!meta||!connect||!open||!retry||!disconnect)return;
    const pending=Number(data?.pending||0),failed=Number(data?.failed||0);
    badge.className='google-backup-badge';
    if(!c){
      badge.textContent='Non configuré';meta.textContent='Connecte ton Google Drive pour créer automatiquement ton classeur de sauvegarde.';
      connect.textContent='Connecter mon Google Drive';connect.hidden=false;open.hidden=true;retry.hidden=true;disconnect.hidden=true;return;
    }
    disconnect.hidden=false;
    if(c.status==='connected'){
      badge.textContent=pending?'Synchronisation…':'Connecté';badge.classList.add(pending?'wait':'ok');
      const parts=[];
      if(c.google_email)parts.push(c.google_email);
      if(c.last_success_at)parts.push('dernière sauvegarde '+textDate(c.last_success_at));
      if(pending)parts.push(pending+' en attente');
      if(failed)parts.push(failed+' en échec');
      meta.textContent=parts.join(' · ')||'Google Sheets connecté.';
      connect.hidden=true;
      if(c.spreadsheet_url){open.href=c.spreadsheet_url;open.hidden=false}else open.hidden=true;
      retry.hidden=!failed;
    }else if(c.status==='error'){
      badge.textContent='À reconnecter';badge.classList.add('error');
      meta.textContent=c.last_error?'Google demande une reconnexion. '+c.last_error:'La connexion Google doit être renouvelée.';
      connect.textContent='Reconnecter Google';connect.hidden=false;open.hidden=!c.spreadsheet_url;if(c.spreadsheet_url)open.href=c.spreadsheet_url;
      retry.hidden=true;
    }else{
      badge.textContent='Déconnecté';meta.textContent='Le fichier existant reste dans ton Drive. Reconnecte Google pour reprendre les sauvegardes.';
      connect.textContent='Reconnecter Google';connect.hidden=false;open.hidden=!c.spreadsheet_url;if(c.spreadsheet_url)open.href=c.spreadsheet_url;
      retry.hidden=true;
    }
  }
  async function loadStatus(){
    if(loading)return;
    const s=await session();if(!s)return;
    backupPanel();loading=true;
    try{const data=await invoke('google-drive-backup-manager',{action:'status'});if((await session())?.user?.id===s.user.id){statusAccount=s.user.id;paint(data)}}
    catch(error){
      const meta=$('googleBackupMeta');if(meta)meta.textContent='État Google indisponible : '+(error?.message||'erreur');
    }finally{loading=false}
  }
  async function reconcile(){
    const s=await session();if(!s)return false;
    const id=s.user.id;
    if(reconciliationTasks.has(id))return reconciliationTasks.get(id);
    const task=(async()=>{
      const result=await invoke('google-drive-backup-manager',{action:'reconcile'});
      await loadStatus();
      return !!result.ok&&!result.busy&&!result.disconnected;
    })().finally(()=>reconciliationTasks.delete(id));
    reconciliationTasks.set(id,task);return task;
  }
  async function onAccountReady(){
    const s=await session();if(!s)return;
    const id=s.user.id;
    if(opened.has(id))return;
    opened.add(id);
    if(statusAccount!==id){lastStatus=null;statusAccount=id;window.dispatchEvent(new Event('fibre-sheets-status'))}
    try{await reconcile()}catch(error){console.warn('[Google Sheets startup comparison]',error?.message||error);await loadStatus()}
  }
  async function connectDrive(){
    const button=$('googleBackupConnect');if(button)button.disabled=true;
    try{
      const data=await invoke('google-drive-oauth-start',{});
      if(!data?.auth_url)throw new Error('URL Google manquante');
      location.assign(data.auth_url);
    }catch(error){
      notify('Connexion Drive impossible : '+(error?.message||'erreur'));
      if(button)button.disabled=false;
    }
  }
  async function retryBackup(){
    const button=$('googleBackupRetry');if(button)button.disabled=true;
    try{await invoke('google-drive-backup-manager',{action:'retry'});notify('Sauvegardes relancées');await loadStatus()}
    catch(error){notify('Relance impossible : '+(error?.message||'erreur'))}
    finally{if(button)button.disabled=false}
  }
  async function disconnectDrive(){
    if(!confirm('Déconnecter Google ? Le fichier Sheets restera dans ton Drive, mais FIBRE OPS n’y écrira plus.'))return;
    const button=$('googleBackupDisconnect');if(button)button.disabled=true;
    try{await invoke('google-drive-backup-manager',{action:'disconnect'});notify('Google Drive déconnecté');await loadStatus()}
    catch(error){notify('Déconnexion impossible : '+(error?.message||'erreur'))}
    finally{if(button)button.disabled=false}
  }
  function handleCallback(){
    const url=new URL(location.href),status=url.searchParams.get('google_backup');
    if(!status)return;
    const reason=url.searchParams.get('google_backup_reason');
    url.searchParams.delete('google_backup');url.searchParams.delete('google_backup_reason');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    setTimeout(()=>{
      if(status==='connected')notify('Google Sheets connecté ✅');
      else notify('Connexion Google non finalisée'+(reason?' : '+reason:''));
      try{if(typeof navigateView==='function')navigateView('profil')}catch{}
      loadStatus();
    },500);
  }

  function init(){
    injectGoogleAuth();backupPanel();handleCallback();
    setTimeout(onAccountReady,900);
    supabase.auth.onAuthStateChange((event,s)=>{if(event==='SIGNED_OUT'){opened.clear();lastStatus=null;statusAccount=''}else if(s)setTimeout(onAccountReady,0)});
    document.addEventListener('click',event=>{
      const target=event.target instanceof Element?event.target.closest('[data-view="profil"],[data-experience-view="profil"]'):null;
      if(target)setTimeout(loadStatus,180);
    });
    const obs=new MutationObserver(()=>{injectGoogleAuth();backupPanel()});
    obs.observe(document.body,{childList:true,subtree:true});
  }
  window.FibreGoogleBackup={loadStatus,connectDrive,reconcile,onAccountReady,status:()=>lastStatus};
  // Existing backup controls now describe the authoritative server mirror.
  window.FibreSheetsBeta={
    status(){const c=lastStatus?.connection;return {available:!!c,enabled:c?.status==='connected',pending:lastStatus?.pending||0,error:c?.last_error||'',lastSentAt:c?.last_success_at,lastVerifiedAt:c?.last_reconciled_at,modern:true}},
    retry:retryBackup,verifyLastReceipt:reconcile
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();