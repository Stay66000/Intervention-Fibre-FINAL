(function(){
  'use strict';
  const PROD_HOST='intervention-fibre-final.pages.dev';
  function isPreview(){return location.protocol==='https:'&&location.hostname!==PROD_HOST&&location.hostname.endsWith('.'+PROD_HOST)}
  if(!isPreview())return;
  document.addEventListener('click',async event=>{
    const button=event.target instanceof Element?event.target.closest('#googleAuthLogin .google-auth-btn,#googleAuthSignup .google-auth-btn'):null;
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled=true;
    const label=button.lastElementChild;
    const previous=label?.textContent||'Continuer avec Google';
    if(label)label.textContent='Ouverture de Google…';
    try{
      const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'}});
      if(error)throw error;
    }catch(error){
      button.disabled=false;
      if(label)label.textContent=previous;
      try{if(typeof toast==='function')toast('Connexion Google impossible : '+(error?.message||'erreur'))}catch{}
    }
  },true);
})();
