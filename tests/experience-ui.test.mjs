import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
async function fixture({hidden=false}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
  const {window:w}=dom;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};w.AbortSignal.timeout=()=>new w.AbortController().signal;
  w.fetch=async()=>{throw new Error('Real network is forbidden in UI tests')};
  const ctx=dom.getInternalVMContext(),run=code=>vm.runInContext(code,ctx);
  for(const match of read('index.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc=/.test(match[1]))run(match[2]);
  await new Promise(resolve=>setTimeout(resolve,0));
  run(`user={id:'account-a'};profile={id:'account-a',email:'fixture@security-test.invalid',first_name:'Brendan',last_name:'Test',role:'technician',active:true,onboarding_completed:true,company_id:${hidden?"'company-a'":'null'}};
    settings={theme:'dark',accent_color:'#35d0e0',preferences:{daily_goal:400}};
    companyContext=${hidden?"{company_id:'company-a',company_name:'Fixture',member_role:'technician',member_status:'active',company_status:'active'}":'null'};
    companyWorkStatus=${hidden?"{employment_type:'salaried',hide_prices:true}":'null'};
    team=null;teamMembers=[{id:user.id,first_name:'Brendan'}];
    operators=[{operator:'orange',active:true},{operator:'sfr',active:true}];
    types=[{id:'type-a',operator:'orange',name:'Aérien',active:true,amount:100},{id:'type-b',operator:'sfr',name:'Souterrain',active:true,amount:90}];
    interventions=[{id:'row-a',userId:user.id,date:iso(),op:'orange',typeId:'type-a',typo:'Aérien',montant:123.45,statut:'Réussite',num:'1234567890',addr:'12 rue Test',comment:'<img src=x onerror=alert(1)>',workMode:'Personal',created_at:new Date().toISOString(),readOnlyHistory:false}];fuel=[];
    supabase={auth:{getSession:async()=>({data:{session:null}})},from:()=>({update:()=>({eq:async()=>({error:null})}),insert:async()=>({error:null})})};
    populateOperatorUI();updateIdentityUI();$('appShell').classList.remove('app-hidden');$('authGate').classList.add('app-hidden');`);
  run(read('experience-core.js'));run(read('experience.js'));
  if(w.document.readyState==='loading')w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  run('renderAll();');
  const click=id=>w.document.getElementById(id).click();
  return {dom,w,run,click,close:()=>dom.window.close()};
}
test('reconciliation filters the operator and reports an unreadable amount',async()=>{
  const f=await fixture();try{
    f.run(`interventions.push({...interventions[0],id:'sfr-row',op:'sfr',num:'9876543210'});$('billingReconMonth').value=iso().slice(0,7);billingReconRenderOwnSummary();$('billingReconOperator').value='ORANGE';billingReconRenderOwnSummary();
      billingReconRaw={headers:['Référence','Montant'],rows:[['1234567890','inconnu']],mapping:{ref:0,amount:1,type:-1,status:-1,operator:-1}};billingReconPopulateMapping();`);
    assert.equal(f.run('billingReconOwnRows().length'),1);
    assert.equal(f.run('billingReconCompareData().errors.length'),1);
    assert.match(f.run('billingReconCompareData().errors[0].issues.join()'),/Montant société non reconnu/);
    f.run("$('billingReconOperator').value='SFR';billingReconRenderOwnSummary()");
    assert.equal(f.run('billingReconOwnRows()[0].reference'),'9876543210');
  }finally{f.close()}
});
test('reconciliation compares the full pair price without changing personal payout',async()=>{
 const f=await fixture();try{
  f.run(`team={id:'team-a'};teamMembers=[{id:user.id},{id:'account-b'}];interventions=[{...interventions[0],workMode:'Binôme',teamId:'team-a',montant:160}];
    $('billingReconMonth').value=iso().slice(0,7);billingReconRenderOwnSummary();
    billingReconRaw={headers:['Référence','Montant'],rows:[['1234567890','160']],mapping:{ref:0,amount:1,type:-1,status:-1,operator:-1}};billingReconPopulateMapping();`);
  assert.equal(f.run('personalPart(interventions[0])'),80);
  assert.equal(f.run('billingReconCompareData().oursTotal'),160);
  assert.equal(f.run('billingReconCompareData().errors.length'),0);
 }finally{f.close()}
});
test('Orange article codes determine the typology and unknown combinations remain flagged',async()=>{
 const f=await fixture();try{
  assert.equal(f.run("billingReconOrangeArticleType('1.0 LSOUP | 1.0 LSOU2')"),'Souterrain');
  assert.equal(f.run("billingReconOrangeArticleType('SAVA 1')"),'SAV');
  assert.equal(f.run("billingReconOrangeArticleType('LSA2 | LSAFP')"),'Aérien');
  assert.equal(f.run("billingReconOrangeArticleType('LSIMP | LSIM2')"),'Immeuble');
  assert.equal(f.run("billingReconOrangeHasApie('LSOUP | PSER2 | LSOU2')"),true);
  assert.equal(f.run("billingReconOrangeHasApie('XPSER2')"),false);
  assert.match(f.run("billingReconOrangeArticleType('LSOUP')"),/À vérifier/);
  assert.match(f.run("billingReconOrangeArticleType('LSA2 LSAFP SAVA1')"),/À vérifier/);
  f.run("$('billingReconMonth').value=iso().slice(0,7);billingReconRenderOwnSummary();$('billingReconOperator').value='ORANGE';interventions[0].typo='Appartement'");
  const data=await f.run(`billingReconReadFile({name:'test.csv',text:async()=> 'Référence;Liste des articles;Montant\\n1234567890;LSIMP LSIM2;123,45'})`);
  f.w.testData=data;f.run('billingReconRaw=window.testData;billingReconPopulateMapping()');
  assert.equal(f.run('billingReconCompareData().errors.length'),0);
  f.run("billingReconRaw.rows[0][1]='LSIMP LSIM2 PSER2';billingReconRenderResult(billingReconCompareData())");
  assert.match(f.w.document.getElementById('billingReconTable').textContent,/Complément APIE \(PSER2\)/);
  f.run("billingReconRaw.rows[0][billingReconRaw.mapping.type]='À vérifier : codes Orange non reconnus ou ambigus'");
  assert.match(f.run('billingReconCompareData().errors[0].issues.join()'),/Typologie/);
 }finally{f.close()}
});
test('a manually selected intervention date survives interface changes and a successful save',async()=>{
 const f=await fixture();try{
  f.w.fetch=async()=>({ok:true});
  f.run(read('fibre-compliance.js'));
  if(f.w.document.readyState==='loading')f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
  f.run("$('f-date').value='2025-01-15';$('f-date').dispatchEvent(new Event('input',{bubbles:true}));document.body.appendChild(document.createElement('div'))");
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(f.run("$('f-date').value"),'2025-01-15');
  await f.w.fetch('https://example.supabase.co/rest/v1/interventions',{method:'POST'});
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal(f.run("$('f-date').value"),'2025-01-15');
 }finally{f.close()}
});
test('joining a team keeps personal history labelled correctly across cards, dashboard and editors',async()=>{
 const f=await fixture();try{
  f.run(`team={id:'team-a'};teamMembers=[{id:user.id,first_name:'Brendan'},{id:'account-b',first_name:'Partner'}];
    const original=interventions[0];
    interventions=[{...original,id:'personal',num:'PERSONAL',workMode:'Personal',montant:100},
      {...original,id:'solo',num:'SOLO',workMode:'Solo',soloUserId:user.id,teamId:team.id,montant:60},
      {...original,id:'pair',num:'PAIR',workMode:'Binôme',soloUserId:null,teamId:team.id,montant:160}];
    updateIdentityUI();renderAll();navigateView('historique');`);
  const chip=id=>f.w.document.querySelector(`#histList [data-id="${id}"] .mode-chip`);
  assert.equal(chip('personal').textContent,'Personnel');
  assert.equal(chip('solo').textContent,'Solo · Brendan');
  assert.equal(chip('pair').textContent,'Binôme');
  assert.match(f.w.document.getElementById('splitTotals').textContent,/Personnel 100,00/);
  assert.deepEqual([...f.w.document.querySelectorAll('#dashRecent .chip')].map(e=>e.textContent).filter(t=>['Personnel','Solo · Brendan','Binôme'].includes(t)).sort(),['Binôme','Personnel','Solo · Brendan']);
  f.run("openEdit('personal')");
  assert.equal(f.w.document.getElementById('m-work-mode').dataset.val,'Personal');
  assert.equal(f.w.document.getElementById('m-personal-mode').hidden,false);
  assert.equal(f.w.document.querySelector('#m-work-mode button.selected').textContent.trim(),'👤 Personnel');
  f.run("openEdit('pair')");assert.equal(f.w.document.getElementById('m-personal-mode').hidden,true);
  f.run("FibreExperience.openIntervention('personal')");
  assert.equal(f.w.document.getElementById('detailModal').classList.contains('active'),true);
  assert.equal(f.run('interventions.reduce((s,e)=>s+personalPart(e),0)'),240);
  const filter=f.w.document.getElementById('histWork');
  filter.value='Binôme';filter.dispatchEvent(new f.w.Event('change'));
  assert.deepEqual([...f.w.document.querySelectorAll('#histList .rw')].map(e=>e.dataset.id),['pair']);
  filter.value='Personal';filter.dispatchEvent(new f.w.Event('change'));
  assert.deepEqual([...f.w.document.querySelectorAll('#histList .rw')].map(e=>e.dataset.id),['personal']);
  assert.equal(f.run("interventions.find(e=>e.id==='personal').workMode"),'Personal');
 }finally{f.close()}
});
test('settings do not reopen from a stale URL and closing clears only their own fragment',async()=>{
 const f=await fixture(),observers=[];
 const NativeObserver=f.w.MutationObserver;
 f.w.MutationObserver=class extends NativeObserver{constructor(callback){super(callback);observers.push(this)}};
 try{
  f.w.history.replaceState(null,'','/test?keep=1#reglages-avances');
  f.run(read('fibre-compliance.js'));
  if(f.w.document.readyState==='loading')f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(f.w.location.hash,'');
  assert.equal(f.w.location.search,'?keep=1');
  assert.equal(f.w.document.getElementById('foSettingsPage').classList.contains('active'),false);
  assert.equal(f.w.document.querySelector('.view.active').id,'view-saisie');
  f.click('foOpenAdvancedSettings');
  assert.equal(f.w.location.hash,'');
  assert.equal(f.w.document.querySelector('.view.active').id,'view-parametres');
  f.click('foSettingsBack');
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(f.w.location.hash,'');
  assert.equal(f.w.location.pathname,'/test');
  assert.equal(f.w.location.search,'?keep=1');
  assert.equal(f.w.document.getElementById('foSettingsPage').classList.contains('active'),false);
  assert.equal(f.w.document.querySelector('.view.active').id,'view-saisie');
  f.click('foOpenAdvancedSettings');
  f.w.history.replaceState(null,'','/test?keep=1#other');
  f.click('foSettingsBack');
  assert.equal(f.w.location.hash,'#other');
 }finally{observers.forEach(observer=>observer.disconnect());f.close()}
});
test('legacy supplement reconciliation runs once per account and retries after failure',async()=>{
 const f=await fixture();try{
  f.run(`globalThis.sheetChecks=0;supabase.rpc=async()=>{sheetChecks++;return {data:{corrected_count:1,added_amount:37.6},error:null}}`);
  await f.run('Promise.all([reconcileLegacySheetSupplements(),reconcileLegacySheetSupplements()])');
  await f.run('reconcileLegacySheetSupplements()');
  assert.equal(f.w.sheetChecks,1);assert.match(f.w.document.getElementById('toast').textContent,/37,60/);
  f.run(`user={id:'account-b'};supabase.rpc=async()=>{sheetChecks++;return {data:null,error:{message:'test failure'}}}`);
  await f.run('reconcileLegacySheetSupplements()');
  f.run(`supabase.rpc=async()=>{sheetChecks++;return {data:{corrected_count:0,added_amount:0},error:null}}`);
  await f.run('reconcileLegacySheetSupplements()');
  assert.equal(f.w.sheetChecks,3);
  f.run("companyContext={company_id:'company-a'};user={id:'account-c'}");
  await f.run('reconcileLegacySheetSupplements()');assert.equal(f.w.sheetChecks,3);
 }finally{f.close()}
});
test('company refresh preserves the safe technician editor and V2 date parameter',async()=>{
 const f=await fixture({hidden:true});try{
  f.run(`globalThis.rpcCalls=[];supabase.rpc=async(name,args)=>{rpcCalls.push({name,args});return {data:[],error:null}};
    loadAll=async()=>{};renderAll=()=>{};editId='row-a';
    document.getElementById('f-date').value='2026-10-26';
    document.getElementById('m-date').value='2026-10-26';
    document.getElementById('m-num').value='edited';`);
  f.run(read('company-v2.js'));f.run(read('company-v2-runtime-fix.js'));
  f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));
  const safe=f.w.document.getElementById('m-save-btn').onclick;
  f.run('FibreCompanyV2.refresh()');
  assert.equal(f.w.document.getElementById('m-save-btn').onclick,safe);
  await safe.call(f.w.document.getElementById('m-save-btn'),new f.w.Event('click'));
  const call=f.w.rpcCalls.find(c=>c.name==='company_v2_update_my_intervention');
  assert.ok(call);assert.equal(call.args.p_intervention_date,'2026-10-26');
  assert.equal(call.args.p_date,undefined);assert.equal(call.args.p_reference,'edited');
 }finally{f.close()}
});
test('five destinations route correctly and old settings remain functional',async()=>{
 const f=await fixture();try{
  assert.equal(f.w.document.querySelector('.view.active').id,'view-saisie');
  assert.deepEqual([...f.w.document.querySelectorAll('.tabbar button')].map(b=>b.dataset.view),['dashboard','historique','saisie','finances','profil']);
  f.w.document.querySelector('[data-view=finances]').click();assert.equal(f.w.document.querySelector('.view.active').id,'view-finances');
  f.w.document.querySelector('[data-experience-view=carburant]').click();assert.equal(f.w.document.querySelector('.view.active').id,'view-carburant');
  f.click('settingsBtn');assert.equal(f.w.document.querySelector('.view.active').id,'view-profil');
  assert.ok(f.w.document.querySelector('#profileSettings #logoutBtn'));
  const ids=[...f.w.document.querySelectorAll('[id]')].map(n=>n.id);assert.equal(new Set(ids).size,ids.length);
 }finally{f.close()}
});
test('history filters, table and detail sheet preserve read-only access and escape text',async()=>{
 const f=await fixture();try{
  f.run("navigateView('historique')");f.click('histTable');
  assert.equal(f.w.document.querySelectorAll('.experience-table tbody tr').length,1);
  f.w.document.querySelector('.experience-table .rw').click();
  assert.ok(f.w.document.getElementById('detailModal').classList.contains('active'));
  assert.equal(f.w.document.getElementById('interventionSheet').classList.contains('active'),false);
  assert.equal(f.w.document.getElementById('m-comment').value,'<img src=x onerror=alert(1)>');
  f.click('closeModal');
  f.run("interventions[0].readOnlyHistory=true;FibreExperience.openIntervention('row-a')");
  assert.equal(f.w.document.getElementById('interventionSheetEdit').hidden,true);
  f.click('closeInterventionSheet');
  f.w.document.getElementById('histOperator').value='sfr';f.w.document.getElementById('histOperator').dispatchEvent(new f.w.Event('change'));
  assert.equal(f.w.document.querySelectorAll('.experience-table tbody tr').length,0);
  f.click('histReset');assert.equal(f.w.document.querySelectorAll('.experience-table tbody tr').length,1);
 }finally{f.close()}
});
test('hidden company prices never appear in new finance, table or detail views',async()=>{
 const f=await fixture({hidden:true});try{
  f.run("navigateView('finances')");assert.doesNotMatch(f.w.document.getElementById('view-finances').textContent,/123[,.]45/);
  f.run("navigateView('historique')");f.click('histTable');assert.doesNotMatch(f.w.document.getElementById('histList').textContent,/123[,.]45/);
  f.run("interventions[0].readOnlyHistory=true;FibreExperience.openIntervention('row-a')");assert.match(f.w.document.getElementById('interventionSheetBody').textContent,/Prix masqué/);assert.doesNotMatch(f.w.document.getElementById('interventionSheetBody').textContent,/123[,.]45/);
 }finally{f.close()}
});
test('save and continue keeps choices, clears client fields and prevents concurrent inserts',async()=>{
 const f=await fixture();try{
  f.run(`window.insertCount=0;supabase.from=()=>({insert:async()=>{window.insertCount++;await new Promise(resolve=>setTimeout(resolve,10));return {error:null}}});loadAll=async()=>{};form.operator='orange';form.typeId='type-a';populateOperatorUI();$('f-num').value='0987654321';$('f-addr').value='Address';`);
  await f.run('Promise.all([saveIntervention(true),saveIntervention(true)])');
  assert.equal(f.w.insertCount,1);assert.equal(f.w.document.getElementById('f-num').value,'');assert.equal(f.w.document.getElementById('f-addr').value,'');
  assert.equal(f.run('form.typeId'),'type-a');assert.equal(f.w.document.getElementById('f-save-next').disabled,false);
  assert.match(f.w.document.getElementById('entrySaveStatus').textContent,/Prête pour la suivante/);
 }finally{f.close()}
});
test('a failed refresh after confirmed write does not report the save as failed',async()=>{
 const f=await fixture();try{
  f.run("form.typeId='type-a';populateOperatorUI();loadAll=async()=>{throw new Error('read failure')}");
  await f.run('saveIntervention(false)');
  assert.equal(f.w.document.getElementById('entrySaveStatus').dataset.state,'success');
  assert.equal(f.w.document.getElementById('f-save').disabled,false);
  assert.equal(f.run('form.typeId'),'');
 }finally{f.close()}
});
test('preferences are persisted per account without changing an existing draft',async()=>{
 const f=await fixture();try{
  f.run("window.savedPreferences=null;supabase.from=()=>({update:value=>({eq:async(key,id)=>{window.savedPreferences={value,id};return {error:null}}})});$('f-num').value='draft-ref';saveDraft();");
  const before=f.w.localStorage.getItem('fibreops_draft_account-a');
  f.w.document.getElementById('defaultOperator').value='sfr';f.w.document.getElementById('defaultOperator').dispatchEvent(new f.w.Event('change'));
  await f.w.document.getElementById('saveEntryDefaults').onclick();
  assert.equal(f.w.savedPreferences.id,'account-a');assert.equal(f.w.savedPreferences.value.preferences.experience.entryDefaults.operator,'sfr');
  assert.equal(f.w.localStorage.getItem('fibreops_draft_account-a'),before);
  await f.w.document.getElementById('resetEntryDefaults').onclick();assert.equal(f.w.localStorage.getItem('fibreops_draft_account-a'),before);
 }finally{f.close()}
});

