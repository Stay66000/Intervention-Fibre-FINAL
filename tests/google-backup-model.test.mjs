import test from 'node:test';
import assert from 'node:assert/strict';
import {planMirror,monthlyRow,monthTitle,amount,JOURNAL,LEGACY,gridRequests,dailyFormula} from '../supabase/functions/_shared/google-backup-model.mjs';
const at='2026-10-30T00:00:00Z';
const sample={id:'id-1',intervention_date:'2026-10-15',operator:'orange',intervention_type_name:'Aérien',reference:'00123',address:'12 rue Test',notes:'',result:'Réussite',applied_amount:175,operator_data:{supplement:{amount:25,comment:'Poteau'}},work_mode:'Personal'};
const book=()=>[{title:'Octobre 2026',sheetId:1,values:[Array(20).fill('')]},{title:'Novembre 2026',sheetId:2,values:[Array(20).fill('')]},{title:JOURNAL,sheetId:3,values:[['Event ID']]},{title:LEGACY,sheetId:4,values:[['Archive ID']]}];
function apply(sheets,plan){for(const w of plan.writes){const sheet=sheets.find(s=>s.sheetId===w.sheetId);while(sheet.values.length<w.row)sheet.values.push([]);for(let i=0;i<w.values.length;i++)sheet.values[w.row-1][w.col+i]=w.values[i]}return sheets}
const event=(snapshot=sample,id='job-1',action='upsert')=>({id,intervention_id:snapshot.id,action,snapshot});
function active(sheets){return sheets.filter(s=>!s.title.startsWith('_')).flatMap(s=>s.values.slice(1).filter(r=>r[18]).map(r=>({title:s.title,row:r})))}
function run(sheets,snapshots,jobs=[],reconcile=false){return planMirror({sheets,snapshots,jobs,reconcile,at})}
test('create, replay, and updates of every supported field keep the exact row',()=>{
 const sheets=book();apply(sheets,run(sheets,[sample],[event()]));assert.equal(active(sheets).length,1);
 const replay=run(sheets,[sample],[event()]);assert.equal(replay.writes.length,0);
 for(const patch of [{address:'24 rue Nouvelle'},{operator:'free'},{result:'Échec'},{result:'Réussite'},{applied_amount:200},{work_mode:'Binôme',backup_personal_amount:100},{operator_data:{supplement:{amount:50,comment:'Ajout'}}},{intervention_date:'2026-10-20'},{notes:'=IMPORTXML("https://evil.test")'},{reference:'000099'}]){
  Object.assign(sample,patch);apply(sheets,run(sheets,[sample],[event(sample,crypto.randomUUID())]));
  assert.equal(active(sheets).length,1);assert.equal(sheets[0].values[1][18],sample.id);assert.equal(sheets[0].values.length,2);
 }
});
test('month moves clear every old occurrence and write only one target row atomically',()=>{
 const sheets=book(),s={...sample,intervention_date:'2026-10-15'};apply(sheets,run(sheets,[s],[event(s)]));
 sheets[0].values.push([...sheets[0].values[1]]);
 const moved={...s,intervention_date:'2026-11-01'},plan=run(sheets,[moved],[event(moved,'move')]);
 apply(sheets,plan);assert.equal(active(sheets).length,1);assert.equal(active(sheets)[0].title,'Novembre 2026');assert.equal(plan.report.duplicates,1);
 assert.equal(run(sheets,[moved],[event(moved,'move')]).writes.length,0);
});
test('delete, replay an older upsert after deletion, and recreation never resurrect a ghost',()=>{
 const sheets=book(),s={...sample,intervention_date:'2026-10-15'};apply(sheets,run(sheets,[s],[event(s)]));
 apply(sheets,run(sheets,[],[event(s,'delete','delete')]));assert.equal(active(sheets).length,0);
 apply(sheets,run(sheets,[],[event(s,'old-upsert')]));assert.equal(active(sheets).length,0);
 const fresh={...s,id:'new-immutable-id'};apply(sheets,run(sheets,[fresh],[event(fresh,'recreate')]));assert.equal(active(sheets).length,1);assert.equal(active(sheets)[0].row[18],fresh.id);
});
test('two quick edits and replayed delayed jobs always use latest Supabase state',()=>{
 const sheets=book(),old={...sample,address:'old'},latest={...sample,address:'latest'};
 apply(sheets,run(sheets,[latest],[event(old,'older'),event(latest,'newer')]));
 assert.equal(active(sheets)[0].row[2],'latest');assert.equal(active(sheets).length,1);
 apply(sheets,run(sheets,[latest],[event(old,'older')]));assert.equal(active(sheets)[0].row[2],'latest');
});
test('startup comparison detects changed money, duplicates, missing rows, month moves, and ghosts',()=>{
 const sheets=book(),s={...sample,intervention_date:'2026-10-15'};
 sheets[0].values.push(monthlyRow(s,at),monthlyRow(s,at),monthlyRow({...s,id:'deleted-id'},at));sheets[0].values[1][8]=999;
 const missing={...s,id:'missing'},plan=run(sheets,[s,missing],[],true);apply(sheets,plan);
 assert.equal(plan.report.changed,1);assert.equal(plan.report.duplicates,1);assert.equal(plan.report.deleted,1);assert.equal(plan.report.missing,1);
 assert.deepEqual(new Set(active(sheets).map(x=>x.row[18])),new Set([s.id,missing.id]));
 assert.equal(run(sheets,[s,missing],[],true).writes.length,0);
});
test('ID-less legacy rows are preserved separately, never matched by address/reference, and never overwritten by creation',()=>{
 const sheets=book(),s={...sample,intervention_date:'2026-10-15'};
 const legacy=monthlyRow(s,at),originalAddress=legacy[2];legacy[18]='';sheets[0].values.push(legacy);
 const added=run(sheets,[s],[event(s)]);apply(sheets,added);assert.equal(sheets[0].values[1][2],legacy[2]);assert.equal(sheets[0].values[2][18],s.id);
 const plan=run(sheets,[s],[],true);apply(sheets,plan);assert.equal(plan.report.legacy,1);assert.equal(sheets[0].values[1][8],'');assert.equal(JSON.parse(sheets[3].values[1][4])[2],originalAddress);
 assert.equal(run(sheets,[s],[],true).writes.length,0);
});
test('amount uses stored complement-inclusive payout exactly once; hidden prices never leak',()=>{
 const s={...sample,applied_amount:175,backup_personal_amount:87.5};assert.equal(amount(s),87.5);
 assert.equal(amount({...s,result:'Échec'}),0);assert.equal(amount({...s,backup_price_hidden:true}),'');
 const row=monthlyRow({...s,backup_price_hidden:true},at);assert.equal(row[8],'');assert.equal(row[15],'');assert.equal(row[6],'');
});
test('all user content is typed as literal strings; only the trusted daily total is a formula',()=>{
 const requests=gridRequests([{sheetId:1,row:2,col:0,values:['2026-10-01','00123','=IMPORTXML("bad")','','','',dailyFormula]}]);
 const cells=requests[0].updateCells.rows[0].values;assert.deepEqual(cells[1],{userEnteredValue:{stringValue:'00123'}});assert.ok(cells[2].userEnteredValue.stringValue);assert.ok(cells[6].userEnteredValue.formulaValue);
});
test('invalid dates and missing immutable IDs stop the write',()=>{
 assert.throws(()=>monthTitle('2026-02-30'),/INVALID/);assert.throws(()=>run(book(),[],[{id:'job',snapshot:{}}]),/IMMUTABLE/);
});
test('French formulas use semicolons and summary cells never reserve intervention rows',async()=>{
 const {formulaSeparator}=await import('../supabase/functions/_shared/google-backup-model.mjs');
 assert.equal(formulaSeparator('fr_FR'),';');assert.equal(formulaSeparator('en_US'),',');
 const sheets=book();for(let i=1;i<6;i++){sheets[0].values.push([]);sheets[0].values[i][10]='Summary'}
 const s={...sample,intervention_date:'2026-10-01'};
 const plan=planMirror({sheets,snapshots:[s],jobs:[event(s)],separator:';',at});
 const monthly=plan.writes.find(w=>w.sheetId===1&&w.col===0);assert.equal(monthly.row,2);assert.match(monthly.values[6],/;/);assert.doesNotMatch(monthly.values[6],/,/);
 assert.ok(gridRequests([monthly])[0].updateCells.rows[0].values[6].userEnteredValue.formulaValue);
});
