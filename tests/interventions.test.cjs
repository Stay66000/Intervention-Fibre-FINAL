const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
function setup({write={data:{id:'one'},error:null},rpc={data:true,error:null},reload=async()=>{}}={}){
 const elements=new Map(),messages=[],calls=[];
 const $=id=>{if(!elements.has(id))elements.set(id,{value:'value',textContent:'Save',disabled:false,classList:{remove(){}}});return elements.get(id)};
 const item={id:'one',userId:'user',companyId:null,teamId:null,date:'2026-10-21',num:'old',addr:'old',comment:''};
 const c={$,console:{error(){}},navigator:{onLine:true},toast:m=>messages.push(m),updateStatus(){},confirm:()=>true,
 user:{id:'user'},form:{operator:'orange',result:'Réussite',typeId:'type'},interventions:[item],editId:'one',
 selectedType:()=>({id:'type'}),hasTeam:()=>false,isCompanyTechnician:()=>false,currentCompanyId:()=>null,
 localStorage:{removeItem(){}},draftKey:()=> 'draft',preview(){},renderAll(){},loadAll:reload,
 supabase:{from:()=>{const q={insert(p){calls.push(['insert',p]);return q},update(p){calls.push(['update',p]);return q},eq(k,v){calls.push(['eq',k,v]);return q},select(cols){calls.push(['select',cols]);return q},single:async()=>typeof write==='function'?write():write};return q},rpc:async(name,args)=>{calls.push(['rpc',name,args]);return rpc}}};
 vm.createContext(c);
 vm.runInContext(html.slice(html.indexOf('// A lock shared'),html.indexOf("$('f-save').onclick=saveIntervention;")),c);
 vm.runInContext(html.slice(html.indexOf("$('m-save-btn').onclick=async()=>{"),html.indexOf('\nfunction renderFuel(){')),c);
 return {c,$,messages,calls,item};
}
test('double submission sends one insert while request is pending',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const x=setup({write:()=>pending});
 const first=x.c.saveIntervention();await x.c.saveIntervention();
 assert.equal(x.calls.filter(c=>c[0]==='insert').length,1);
 resolve({data:{id:'one'},error:null});await first;assert.equal(x.$('f-save').disabled,false);
});
test('zero-row update never reports success and preserves local row',async()=>{
 const x=setup({write:{data:null,error:{status:406}}});await x.$('m-save-btn').onclick();
 assert.equal(x.item.num,'old');assert.match(x.messages.at(-1),/non confirmée/);assert.equal(x.$('m-save-btn').disabled,false);
});
test('confirmed update uses server values and exact ID',async()=>{
 const x=setup({write:{data:{id:'one',intervention_date:'2026-10-22',reference:'new',address:'here',notes:'note'},error:null}});
 await x.$('m-save-btn').onclick();assert.equal(x.item.num,'new');assert.ok(x.calls.some(c=>c[0]==='eq'&&c[2]==='one'));
 assert.ok(x.calls.some(c=>c[0]==='select'&&!c[1].includes('*')));
});
test('delete refusal preserves intervention',async()=>{
 const x=setup({rpc:{data:false,error:null}});await x.c.removeIntervention('one',x.$('delete'));
 assert.equal(x.c.interventions.length,1);assert.equal(x.$('delete').disabled,false);
});
test('confirmed deletion survives reload failure locally and reports refresh issue',async()=>{
 const x=setup({reload:async()=>{throw {status:503}}});await x.c.removeIntervention('one',x.$('delete'));
 assert.equal(x.c.interventions.length,0);assert.match(x.messages.at(-1),/Actualisation indisponible/);
});
test('creation reload failure does not imply failed insertion or retain submitted form',async()=>{
 const x=setup({reload:async()=>{throw {status:503}}});await x.c.saveIntervention();
 assert.equal(x.$('f-num').value,'');assert.match(x.messages.at(-1),/enregistrée.*Actualisation/);assert.equal(x.$('f-save').disabled,false);
});
test('unexpected exception restores button and keeps form',async()=>{
 const x=setup({write:()=>{throw new Error('failure')}});await x.c.saveIntervention();
 assert.equal(x.$('f-save').disabled,false);assert.equal(x.$('f-num').value,'value');
});
