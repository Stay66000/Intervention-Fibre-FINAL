(function(){
  'use strict';

  // SANDBOX UNIQUEMENT : corrige les adresses venant du duplicata Google Sheets
  // avant que sheets-pull.js ne les analyse ou les importe.
  const SANDBOX_ENDPOINT='AKfycbwM6g4kJWdwFKGhj_4Jt77gMjnlH4khqFapjuWnb00EgZMbpLXlmO8tdKYl0gLXCIks';

  function cleanAddress(v){
    let s=String(v||'');
    if(!s)return s;

    // Répare les mojibakes UTF-8 classiques d'abord.
    const mojibake=[
      [/Ã©/g,'é'],[/Ã¨/g,'è'],[/Ãª/g,'ê'],[/Ã«/g,'ë'],
      [/Ã /g,'à'],[/Ã¢/g,'â'],[/Ã®/g,'î'],[/Ã¯/g,'ï'],
      [/Ã´/g,'ô'],[/Ã¶/g,'ö'],[/Ã¹/g,'ù'],[/Ã»/g,'û'],[/Ã§/g,'ç'],
      [/â€™/g,"'"],[/â€“/g,'-'],[/â€”/g,'-']
    ];
    for(const [re,to] of mojibake)s=s.replace(re,to);

    // Cas réellement observés dans les adresses Brendan.
    // On corrige par mot/contexte pour ne jamais transformer un vrai A de « Avenue ».
    const fixes=[
      [/RenÂ\b/gi,'René'],
      [/HonorÂ\b/gi,'Honoré'],
      [/GÂnAral\b/gi,'Général'],
      [/GÂnÂral\b/gi,'Général'],
      [/MarÂchal\b/gi,'Maréchal'],
      [/ChaÂnes\b/gi,'Chaînes'],
      [/SorÂde\b/gi,'Sorède'],
      [/St-AndrA\b/gi,'St-André'],
      [/Saint-AndrA\b/gi,'Saint-André'],
      [/MoliÂ["”“]?re\b/gi,'Molière'],
      [/CamAlas\b/gi,'Camélas'],
      [/RiviAre\b/gi,'Rivière'],
      [/RibÂral\b/gi,'Ribéral']
    ];
    for(const [re,to] of fixes)s=s.replace(re,to);

    s=s.replace(/[\u0000-\u001F\u007F]/g,' ')
       .replace(/\bIE\b/gi,' ')
       .replace(/^\s*[,;\-]+\s*/,'')
       .replace(/\s*,\s*,+/g,', ')
       .replace(/\s+([,;])/g,'$1')
       .replace(/([,;])(?=\S)/g,'$1 ')
       .replace(/\s{2,}/g,' ')
       .trim()
       .replace(/\s*[,;\-]+\s*$/,'');
    return s.trim();
  }

  window.__FIBRE_FIX_ADDRESS__=cleanAddress;

  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const response=await originalFetch(input,init);
    if(!url.includes(SANDBOX_ENDPOINT)||!response.ok)return response;
    try{
      const data=await response.clone().json();
      if(!Array.isArray(data))return response;
      const fixed=data.map(row=>{
        if(!row||typeof row!=='object')return row;
        const copy={...row};
        if('addr' in copy)copy.addr=cleanAddress(copy.addr);
        if('address' in copy)copy.address=cleanAddress(copy.address);
        return copy;
      });
      return new Response(JSON.stringify(fixed),{
        status:response.status,
        statusText:response.statusText,
        headers:{'Content-Type':'application/json; charset=utf-8'}
      });
    }catch(_){
      return response;
    }
  };
})();