test('settings use a dedicated page with working controls and no profile redirect',async()=>{
 const f=await fixture(),observers=[];
 const NativeObserver=f.w.MutationObserver;
 f.w.MutationObserver=class extends NativeObserver{constructor(cb){super(cb);observers.push(this)}};
 try{
  f.run(read('fibre-compliance.js'));f.run(read('settings-final.js'));
  await new Promise(resolve=>setTimeout(resolve,120));
  f.run("navigateView('historique')");
  f.click('settingsBtn');
  const page=f.w.document.getElementById('foSettingsPage');
  assert.equal(page.getAttribute('role'),'region');
  assert.equal(page.hasAttribute('aria-modal'),false);
  assert.equal(f.w.location.hash,'');
  assert.equal(f.w.document.querySelector('.view.active').id,'view-parametres');
  assert.ok(page.querySelector('#themeToggle'));
  assert.ok(page.querySelector('#changePasswordBtn')||page.textContent.includes('Sécurité'));
  assert.match(read('documents-v2.css'),/position:static/);
  f.click('foSettingsBack');
  assert.equal(page.classList.contains('active'),false);
  assert.equal(f.w.document.body.classList.contains('fo-settings-page-open'),false);
  assert.equal(f.w.document.querySelector('.view.active').id,'view-saisie');
  const ids=[...f.w.document.querySelectorAll('[id]')].map(n=>n.id);
  assert.equal(new Set(ids).size,ids.length);
 }finally{observers.forEach(o=>o.disconnect());f.close()}
});
test('documents support private metadata CRUD, filtering and no alert UI',async()=>{
 const f=await fixture(),observers=[];const NativeObserver=f.w.MutationObserver;
 f.w.MutationObserver=class extends NativeObserver{constructor(cb){super(cb);observers.push(this)}};
 try{
  f.run(`globalThis.savedDocs=[];globalThis.docWrites=[];supabase.from=table=>{let operation='select',payload,id;const q={select(){return q},eq(key,value){if(key==='id')id=value;return q},order(){return q},insert(p){operation='insert';payload=p;return q},update(p){operation='update';payload=p;return q},delete(){operation='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{if(table==='user_settings')return {data:null,error:null};if(table==='professional_document_pages')return {data:[],error:null};if(operation==='insert'){savedDocs.push({...payload});docWrites.push(payload)}if(operation==='update'){Object.assign(savedDocs.find(r=>r.id===id),payload);docWrites.push(payload)}if(operation==='delete'){const deleted=savedDocs.filter(r=>r.id===id);savedDocs=savedDocs.filter(r=>r.id!==id);return {data:deleted,error:null}}return {data:savedDocs.map(r=>({...r})),error:null}}).then(resolve,reject)}};return q};`);
  f.run(read('fibre-compliance.js'));f.run(read('settings-final.js'));f.run(read('documents-v2.js'));
  await new Promise(r=>setTimeout(r,150));
  f.click('settingsBtn');assert.equal(f.w.document.querySelector('.view.active').id,'view-parametres');
  assert.ok(f.w.document.querySelector('#view-parametres #settingsLogoutBtn'));
  assert.ok(f.w.document.querySelector('#view-profil .experience-account-head #logoutBtn'));
  let signouts=0;f.w.document.getElementById('logoutBtn').onclick=()=>signouts++;
  f.click('settingsLogoutBtn');f.click('logoutBtn');assert.equal(signouts,2);
  assert.ok(f.w.document.querySelector('#view-profil #openDocuments'));
  assert.equal(f.w.document.querySelector('#view-parametres #openDocuments'),null);
  f.run("navigateView('profil')");
  f.click('openDocuments');await new Promise(r=>setTimeout(r,5));
  assert.equal(f.w.document.querySelector('.view.active').id,'view-documents');
  assert.deepEqual([...f.w.document.getElementById('docKind').options].map(o=>o.value),['AIPR','CACES / R486','Habilitation électrique','Permis de conduire','Visite médicale','Carte pro','Autre']);
  f.click('docsBack');assert.equal(f.w.document.querySelector('.view.active').id,'view-profil');
  f.click('openDocuments');await new Promise(r=>setTimeout(r,5));
  f.w.document.getElementById('docName').value='<img src=x onerror=alert(1)>';
  f.w.document.getElementById('docExpires').value='2020-01-01';
  f.w.document.getElementById('docsForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));
  await new Promise(r=>setTimeout(r,10));
  assert.equal(f.w.docWrites[0].user_id,'account-a');assert.equal(f.w.docWrites[0].file_path,undefined);
  assert.equal(f.w.document.querySelector('#docsList img'),null);assert.match(f.w.document.getElementById('docsList').textContent,/Expiré/);
  assert.equal(f.w.document.getElementById('docsReminder'),null);assert.equal(f.w.docWrites[0].reminders_enabled,false);
  f.w.document.querySelector('[data-doc-edit]').click();f.w.document.getElementById('docName').value='AIPR renouvelée';f.w.document.getElementById('docExpires').value='';
  f.w.document.getElementById('docsForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));
  assert.match(f.w.document.getElementById('docsList').textContent,/Sans expiration/);
  f.w.document.querySelector('[data-doc-delete]').click();await new Promise(r=>setTimeout(r,10));assert.equal(f.w.savedDocs.length,0);
  f.run("user=null");f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));assert.equal(f.w.document.getElementById('docsReminder'),null);
 }finally{observers.forEach(o=>o.disconnect());f.close()}
});

