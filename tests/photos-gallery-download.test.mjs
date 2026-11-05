import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const D='dddddddd-dddd-4ddd-dddd-dddddddddddd';
const photographs=[
  {id:'photo-one',name:'chantier.jpg'},
  {id:'photo-two',name:'chantier.jpg'},
  {id:'photo-three',name:'armoire.jpg'}
];

async function fixture({sharing=true,failOn=''}={}){
  const dom=new JSDOM('<div><button id="f-save">Créer</button></div><div><button id="m-save-btn">Modifier</button></div>',{
    url:'https://test.example',runScripts:'outside-only'
  });
  const w=dom.window,shared=[],downloads=[],requests=[];
  let blobIndex=0;
  w.URL.createObjectURL=()=> 'blob:preview-'+(++blobIndex);
  w.URL.revokeObjectURL=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;if(this.onclose)this.onclose()};
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,href:this.href})};
  w.user={id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'};
  w.interventions=[];w.openEdit=()=>{};
  w.supabase={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};
  if(sharing){
    w.navigator.canShare=({files})=>files.every(f=>f.type==='image/jpeg');
    w.navigator.share=async ({files})=>{shared.push(files)};
  }else{
    w.navigator.canShare=()=>false;
    w.navigator.share=async()=>{throw Error('should not share')};
  }
  w.fetch=async (address,opts={})=>{
    const url=new URL(address,'https://test.example');
    requests.push({id:url.searchParams.get('photo'),authorization:opts.headers?.Authorization});
    if(url.searchParams.get('access'))return Response.json({enabled:true});
    if(!url.searchParams.get('photo'))return Response.json({files:photographs});
    if(url.searchParams.get('photo')===failOn)return Response.json({error:'Photo non accessible'},{status:403});
    return new Response(new Uint8Array([255,216,255,5,4,3]),{headers:{'content-type':'image/jpeg'}});
  };
  w.eval(await readFile('photos-test.js','utf8'));
  await w.FibrePhotos.open({id:D});
  const wait=()=>new Promise(resolve=>setTimeout(resolve,30));
  return {w,dom,shared,downloads,requests,wait};
}
test('historique : flèches, clavier et glissement tactile changent de photo sans quitter le dossier',async()=>{
  const f=await fixture();
  try{
    const {w,wait}=f;
    const views=w.document.querySelectorAll('#photoList [data-view]');
    assert.equal(views.length,3);
    views[0].click();await wait();
    assert.equal(w.document.getElementById('photoCounter').textContent,'1 / 3');
    w.document.getElementById('photoNext').click();await wait();
    assert.equal(w.document.getElementById('photoCounter').textContent,'2 / 3');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await wait();
    assert.equal(w.document.getElementById('photoCounter').textContent,'1 / 3');
    const img=w.document.querySelector('#photoViewer img');
    const start=new w.Event('touchstart');Object.defineProperty(start,'touches',{value:[{clientX:225,clientY:130}]});
    const end=new w.Event('touchend');Object.defineProperty(end,'changedTouches',{value:[{clientX:80,clientY:130}]});
    img.dispatchEvent(start);img.dispatchEvent(end);await wait();
    assert.equal(w.document.getElementById('photoCounter').textContent,'2 / 3');
    assert.ok(f.requests.some(r=>r.id==='photo-two'&&r.authorization==='Bearer mock'));
  }finally{f.dom.window.close()}
});
test('iPhone : partage trois images originales séparées, sans ZIP et sans doublon de nom',async()=>{
  const f=await fixture();
  try{
    const {w,wait}=f;
    const button=w.document.getElementById('photoDownloadAll');
    assert.equal(button.hidden,false);
    button.click();await wait();await wait();
    assert.match(button.textContent,/Enregistrer les 3 photos/);
    assert.equal(f.shared.length,0);
    button.click();await wait();
    assert.equal(f.shared.length,1);
    assert.equal(f.shared[0].length,3);
    assert.ok(f.shared[0].every(file=>file.type==='image/jpeg'&&file.size===6));
    assert.equal(new Set(f.shared[0].map(file=>file.name)).size,3);
    assert.ok(f.shared[0].every(file=>!file.name.endsWith('.zip')));
  }finally{f.dom.window.close()}
});
test('navigateur sans partage groupé : demande trois téléchargements individuels',async()=>{
  const f=await fixture({sharing:false});
  try{
    const button=f.w.document.getElementById('photoDownloadAll');
    button.click();await f.wait();await f.wait();
    button.click();await f.wait();
    assert.equal(f.downloads.length,3);
    assert.ok(f.downloads.every(item=>item.name.endsWith('.jpg')));
    assert.equal(new Set(f.downloads.map(item=>item.name)).size,3);
    assert.equal(f.shared.length,0);
  }finally{f.dom.window.close()}
});
test('une photo inaccessible bloque le lot sans exposer ou partager les autres',async()=>{
  const f=await fixture({failOn:'photo-two'});
  try{
    const button=f.w.document.getElementById('photoDownloadAll');
    button.click();await f.wait();await f.wait();
    assert.match(f.w.document.getElementById('photoStatus').textContent,/interrompue.*Photo non accessible/);
    assert.equal(f.shared.length,0);assert.equal(f.downloads.length,0);
    assert.match(button.textContent,/Télécharger toutes/);
  }finally{f.dom.window.close()}
});
