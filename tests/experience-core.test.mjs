import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../experience-core.js',import.meta.url),'utf8'),ctx);
const core=ctx.FibreExperienceCore;
test('filtering handles accents, period boundaries and combinations',()=>{
 const rows=[{id:'a',date:'2026-10-19',op:'orange',typo:'Aérien',statut:'Réussite',workMode:'Solo'},{id:'b',date:'2026-10-24',op:'sfr',typo:'Aérien',statut:'Échec',workMode:'Binôme'},{id:'c',date:'2026-09-30',op:'orange',typo:'Souterrain'}];
 const context={month:'2026-10',today:'2026-10-24',weekStart:'2026-10-19'};
 assert.deepEqual(Array.from(core.filterHistory(rows,{period:'week',query:'aerien',operator:'orange'},context),x=>x.id),['a']);
 assert.deepEqual(Array.from(core.filterHistory(rows,{period:'today'},context),x=>x.id),['b']);
 assert.equal(core.filterHistory(rows,{period:'month'},context).length,2);assert.equal(core.filterHistory(rows,{period:'all'},context).length,3);
});
test('stale or foreign preferences never select an unavailable type or teammate',()=>{
 const result=core.validDefaults({operator:'free',typeId:'foreign-type',soloUserId:'old-partner',workMode:'Solo'},['orange'],[{id:'type',operator:'orange',active:true}],true,'me',[{id:'me'}]);
 assert.equal(result.operator,'orange');assert.equal(result.typeId,'');assert.equal(result.soloUserId,'me');
 assert.equal(core.validDefaults({},['orange'],[],false,'me',[]).workMode,'Personal');
});
