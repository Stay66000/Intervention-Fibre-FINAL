/* Private preview only. Original application handlers run against a local fixture.
   This file is never injected by the production middleware. */
(async function(){
  'use strict';
  // Internal HTTP preview lacks the secure-context UUID helper; hosted HTTPS has it.
  if(!crypto.randomUUID)crypto.randomUUID=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(document.readyState==='loading')await new Promise(r=>document.addEventListener('DOMContentLoaded',r,{once:true}));
  const functional=document.body.dataset.functionalPreview==='true';const KEY=functional?'fibreops_functional_preview_v1':'fibreops_mobile_private_v1', uid='preview-technician';
  const result=data=>({data:structuredClone(data),error:null});
  const disabled=async()=>({data:null,error:{message:'Indisponible dans cette démo locale. Aucun service externe contacté.'}});
  const date=iso();
  const seed=()=>{
    const ops=['orange','bouygues','sfr','free'];
    const ty=ops.flatMap((operator,i)=>[
      {id:'type-'+i+'-a',user_id:uid,team_id:null,operator,name:'Aérien façade',amount:150,active:true,sort_order:0},
      {id:'type-'+i+'-b',user_id:uid,team_id:null,operator,name:'Souterrain',amount:118,active:true,sort_order:1},
      {id:'type-'+i+'-c',user_id:uid,team_id:null,operator,name:'Raccordement immeuble · longueur exceptionnelle',amount:58,active:true,sort_order:2}
    ]);
    return {
      profiles:[{id:uid,email:'technicien.demo@exemple.invalid',first_name:'Brendan',last_name:'Démo',role:'technician',active:true,onboarding_completed:true,company_id:null}],
      user_settings:[{user_id:uid,theme:'dark',accent_color:'#35d0e0',compact_mode:false,preferences:{daily_goal:400}}],
      user_operators:ops.map(operator=>({user_id:uid,team_id:null,operator,active:true,supplements_enabled:true})),
      intervention_types:ty,
      intervention_supplement_types:ops.map((operator,i)=>({id:'supp-'+i,user_id:uid,team_id:null,operator,name:'Passage complexe · complément de raccordement',amount:37.60,active:true,sort_order:0})),
      interventions:Array.from({length:12},(_,i)=>{
        const t=ty[(i%4)*3+(i%3)],d=new Date();d.setDate(d.getDate()-Math.floor(i/4));
        return {id:'demo-intervention-'+i,user_id:uid,team_id:null,company_id:null,work_mode:'Personal',solo_user_id:uid,
          intervention_date:iso(d),operator:t.operator,intervention_type_id:t.id,intervention_type_name:t.name,applied_amount:i===5?0:t.amount,
          result:i===5?'Échec':'Réussite',reference:i===0?'JETON-FREE-EXEMPLE-REFERENCE-TRES-LONGUE-1234567890':'DEMO-'+(1000+i),
          address:i%2?'12 avenue des Platanes, 66000 Perpignan':'Résidence Les Terrasses du Canigou, bâtiment B, 125 avenue du Général-de-Gaulle, 66000 Perpignan',
          notes:'Intervention fictive pour tester la mise en page mobile.',operator_data:{},created_at:new Date().toISOString()};
      }),
      fuel_expenses:[{id:'demo-fuel',user_id:uid,team_id:null,expense_date:date,amount:65,station:'Station de démonstration · Perpignan',notes:'Données fictives',created_at:new Date().toISOString()}],
      invoice_profiles:[{user_id:uid,business_name:'Fibre Démo',legal_name:'Technicien Démo',address_line1:'12 avenue de Démonstration',postal_code:'66000',city:'Perpignan',country:'France',email:'demo@exemple.invalid',legal_status:'Micro-entrepreneur',vat_exempt:true,default_payment_terms_days:30}],
      invoice_clients:[{id:'demo-client',user_id:uid,name:'Société de raccordement de démonstration',address_line1:'45 avenue des Réseaux',postal_code:'66000',city:'Perpignan',email:'client@exemple.invalid'}],invoices:[],invoice_reconciliations:[]
    };
  };
  let db;try{db=JSON.parse(localStorage.getItem(KEY))}catch{}if(!db)db=seed();
  const persist=()=>localStorage.setItem(KEY,JSON.stringify(db));
  class Query {
    constructor(table){this.table=table;this.filters=[];this.mode='read';this.one=false;}
    select(){return this;}order(){return this;}limit(){return this;}
    eq(k,v){this.filters.push(x=>x[k]===v);return this;}
    is(k,v){this.filters.push(x=>(x[k]??null)===v);return this;}
    in(k,v){this.filters.push(x=>v.includes(x[k]));return this;}
    maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}
    insert(payload){this.mode='insert';this.payload=payload;return this;}
    update(payload){this.mode='update';this.payload=payload;return this;}
    delete(){this.mode='delete';return this;}
    then(resolve,reject){return Promise.resolve().then(()=>{
      db[this.table]??=[];let rows=db[this.table].filter(x=>this.filters.every(f=>f(x)));
      if(this.mode==='insert'){
        rows=(Array.isArray(this.payload)?this.payload:[this.payload]).map(x=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),...x}));
        if(this.table==='interventions')rows.forEach(x=>{
          const t=db.intervention_types.find(t=>t.id===x.intervention_type_id);
          x.intervention_type_name=t?.name||'';x.applied_amount=x.result==='Échec'?0:Number(t?.amount||0)+Number(x.operator_data?.supplement?.amount||0);
        });
        db[this.table].push(...rows);
      }
      if(this.mode==='update')rows.forEach(x=>Object.assign(x,this.payload));
      if(this.mode==='delete')db[this.table]=db[this.table].filter(x=>!rows.includes(x));
      if(this.mode!=='read')persist();
      return result(this.one?(rows[0]||null):rows);
    }).then(resolve,reject);}
  }
  const rpc=async(name,p={})=>{
    if(name==='get_my_independent_interventions')return result(db.interventions);
    if(name==='reconcile_my_legacy_sheet_supplements')return result({corrected_count:0,added_amount:0});
    if(['get_my_team','get_my_team_invite','get_my_company_context','company_get_my_work_status','get_my_company_invites_v2','get_my_company_intervention_history','get_my_password_setup_status'].includes(name))return result([]);
    if(name==='delete_my_intervention') {db.interventions=db.interventions.filter(x=>x.id!==p.p_intervention_id);persist();return result(true);}
    if(name==='set_operator_active'){db.user_operators.find(x=>x.operator===p.p_operator).active=p.p_active;persist();return result(true);}
    if(name==='delete_intervention_type'||name==='delete_intervention_supplement_type'){
      const table=name==='delete_intervention_type'?'intervention_types':'intervention_supplement_types';
      db[table]=db[table].filter(x=>x.id!==(p.p_type_id||p.p_supplement_id));persist();return result(true);
    }
    if(name==='invoice_save_profile'||name==='invoice_save_client'){
      const record=Object.fromEntries(Object.entries(p).map(([k,v])=>[k.replace(/^p_/,''),v]));record.user_id=uid;
      const table=name==='invoice_save_profile'?'invoice_profiles':'invoice_clients';
      const id=record.client_id||record.id;let old=table==='invoice_profiles'?db[table][0]:db[table].find(x=>x.id===id);
      if(old)Object.assign(old,record);else{record.id=crypto.randomUUID();db[table].push(record);}persist();return result(old||record);
    }
    return disabled();
  };
  supabase={from:table=>new Query(table),rpc,functions:{invoke:disabled},auth:{
    getSession:async()=>({data:{session:functional?{access_token:'local-fixture-only',user:{id:uid}}:null},error:null}),getUser:async()=>({data:{user:{id:uid}},error:null}),
    signInWithOAuth:disabled,signUp:disabled,resetPasswordForEmail:disabled,updateUser:disabled,
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),consumeRedirectSession:()=>null,
    signOut:async()=>{location.href='/?view=connexion';return {error:null};},
    signInWithPassword:async()=>{await start();return {error:null};}
  }};
  if(functional){
    const fileDB=()=>new Promise((resolve,reject)=>{const request=indexedDB.open('fibreops-functional-fixtures',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    async function fileStore(path,value,action='put'){const db=await fileDB();return new Promise((resolve,reject)=>{const tx=db.transaction('files',action==='get'?'readonly':'readwrite'),store=tx.objectStore('files');let result;const req=action==='get'?store.get(path):action==='delete'?store.delete(path):store.put(value,path);req.onsuccess=()=>result=req.result;tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>{db.close();reject(tx.error)}})}
    for(let n=1;n<=2;n++){const canvas=document.createElement('canvas');canvas.width=840;canvas.height=1120;const ctx=canvas.getContext('2d');ctx.fillStyle='#f4f8fc';ctx.fillRect(0,0,840,1120);ctx.fillStyle='#102b3a';ctx.fillRect(0,0,840,160);ctx.fillStyle='#52e4ed';ctx.font='bold 38px system-ui';ctx.fillText('FIBRE OPS · EXEMPLE FICTIF',40,75);ctx.fillStyle='#153344';ctx.font='bold 32px system-ui';ctx.fillText('AIPR · Page '+n+' sur 2',40,255);ctx.font='24px system-ui';ctx.fillText('Aucune valeur officielle.',40,340);ctx.fillText('Démonstration de consultation des documents.',40,400);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await fileStore(uid+'/sample-'+n,blob)}
    if(!db.professional_documents){db.professional_documents=[{id:'sample-document',user_id:uid,kind:'AIPR',name:'AIPR · exemple fictif de 2 pages',obtained_on:date,expires_on:null,reminders_enabled:true,reminder_days:30,notes:'Fichier fictif. Interface de la branche fonctionnelle ; stockage de test local.',file_path:null,created_at:new Date().toISOString()}];db.professional_document_pages=[1,2].map(n=>({id:'sample-page-'+n,user_id:uid,document_id:'sample-document',position:n-1,file_path:uid+'/sample-'+n,file_name:'Exemple fictif — page '+n+'.png',mime_type:'image/png',byte_size:1}));persist()}
    const originalFetch=window.fetch.bind(window);window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.origin!=='https://preview.invalid')return originalFetch(input,options);const prefix='/storage/v1/',path=url.pathname.slice(prefix.length),bucket='professional-documents/';if(!url.pathname.startsWith(prefix))return new Response('Fixture only',{status:400});if(path.startsWith('object/sign/'+bucket)){const file=decodeURIComponent(path.slice(('object/sign/'+bucket).length));if(!file.startsWith(uid+'/'))return new Response('{}',{status:403});if(options.method==='POST')return Response.json({signedURL:'/object/sign/'+bucket+file+'?token=fixture'});const blob=await fileStore(file,null,'get');return blob?new Response(blob,{headers:{'Content-Type':blob.type}}):new Response('{}',{status:404})}if(path.startsWith('object/'+bucket)&&options.method==='POST'){const file=decodeURIComponent(path.slice(('object/'+bucket).length));if(!file.startsWith(uid+'/'))return new Response('{}',{status:403});await fileStore(file,options.body);return Response.json({Key:file})}if(path==='object/professional-documents'&&options.method==='DELETE'){for(const file of JSON.parse(options.body).prefixes){if(!file.startsWith(uid+'/'))return new Response('{}',{status:403});await fileStore(file,null,'delete')}return Response.json([])}return new Response('{}',{status:400})};
  }
  user={id:uid};profile=db.profiles[0];settings=db.user_settings[0];
  // Never allow this preview to obtain or send real credentials or invitations.
  window.FibreGoogleBackup={onAccountReady(){},refresh:async()=>{},databaseSaved(){},getStatus:()=>({connected:false})};
  async function start(){
    await enterApp();renderAccentSwatches();
    const requested=new URLSearchParams(location.search).get('view');
    if(['dashboard','saisie','historique','finances','profil','carburant','tarifs','facturation','documents'].includes(requested))navigateView(requested);
    if(requested==='documents')await window.FibreDocumentsV2?.load();
    if(requested==='reglages')window.FibreSettingsFinal?.open();
    if(requested==='reglages-ouverts'){
      window.FibreSettingsFinal?.open();
      document.querySelectorAll('#foSettingsPage .fo-accordion-card:not(.fo-open) > .fo-accordion-trigger').forEach(b=>b.click());
    }
    if(requested==='profil-ouvert'){
      navigateView('profil');
      document.querySelectorAll('#view-profil .fo-accordion-card:not(.fo-open) > .fo-accordion-trigger').forEach(b=>b.click());
    }
    if(requested?.startsWith('facturation-')){
      navigateView('facturation');await loadBillingData();
      billingShowPane(requested.slice('facturation-'.length));
    }
    if(requested==='societe-modification'){navigateView('facturation');await loadBillingData();await billingOpenSellerModal(false);}
    if(requested==='modification'){navigateView('historique');openEdit(db.interventions[0].id);}
    if(requested==='tableau'){navigateView('historique');$('histTable').click();}
    if(requested==='onboarding'){prepareOnboarding();$('appShell').classList.add('app-hidden');$('onboardingGate').classList.remove('app-hidden');}
    if(requested==='onboarding-tarifs'){
      prepareOnboarding();document.querySelectorAll('#obOperators input').forEach(x=>x.checked=true);showOb(3);
      $('appShell').classList.add('app-hidden');$('onboardingGate').classList.remove('app-hidden');
    }
    document.querySelectorAll('.experience-table-wrap,.recon-table-wrap').forEach(el=>{el.tabIndex=0;el.setAttribute('aria-label','Tableau défilant horizontalement');});
    window.FibreSettingsFinal?.syncIdentity();
    updateStatus('Démo locale');
  }
  $('previewReset').onclick=()=>{localStorage.removeItem(KEY);location.reload();};
  if(new URLSearchParams(location.search).get('view')==='connexion'){
    $('authStatus').textContent='Démo privée : aucun compte ni mot de passe requis.';
    const b=document.createElement('button');b.className='btn-soft';b.textContent='Ouvrir la démonstration';b.onclick=()=>{location.href='/';};$('authLoginPane').prepend(b);
  }else await start();
  document.body.dataset.previewReady='true';
  window.dispatchEvent(new Event('private-preview-ready'));
})();
