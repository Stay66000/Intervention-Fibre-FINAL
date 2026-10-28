(function(){
  'use strict';
  if(window.FibreCaptureV2)return;
  window.FibreCaptureV2=true;

  const $id=id=>document.getElementById(id);
  function notify(msg){try{if(typeof toast==='function')return toast(msg)}catch{}console.info('[FIBRE OPS OCR]',msg)}
  function text(v){return String(v??'')}
  function normalizeAddress(v){
    let s=text(v)
      .replace(/\b(?:IE|M)\s+(?=\d)/i,'')
      .replace(/A-/g,'é')
      .replace(/\s+,/g,',')
      .replace(/,{2,}/g,',')
      .replace(/\s{2,}/g,' ')
      .trim();
    s=s.replace(/\b(\d{5})\s+([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ' -]{2,})$/,(m,cp,ville)=>`${cp} ${ville.replace(/\s+/g,' ')}`);
    return s;
  }
  function detectOperator(raw){
    const s=text(raw).toLowerCase();
    if(/\bfree\b|freebox|\bnd\s*[:#-]/i.test(s))return 'free';
    if(/\borange\b|orange et moi|intervention orange/i.test(s))return 'orange';
    if(/\bsfr\b|red by sfr/i.test(s))return 'sfr';
    if(/bouygues|bbox|bouygues telecom/i.test(s))return 'bouygues';
    return '';
  }
  function fallbackReference(raw,op){
    const s=text(raw).replace(/[Oo](?=(?:[ .]?\d){7,})/g,'0');
    const patterns=op==='free'
      ? [/\bND\s*[:#-]?\s*([A-Z0-9][A-Z0-9 ._-]{5,24})/i,/\bJETON\s*[:#-]?\s*([A-Z0-9][A-Z0-9 ._-]{5,24})/i]
      : [/\b(?:JETON|R[ÉE]F(?:[ÉE]RENCE)?|REFERENCE|N[°O]?\s*INTERVENTION|INTERVENTION)\s*[:#-]?\s*([A-Z0-9][A-Z0-9 ._-]{5,30})/i];
    for(const p of patterns){
      const m=s.match(p);
      if(m?.[1])return m[1].replace(/\s+/g,'').replace(/[^A-Z0-9_-]/gi,'').slice(0,40);
    }
    return '';
  }
  function mergeParsed(primary,secondary,raw){
    const a=primary||{},b=secondary||{};
    const op=a.op||b.op||detectOperator(raw)||'';
    const nd=a.nd||b.nd||fallbackReference(raw,op);
    const addr=normalizeAddress(a.addr||b.addr||'');
    return {op,nd,addr};
  }

  async function imageToCanvas(file,threshold=false){
    const bitmap=await createImageBitmap(file);
    const maxW=1800;
    const scale=Math.min(2,Math.max(1,maxW/bitmap.width));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    const img=ctx.getImageData(0,0,width,height),d=img.data;
    for(let i=0;i<d.length;i+=4){
      const gray=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
      let v=(gray-128)*1.55+128;
      if(threshold)v=v>155?255:v<90?0:v;
      v=Math.max(0,Math.min(255,v));d[i]=d[i+1]=d[i+2]=v;
    }
    ctx.putImageData(img,0,0);
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Prétraitement image impossible')),'image/png',1));
  }

  async function recognize(source,label){
    await loadT();
    const msg=$id('cap-msg');
    const result=await Tesseract.recognize(source,'fra',{logger:m=>{
      if(m.status==='recognizing text'&&msg){const pct=Math.max(1,Math.round((m.progress||0)*100));msg.textContent=`⏳ ${label} · ${pct}%`}
    }});
    return {raw:result?.data?.text||'',confidence:Number(result?.data?.confidence||0)};
  }

  function applyParsed(parsed,raw,confidence,passes){
    if(parsed.nd&&$id('f-num'))$id('f-num').value=parsed.nd;
    if(parsed.addr&&$id('f-addr'))$id('f-addr').value=parsed.addr;
    if(parsed.op&&typeof activeOps==='function'&&activeOps().includes(parsed.op)){
      form.operator=parsed.op;form.typeId='';
      if(typeof populateOperatorUI==='function')populateOperatorUI();
      if(typeof setSeg==='function')setSeg('f-op',parsed.op);
      if(typeof fillTypeSelect==='function')fillTypeSelect($id('f-typo'),parsed.op,'');
    }
    if(typeof preview==='function')preview();
    if(typeof saveDraft==='function')saveDraft();
    const found=[parsed.nd?'référence':'',parsed.addr?'adresse':'',parsed.op?'opérateur':''].filter(Boolean);
    const msg=$id('cap-msg');
    if(msg){
      if(found.length)msg.textContent=`✓ ${found.join(' + ')} détecté${found.length>1?'s':''}${confidence?` · confiance OCR ${Math.round(confidence)}%`:''}${passes>1?' · double lecture':''}`;
      else msg.textContent='⚠️ Rien trouvé : saisis à la main ou recadre davantage la capture.';
    }
    if($id('cap-raw'))$id('cap-raw').textContent=raw;
  }

  function patch(){
    const input=$id('cap-file');
    if(!input||input.dataset.captureV2==='1')return;
    input.dataset.captureV2='1';
    input.onchange=async function(){
      const file=this.files?.[0];this.value='';if(!file)return;
      const msg=$id('cap-msg');if(msg)msg.textContent='⏳ Analyse intelligente de la capture…';
      try{
        if(typeof capUrl!=='undefined'&&capUrl)URL.revokeObjectURL(capUrl);
        if(typeof capUrl!=='undefined')capUrl=URL.createObjectURL(file);
        const url=typeof capUrl!=='undefined'?capUrl:URL.createObjectURL(file);
        if($id('cap-img'))$id('cap-img').src=url;
        if($id('cap-link')){$id('cap-link').style.display='inline';$id('cap-link').textContent='📎 Voir la capture'}

        const first=await recognize(file,'Lecture 1/2');
        let p1=typeof parseCap==='function'?parseCap(first.raw):{};
        let combined=mergeParsed(p1,null,first.raw);
        let finalRaw=first.raw,confidence=first.confidence,passes=1;

        const weak=!combined.nd||!combined.addr||first.confidence<58;
        if(weak){
          try{
            const processed=await imageToCanvas(file,true);
            const second=await recognize(processed,'Lecture renforcée 2/2');
            const p2=typeof parseCap==='function'?parseCap(second.raw):{};
            combined=mergeParsed(p1,p2,`${first.raw}\n${second.raw}`);
            finalRaw=`--- Lecture originale ---\n${first.raw}\n\n--- Lecture renforcée ---\n${second.raw}`;
            confidence=Math.max(first.confidence,second.confidence);passes=2;
          }catch(error){console.warn('[FIBRE OPS OCR] second pass skipped',error)}
        }
        applyParsed(combined,finalRaw,confidence,passes);
      }catch(error){
        if(msg)msg.textContent='⚠️ Lecture impossible : '+(error?.message||error);
        notify('OCR impossible : '+(error?.message||error));
      }
    };
    if($id('cap-link'))$id('cap-link').onclick=()=>{const img=$id('cap-img');if(!img)return;const show=img.style.display==='none'||!img.style.display;img.style.display=show?'block':'none';$id('cap-link').textContent=show?'📎 Masquer la capture':'📎 Voir la capture'};
  }

  function enhanceHint(){
    const input=$id('cap-file');if(!input)return;
    const field=input.closest('.field');
    if(field&&!field.querySelector('.capture-v2-hint')){
      const hint=document.createElement('div');hint.className='capture-v2-hint';hint.innerHTML='<b>Lecture V2</b> · Orange, SFR, Bouygues et Free. Si la première lecture est incomplète, FIBRE OPS relance automatiquement une version contrastée de la capture.';
      field.appendChild(hint);
    }
  }
  function init(){patch();enhanceHint();setTimeout(()=>{patch();enhanceHint()},1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
