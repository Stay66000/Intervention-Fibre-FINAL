(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let context=null,clientId='',googleLoading=null,busy=false,mailModule=null;
  function status(text){$('billingMailStatus').textContent=text}
  function buttons(){ $('billingMailSend').disabled=busy||!context||!clientId||!!context?.sent; $('billingMailClose').disabled=busy }
  function loadGoogle(){
    if(window.google?.accounts?.oauth2)return Promise.resolve();
    if(googleLoading)return googleLoading;
    googleLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
      script.onload=()=>window.google?.accounts?.oauth2?resolve():reject(new Error('Connexion Google indisponible'));
      script.onerror=()=>reject(new Error('Impossible de charger la connexion Google'));
      document.head.appendChild(script);
    }).catch(error=>{googleLoading=null;throw error});
    return googleLoading;
  }
  async function open(){
    if(!invoicePreviewRow?.invoice_number||invoicePreviewRow.status==='cancelled'||!user?.id)return;
    const row=structuredClone(invoicePreviewRow);
    context={row,userId:user.id};clientId='';
    $('billingMailFrom').value=row.seller_snapshot?.email||profile?.email||'';
    $('billingMailTo').value=row.client_snapshot?.email||'';
    $('billingMailSubject').value=`Facture ${row.invoice_number}`;
    $('billingMailBody').value='Bonjour,\n\nVeuillez trouver votre facture en pièce jointe.\n\nCordialement,';
    $('billingMailModal').classList.add('active');status('Préparation de la connexion Gmail…');buttons();
    const current=context;
    try{
      const response=await fetch('/api/invoice-gmail-config',{cache:'no-store'});
      if(!response.ok)throw new Error('Configuration Gmail indisponible.');
      const config=await response.json();
      if(!config.client_id)throw new Error('La connexion Gmail doit encore être configurée par l’administrateur du site.');
      const [,module]=await Promise.all([loadGoogle(),import('./invoice-gmail.mjs')]);mailModule=module;
      if(context!==current)return;
      clientId=config.client_id;status('Google te demandera d’autoriser l’envoi depuis ton compte.');buttons();
    }catch(error){if(context===current){status(error.message||'Connexion Gmail indisponible.');buttons()}}
  }
  function close(){if(busy)return;context=null;clientId='';$('billingMailModal').classList.remove('active');buttons()}
  async function deliver(token,data,current){
    try{
      if(!token||context!==current||user?.id!==current.userId)throw new Error('La session a changé. Recommence.');
      status('Vérification de ton compte Gmail…');
      const identityResponse=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!identityResponse.ok)throw new Error('Impossible de vérifier le compte Google.');
      const identity=await identityResponse.json();
      if(identity.email_verified!==true||String(identity.email||'').toLowerCase()!==data.from.toLowerCase())throw new Error('Le compte Google connecté ne correspond pas à l’adresse expéditrice.');
      if(context!==current||user?.id!==current.userId)throw new Error('La session a changé. Recommence.');
      status('Création du PDF…');
      const [{createInvoicePdf},{buildGmailMessage}]=await Promise.all([import('./invoice-pdf.mjs'),import('./invoice-gmail.mjs')]);
      const {doc,filename}=await createInvoicePdf(current.row);
      const raw=buildGmailMessage({...data,pdfBytes:doc.output('arraybuffer'),filename,boundary:'fibreops_'+crypto.randomUUID().replace(/-/g,'')});
      if(context!==current||user?.id!==current.userId)throw new Error('La session a changé. Recommence.');
      status('Envoi en cours…');
      let response;
      try{response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw})})}
      catch{throw new Error('Envoi non confirmé. Vérifie les messages envoyés dans Gmail avant de réessayer.')}
      if(!response.ok)throw new Error('Gmail a refusé l’envoi. Vérifie les autorisations et réessaie.');
      const result=await response.json().catch(()=>null);
      if(!result?.id)throw new Error('Envoi non confirmé. Vérifie les messages envoyés dans Gmail avant de réessayer.');
      current.sent=true;
      status('Facture envoyée avec Gmail.');
    }catch(error){status(error.message||'Envoi impossible.')}
    finally{busy=false;buttons()}
  }
  function send(){
    if(busy||!context||!clientId)return;
    const {validEmail}=mailModule;
    const data={from:$('billingMailFrom').value.trim(),to:$('billingMailTo').value.trim(),subject:$('billingMailSubject').value.trim(),body:$('billingMailBody').value};
    if(!validEmail(data.from)||!validEmail(data.to))return status('Vérifie les deux adresses e-mail.');
    if(!data.subject||/[\r\n]/.test(data.subject))return status('Indique un objet valide.');
    if(!user?.id||user.id!==context.userId)return status('La session a changé. Recommence.');
    const current=context;busy=true;buttons();status('Autorisation Gmail…');
    try{
      const client=window.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'openid email https://www.googleapis.com/auth/gmail.send',login_hint:data.from,
        callback:response=>{if(response.error){busy=false;buttons();status('Autorisation Gmail refusée ou annulée.');return}void deliver(response.access_token,data,current)},
        error_callback:()=>{busy=false;buttons();status('Connexion Google annulée ou fenêtre bloquée.')}
      });
      client.requestAccessToken({prompt:'select_account'});
    }catch(error){busy=false;buttons();status('Impossible d’ouvrir la connexion Google.')}
  }
  $('billingMailOpen').addEventListener('click',()=>void open());
  $('billingMailClose').addEventListener('click',close);
  $('billingMailSend').addEventListener('click',()=>void send());
})();
