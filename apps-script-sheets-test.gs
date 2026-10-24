const FIBRE_OPS_SHEET_ID = '1UqtwDaimRNjYcAcKO6Rzo_Z6NV0wQdsDuxeeG4zrZis';
const FIBRE_OPS_TECH = 'Brendan';
const FIBRE_OPS_VERSION = '2';

function fibreJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function fibreSheet_() {
  const sheet = SpreadsheetApp.openById(FIBRE_OPS_SHEET_ID).getSheetByName(FIBRE_OPS_TECH);
  if (!sheet) throw new Error('Onglet Brendan introuvable');
  return sheet;
}
function fibreNorm_(value) { return String(value == null ? '' : value).trim(); }
function fibreDateFr_(value) {
  const s=fibreNorm_(value),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function fibreFindById_(sheet,id) {
  id=fibreNorm_(id); if(!id||sheet.getLastRow()<2)return 0;
  const values=sheet.getRange(2,15,sheet.getLastRow()-1,1).getDisplayValues();
  for(let i=0;i<values.length;i++)if(fibreNorm_(values[i][0])===id)return i+2;
  return 0;
}
function fibreWriteRow_(sheet,row,p) {
  sheet.getRange(row,1).setValue(fibreDateFr_(p.date));
  sheet.getRange(row,2).setValue(fibreNorm_(p.num));
  sheet.getRange(row,3).setValue(fibreNorm_(p.addr));
  sheet.getRange(row,4).setValue(fibreNorm_(p.typo));
  sheet.getRange(row,5).setValue(fibreNorm_(p.statut)||'Réussite');
  sheet.getRange(row,6).setValue(fibreNorm_(p.op));
  sheet.getRange(row,8).setValue(fibreNorm_(p.solo)||'Solo');
  sheet.getRange(row,9).setValue(Number(p.montant)||0);
  sheet.getRange(row,10).setValue(fibreNorm_(p.comment));
  sheet.getRange(row,15).setValue(fibreNorm_(p.id));
}
function fibreAppend_(sheet,p) {
  const id=fibreNorm_(p.id); if(!id)return {ok:false,error:'id_required'};
  const existing=fibreFindById_(sheet,id);
  if(existing){fibreWriteRow_(sheet,existing,p);return {ok:true,action:'update_existing_create',row:existing,id};}
  const previous=Math.max(2,sheet.getLastRow()),row=sheet.getLastRow()+1;
  sheet.insertRowAfter(sheet.getLastRow());
  if(previous>=2){
    sheet.getRange(previous,1,1,15).copyTo(sheet.getRange(row,1,1,15),SpreadsheetApp.CopyPasteType.PASTE_FORMAT,false);
    [7,11,12,13,14].forEach(col=>{if(sheet.getRange(previous,col).getFormula())sheet.getRange(previous,col).copyTo(sheet.getRange(row,col),SpreadsheetApp.CopyPasteType.PASTE_FORMULA,false);});
  }
  fibreWriteRow_(sheet,row,p); return {ok:true,action:'create',row,id};
}
// Legacy reads are intentionally disabled, including requests to old public URLs.
function doGet(e) {
  return fibreJson_({ok:false,error:'authenticated_backend_required'});
}
function fibreAuthorize_(raw) {
  const secret=PropertiesService.getScriptProperties().getProperty('FIBRE_OPS_WEBHOOK_SECRET');
  if(!secret||secret.length<32)throw new Error('authenticated_backend_required');
  if(!raw||raw.length>32768)throw new Error('invalid_request');
  const envelope=JSON.parse(raw),timestamp=Number(envelope.timestamp),nonce=String(envelope.nonce||'');
  if(!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>300000||!/^[a-zA-Z0-9-]{20,80}$/.test(nonce))throw new Error('invalid_request');
  const payload=String(envelope.payload||''),given=String(envelope.signature||'').toLowerCase();
  const expected=Utilities.computeHmacSha256Signature(timestamp+'\n'+nonce+'\n'+payload,secret,Utilities.Charset.UTF_8)
    .map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  let diff=expected.length^given.length;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^(given.charCodeAt(i)||0);
  if(diff!==0)throw new Error('unauthorized');
  const cache=CacheService.getScriptCache(),key='nonce:'+nonce;
  if(cache.get(key))throw new Error('replayed_request');
  cache.put(key,'1',600);
  return JSON.parse(payload);
}
function doPost(e) {
  const lock=LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const raw=e&&e.postData&&e.postData.contents; if(!raw)return fibreJson_({ok:false,error:'empty_body'});
    const p=fibreAuthorize_(raw),action=fibreNorm_(p.action).toLowerCase()||'create',sheet=fibreSheet_();
    if(action==='create')return fibreJson_(fibreAppend_(sheet,p));
    const id=fibreNorm_(p.id); if(!id)return fibreJson_({ok:false,error:'id_required_for_'+action});
    const row=fibreFindById_(sheet,id);
    if(!row)return fibreJson_({ok:false,error:'row_not_found',action,id});
    if(action==='update'){fibreWriteRow_(sheet,row,p);return fibreJson_({ok:true,action:'update',row,id});}
    if(action==='delete'){sheet.deleteRow(row);return fibreJson_({ok:true,action:'delete',row,id});}
    return fibreJson_({ok:false,error:'unsupported_action',action});
  } catch(err){return fibreJson_({ok:false,error:String(err&&err.message||err)});}
  finally{lock.releaseLock();}
}
