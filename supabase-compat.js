(function(){
  'use strict';
  try{
    if(typeof supabase==='undefined'||!supabase||!supabase.auth)return;
    const base=(typeof SUPABASE_URL==='string'&&SUPABASE_URL)?SUPABASE_URL:'https://dvvoqfswlqdwvxamfsot.supabase.co';
    const key=(typeof SUPABASE_KEY==='string'&&SUPABASE_KEY)?SUPABASE_KEY:'';

    if(!supabase.functions)supabase.functions={};
    if(typeof supabase.functions.invoke!=='function'){
      supabase.functions.invoke=async function(name,options={}){
        try{
          const result=await supabase.auth.getSession();
          const session=result?.data?.session||null;
          if(!session?.access_token)return {data:null,error:{message:'Session absente ou expirée'}};
          const headers={
            'Authorization':'Bearer '+session.access_token,
            'Content-Type':'application/json',
            'Accept':'application/json'
          };
          if(key)headers.apikey=key;
          const response=await fetch(base+'/functions/v1/'+encodeURIComponent(name),{
            method:'POST',headers,body:JSON.stringify(options?.body??{})
          });
          const text=await response.text();
          let data=null;
          if(text){try{data=JSON.parse(text)}catch{data=text}}
          if(!response.ok){
            const message=(data&&typeof data==='object'&&data.error)?data.error:('Erreur Edge Function '+response.status);
            return {data:null,error:{message:String(message),status:response.status}};
          }
          return {data,error:null};
        }catch(error){
          return {data:null,error:{message:error?.message||'Requête Edge Function impossible'}};
        }
      };
    }

    if(typeof supabase.auth.signInWithOAuth!=='function'){
      supabase.auth.signInWithOAuth=async function(credentials={}){
        try{
          const provider=credentials?.provider;
          if(!provider)return {data:null,error:{message:'Provider OAuth manquant'}};
          const requested=credentials?.options?.redirectTo||location.origin+'/';
          const onFibrePages=location.protocol==='https:'&&(location.hostname==='intervention-fibre-final.pages.dev'||location.hostname.endsWith('.intervention-fibre-final.pages.dev'));
          const redirectTo=onFibrePages?location.origin+'/':requested;
          const url=new URL(base+'/auth/v1/authorize');
          url.searchParams.set('provider',provider);
          url.searchParams.set('redirect_to',redirectTo);
          if(credentials?.options?.scopes)url.searchParams.set('scopes',credentials.options.scopes);
          location.assign(url.toString());
          return {data:{provider,url:url.toString()},error:null};
        }catch(error){
          return {data:null,error:{message:error?.message||'Connexion OAuth impossible'}};
        }
      };
    }
  }catch(error){
    console.error('[FIBRE OPS] Supabase compat',error);
  }
})();