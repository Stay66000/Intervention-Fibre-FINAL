import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
test('lecture Orange active : retire les marqueurs parasites sans mutiler la voie',async()=>{
 const dom=new JSDOM('<input id="cap-file" type="file"><input id="f-num"><input id="f-addr"><span id="cap-msg"></span><span id="cap-raw"></span>',{url:'https://test.example',runScripts:'outside-only'}),w=dom.window;
 w.URL.createObjectURL=()=> 'blob:test';w.loadT=async()=>{};w.Tesseract={recognize:async()=>({data:{text:"PROD_GP_PLPC\nDescription de l’intervention\nND: 0101010101\nAdresse\nIE/M 26 rue de Prades\n66000 Perpignan",confidence:90}})};w.form={operator:'orange',typeId:''};w.activeOps=()=>['orange'];w.populateOperatorUI=()=>{};w.setSeg=()=>{};w.fillTypeSelect=()=>{};w.preview=()=>{};w.saveDraft=()=>{};
 const html=await readFile('index.html','utf8');w.eval(html.slice(html.indexOf('function cleanOcrLine('),html.indexOf('function loadT(')));w.eval(await readFile('capture-v2.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));let input=w.document.getElementById('cap-file');Object.defineProperty(input,'files',{value:[new w.File(['a'],'capture.png',{type:'image/png'})]});await input.onchange();assert.equal(w.document.getElementById('f-num').value,'0101010101');assert.equal(w.document.getElementById('f-addr').value,'26 rue de Prades, 66000 Perpignan');dom.window.close();
});
async function readOrangeDetails(first,second){
 const dom=new JSDOM('<input id="cap-file" type="file"><input id="f-num"><input id="f-addr"><span id="cap-msg"></span><span id="cap-raw"></span>',{url:'https://test.example',runScripts:'outside-only'}),w=dom.window;let reads=0;
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.loadT=async()=>{};w.Tesseract={recognize:async()=>({data:{text:reads++?second:first,confidence:90}})};w.createImageBitmap=async()=>({width:1320,height:2868,close(){}});
 const originalCreate=w.document.createElement.bind(w.document);w.document.createElement=function(tag){const el=originalCreate(tag);if(tag==='canvas'){el.getContext=()=>({drawImage(){},getImageData(){return {data:new Uint8ClampedArray(4)}},putImageData(){}});el.toBlob=cb=>cb(new w.Blob(['image'],{type:'image/png'}))}return el};
 w.form={operator:'orange',typeId:''};w.activeOps=()=>['orange'];w.populateOperatorUI=()=>{};w.setSeg=()=>{};w.fillTypeSelect=()=>{};w.preview=()=>{};w.saveDraft=()=>{};
 const html=await readFile('index.html','utf8');w.eval(html.slice(html.indexOf('function cleanOcrLine('),html.indexOf('function loadT(')));w.eval(await readFile('capture-v2.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));const input=w.document.getElementById('cap-file');Object.defineProperty(input,'files',{value:[new w.File(['a'],'capture.png',{type:'image/png'})]});await input.onchange();const result={nd:w.document.getElementById('f-num').value,address:w.document.getElementById('f-addr').value,reads};dom.window.close();return result;
}
test('écran Orange avec icônes : retire 5 à et conserve le ND et le code postal',async()=>{
 const base='CLIENT\nClient\nND\n0101010101\n7, Rue du Test 5 à\n66350 Ville\nRE PC\nCoordonnées intervention\nInfo site';const cropped=base.replace('Test 5 à','Test');const result=await readOrangeDetails(base,cropped);assert.equal(result.address,'7, Rue du Test, 66350 Ville');assert.equal(result.nd,'0101010101');assert.equal(result.reads,2);
});
test('écran Orange avec icônes : retire ë et garde le texte long',async()=>{
 const base='CLIENT\nND\n0101010101\n61, Avenue des Grandes Expositions ë\n66000 Ville\nRE PC\nInfo site';const result=await readOrangeDetails(base,base.replace('Expositions ë','Expositions'));assert.equal(result.address,'61, Avenue des Grandes Expositions, 66000 Ville');
});
test('ne tronque pas une fin de voie complète ou une ville divergente',async()=>{
 const base='CLIENT\nND\n0101010101\n61, Avenue des Oliviers bis\n66000 Ville\nRE PC\nInfo site';const result=await readOrangeDetails(base,base.replace('Oliviers bis','Oliviers'));assert.equal(result.address,'61, Avenue des Oliviers bis, 66000 Ville');
});
test('retire une icône lue comme e 2 après une voie longue',async()=>{
 const base='CLIENT\nND\n0101010101\n61, Avenue des Expositions e 2\n66000 Ville -\nRE PC\nInfo site';const result=await readOrangeDetails(base,base.replace('Expositions e 2','Expositions').replace('Ville -','Ville'));assert.equal(result.address,'61, Avenue des Expositions, 66000 Ville');
});