test('document expiration statuses use entered dates including same day and leap day',async()=>{
 const f=await fixture();try{
  f.run(read('documents-v2.js'));await new Promise(r=>setTimeout(r,5));
  const status=f.w.FibreDocumentsV2.status;
  assert.equal(status({expires_on:null,reminder_days:30},'2026-11-01'),'Sans expiration');
  assert.equal(status({expires_on:'2026-11-01',reminder_days:0},'2026-11-01'),'Expire bientôt');
  assert.equal(status({expires_on:'2026-10-31',reminder_days:30},'2026-11-01'),'Expiré');
  assert.equal(status({expires_on:'2026-12-01',reminder_days:30},'2026-11-01'),'Expire bientôt');
  assert.equal(status({expires_on:'2026-12-02',reminder_days:30},'2026-11-01'),'Valide');
  assert.equal(status({expires_on:'2028-03-01',reminder_days:1},'2028-02-29'),'Expire bientôt');
 }finally{f.close()}
});

test('an ambiguous save retry keeps its client event ID and treats a confirmed uniqueness conflict as saved',async()=>{
 const f=await fixture();try{
  f.run(`window.submissions=[];window.phase=0;supabase.from=()=>({
    insert:async payload=>{window.submissions.push({...payload});return window.phase++===0?{error:{status:0,message:'Connection lost'}}:{error:{details:{code:'23505'}}}},
    select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'already-created'},error:null})})})})
  });loadAll=async()=>{};form.typeId='type-a';populateOperatorUI();$('f-num').value='NEW-RETRY';`);
  await f.run('saveIntervention(false)');assert.equal(f.w.document.getElementById('entrySaveStatus').dataset.state,'error');
  await f.run('saveIntervention(false)');assert.equal(f.w.submissions.length,2);assert.equal(f.w.submissions[0].client_event_id,f.w.submissions[1].client_event_id);
  assert.equal(f.w.document.getElementById('entrySaveStatus').dataset.state,'success');assert.equal(f.w.localStorage.getItem('fibreops_submission_account-a'),null);
 }finally{f.close()}
});

