import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function cleanOcrLine('),html.indexOf('function loadT(')),ctx);
const parse=text=>JSON.parse(JSON.stringify(ctx.parseCap(text)));
test('Free extracts jeton and Cami address without adjacent client fields',()=>{
  assert.deepEqual(parse('Pose de PTO ZMD\nJeton 12345678\nAdresse : 6 CAMI DEL PLA 66500 EUS\nHexaclé : 66074222MP\nBâtiment : _NA_\nCommande\nJeton : 12345678'),{op:'free',nd:'12345678',addr:'6 Cami del Pla, 66500 Eus'});
});
test('Free formats a wrapped address and excludes building metadata',()=>{
  assert.deepEqual(parse('Jeton 23456789\nAdresse : 4 AVENUE ANNIBAL\n66420 LE BARCARES\nHexaclé : 66017227SL\nBâtiment : G7\nEtage : 1'),{op:'free',nd:'23456789',addr:'4 avenue Annibal, 66420 Le Barcarès'});
});
test('Free missing jeton never substitutes telephone or Hexaclé',()=>{
  assert.equal(parse('Pose de PTO ZMD\nMobile : 0612345678\nHexaclé : 1234567890').nd,'');
});
test('Free reads a jeton on the next line and repairs numeric OCR confusions',()=>{
  assert.equal(parse('Jeton :\n23 45 O6 I8').nd,'23450618');
});
test('Orange and SFR keep their reference extraction',()=>{
  assert.equal(parse('ND : 0468123456\nAdresse : 1 RUE TEST 66000 PERPIGNAN').nd,'0468123456');
  assert.equal(parse('OSIRIS\n123456789\nAdresse raccordement : 1 RUE TEST 66000 PERPIGNAN').op,'sfr');
});
test('importing Free selects it, clears the old type, fills ND/address and saves draft',async()=>{
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{style:{},value:'',textContent:''});return elements.get(id)};
  let saved=false;
  const context=vm.createContext({
    $,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},
    Tesseract:{recognize:async()=>({data:{text:'Jeton 12345678\nAdresse : 6 CAMI DEL PLA 66500 EUS'}})},
    window:{Tesseract:{}},form:{operator:'orange',typeId:'old-orange-type'},
    activeOps:()=>['orange','free'],populateOperatorUI:()=>{},setSeg:()=>{},
    fillTypeSelect:()=>{},preview:()=>{},saveDraft:()=>{saved=true},opLabel:op=>op
  });
  vm.runInContext(html.slice(html.indexOf('function cleanOcrLine('),html.indexOf('// General events')),context);
  const input=$('cap-file');input.files=[{}];
  await input.onchange();
  assert.equal(context.form.operator,'free');
  assert.equal(context.form.typeId,'');
  assert.equal($('f-num').value,'12345678');
  assert.equal($('f-addr').value,'6 Cami del Pla, 66500 Eus');
  assert.equal(saved,true);
});
