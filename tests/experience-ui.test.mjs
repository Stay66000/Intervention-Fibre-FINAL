import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
async function fixture({hidden=false}={}){
  const dom=new JSDOM(read('index.html'),{url:'https://fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
  const {window:w}=dom;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
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
  assert.match(f.w.document.getElementById('interventionSheetBody').textContent,/Personnel/);
  assert.equal(f.run('interventions.reduce((s,e)=>s+personalPart(e),0)'),240);
  const filter=f.w.document.getElementById('histWork');
  filter.value='Binôme';filter.dispatchEvent(new f.w.Event('change'));
  assert.deepEqual([...f.w.document.querySelectorAll('#histList .rw')].map(e=>e.dataset.id),['pair']);
  filter.value='Personal';filter.dispatchEvent(new f.w.Event('change'));
  assert.deepEqual([...f.w.document.querySelectorAll('#histList .rw')].map(e=>e.dataset.id),['personal']);
  assert.equal(f.run("interventions.find(e=>e.id==='personal').workMode"),'Personal');
 }finally{f.close()}
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
  assert.ok(f.w.document.getElementById('interventionSheet').classList.contains('active'));
  assert.equal(f.w.document.querySelector('#interventionSheetBody img'),null);
  assert.match(f.w.document.getElementById('interventionSheetBody').textContent,/<img src=x/);
  f.click('closeInterventionSheet');
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
  f.run("FibreExperience.openIntervention('row-a')");assert.match(f.w.document.getElementById('interventionSheetBody').textContent,/Prix masqué/);assert.doesNotMatch(f.w.document.getElementById('interventionSheetBody').textContent,/123[,.]45/);
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