test('document form uploads and opens several private files without replacing older files',async()=>{
 const f=await fixture();try{
  f.run(`globalThis.testRows=[];globalThis.testPages=[];globalThis.storageCalls=[];
    supabase.auth.getSession=async()=>({data:{session:{access_token:'synthetic'}}});
    supabase.from=table=>{let op='select',payload,id;const q={select(){return q},eq(k,v){if(k==='id')id=v;return q},order(){return q},insert(p){op='insert';payload=p;return q},update(p){op='update';payload=p;return q},delete(){op='delete';return q},then(resolve,reject){return Promise.resolve().then(()=>{let a=table==='professional_documents'?testRows:testPages;if(op==='insert'){if(Array.isArray(payload))a.push(...payload);else a.push({...payload})}if(op==='update')Object.assign(a.find(r=>r.id===id),payload);if(op==='delete'){const n=a.findIndex(r=>r.id===id);if(n>=0)a.splice(n,1)}return {data:a.map(r=>({...r})),error:null}}).then(resolve,reject)}};return q};
    fetch=async(url,options)=>{storageCalls.push({url,method:options.method||'GET',body:options.body});return {ok:true,blob:async()=>new Blob(['image'],{type:'image/png'}),json:async()=>({signedURL:'/object/sign/professional-documents/account-a/test?token=synthetic'})}};`);
  f.w.URL.createObjectURL=()=> 'blob:synthetic-production-view';f.w.URL.revokeObjectURL=()=>{};
  f.run(read('documents-v2.js'));await new Promise(r=>setTimeout(r,5));
  let input=f.w.document.getElementById('docFile');Object.defineProperty(input,'files',{configurable:true,value:[new f.w.File(['pdf'],'one.pdf',{type:'application/pdf'}),new f.w.File(['png'],'two.png',{type:'image/png'})]});
  f.w.document.getElementById('docName').value='CACES';f.w.document.getElementById('docsForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,15));
  assert.equal(f.w.testRows.length,1);assert.equal(f.w.testPages.length,2);assert.deepEqual([...f.w.testPages].map(p=>p.position),[0,1]);f.w.document.querySelector('[data-doc-view]').click();assert.equal(f.w.document.querySelectorAll('[data-doc-open]').length,2);f.click('docsDetailClose');
  f.w.document.querySelector('[data-doc-edit]').click();Object.defineProperty(input,'files',{configurable:true,value:[new f.w.File(['pdf'],'three.pdf',{type:'application/pdf'})]});f.w.document.getElementById('docsForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,15));
  assert.equal(f.w.testPages.length,3);f.w.document.querySelector('[data-doc-view]').click();assert.equal(f.w.document.querySelectorAll('[data-doc-open]').length,3);assert.equal(f.w.storageCalls.filter(x=>x.method==='POST').length,3);f.w.document.querySelector('[data-page-index="1"]').click();await new Promise(r=>setTimeout(r,15));assert.ok(f.w.document.querySelector('.docs-photo'));const sign=f.w.storageCalls.find(x=>x.url.includes('/object/sign/'));assert.equal(JSON.parse(sign.body).expiresIn,60);f.w.document.querySelector('#docsFileViewer button').click();assert.equal(f.w.document.getElementById('docsFullscreen').open,true);f.w.document.querySelector('.docs-fullscreen-close').click();assert.equal(f.w.document.getElementById('docsFullscreen').open,false);f.run('user=null');f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));assert.equal(f.w.document.querySelector('.docs-photo'),null);
 }finally{f.close()}
});


test('documents do not present alerts or reminder controls',async()=>{
  const f=await fixture();try{
    f.run(read('documents-v2.js'));await new Promise(r=>setTimeout(r,5));
    assert.equal(f.w.FibreDocumentsV2.dailyDecision,undefined);
    assert.equal(f.w.document.getElementById('docsReminder'),null);
    assert.equal(f.w.document.getElementById('docOffsets'),null);
    assert.equal(f.w.document.getElementById('docEnabled'),null);
    assert.equal(f.w.document.querySelector('[data-doc-reminders]'),null);
  }finally{f.close()}
});
