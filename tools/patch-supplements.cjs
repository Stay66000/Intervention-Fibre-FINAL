const fs=require('fs');

function mustReplace(src,needle,replacement,label){
  if(!src.includes(needle))throw new Error('Motif introuvable: '+label);
  return src.replace(needle,replacement);
}
function mustRegex(src,re,replacement,label){
  if(!re.test(src))throw new Error('Motif regex introuvable: '+label);
  re.lastIndex=0;
  return src.replace(re,replacement);
}

let html=fs.readFileSync('index.html','utf8');
if(html.includes('FIBRE OPS INTERVENTION SUPPLEMENTS START')){
  console.log('Patch déjà appliqué');
  process.exit(0);
}

const css=`/* FIBRE OPS INTERVENTION SUPPLEMENTS START */
.intervention-supplement-card{margin:2px 0 14px;padding:11px 12px;border:1px dashed color-mix(in srgb,var(--accent) 32%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--accent-soft) 38%,var(--surface-alt))}
.intervention-supplement-card[hidden]{display:none!important}
.intervention-supplement-toggle{display:flex;align-items:center;gap:9px;font-weight:700;font-size:13px;cursor:pointer}
.intervention-supplement-toggle input{width:19px;height:19px;accent-color:var(--accent)}
.intervention-supplement-fields{display:none;margin-top:11px;padding-top:11px;border-top:1px solid var(--line)}
.intervention-supplement-card.enabled .intervention-supplement-fields{display:block}
.intervention-supplement-grid{display:grid;grid-template-columns:135px minmax(0,1fr);gap:9px}
.intervention-supplement-grid .field{margin-bottom:0}
.intervention-supplement-presets{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
.intervention-supplement-presets small{color:var(--ink-dim);font-size:11px}
.intervention-supplement-chip{min-height:30px;padding:4px 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--orange) 45%,var(--line));background:color-mix(in srgb,var(--orange) 10%,transparent);color:var(--orange);font-size:11.5px;font-weight:800;cursor:pointer}
.supplement-history-chip{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:700;background:var(--success-bg);color:var(--success)}
@media(max-width:520px){.intervention-supplement-grid{grid-template-columns:1fr}}
/* FIBRE OPS INTERVENTION SUPPLEMENTS END */

`;
html=mustReplace(html,'/* Historique et carburant */',css+'/* Historique et carburant */','insertion CSS');

const createBlock=`<!-- FIBRE OPS INTERVENTION SUPPLEMENTS START -->
<div class="intervention-supplement-card" id="f-supplement-card">
  <label class="intervention-supplement-toggle"><input id="f-supp-enabled" type="checkbox"/> ➕ Ajouter un complément d’intervention</label>
  <div class="intervention-supplement-fields" id="f-supp-fields">
    <div class="intervention-supplement-presets"><button class="intervention-supplement-chip" id="f-supp-apie" type="button">APIE</button><small id="f-supp-hint">Le motif sera repris automatiquement avec l’intervention.</small></div>
    <div class="intervention-supplement-grid">
      <div class="field"><label for="f-supp-amount">Montant du complément (€)</label><input id="f-supp-amount" inputmode="decimal" min="0" max="10000" step="0.01" type="number" placeholder="0,00"/></div>
      <div class="field"><label for="f-supp-comment">Motif / commentaire</label><input id="f-supp-comment" maxlength="200" type="text" placeholder="Complément d’intervention"/></div>
    </div>
  </div>
</div>
<!-- FIBRE OPS INTERVENTION SUPPLEMENTS END -->

`;
html=mustReplace(html,'<div class="preview">',createBlock+'<div class="preview">','formulaire création');

const modalAnchor=`<div class="field">
<label for="m-comment">Commentaires :</label>
<textarea id="m-comment" rows="2"></textarea>
</div>`;
const modalBlock=`${modalAnchor}

<!-- FIBRE OPS INTERVENTION SUPPLEMENTS START -->
<div class="intervention-supplement-card" id="m-supplement-card">
  <label class="intervention-supplement-toggle"><input id="m-supp-enabled" type="checkbox"/> ➕ Complément d’intervention</label>
  <div class="intervention-supplement-fields" id="m-supp-fields">
    <div class="intervention-supplement-presets"><button class="intervention-supplement-chip" id="m-supp-apie" type="button">APIE</button><small>Le montant total est recalculé automatiquement.</small></div>
    <div class="intervention-supplement-grid">
      <div class="field"><label for="m-supp-amount">Montant (€)</label><input id="m-supp-amount" inputmode="decimal" min="0" max="10000" step="0.01" type="number"/></div>
      <div class="field"><label for="m-supp-comment">Motif / commentaire</label><input id="m-supp-comment" maxlength="200" type="text"/></div>
    </div>
  </div>
</div>
<!-- FIBRE OPS INTERVENTION SUPPLEMENTS END -->`;
html=mustReplace(html,modalAnchor,modalBlock,'formulaire modification');

const helpers=`/* FIBRE OPS INTERVENTION SUPPLEMENTS START */
function supplementAmountFromData(data){
  const n=Number(data?.supplement?.amount||0);
  return Number.isFinite(n)&&n>0?Math.round(n*100)/100:0;
}
function supplementCommentFromData(data){return String(data?.supplement?.comment||'').trim()}
function supplementAllowed(){try{return !currentCompanyId()}catch{return true}}
function readInterventionSupplement(prefix='f'){
  const enabled=!!$(prefix+'-supp-enabled')?.checked&&supplementAllowed();
  const raw=Number($(prefix+'-supp-amount')?.value||0);
  const amount=enabled&&Number.isFinite(raw)?Math.round(raw*100)/100:0;
  const comment=enabled?(String($(prefix+'-supp-comment')?.value||'').trim()||'Complément d’intervention'):'';
  return{enabled,amount,comment};
}
function mergeSupplementOperatorData(existing,s){
  const data={...(existing&&typeof existing==='object'?existing:{})};
  if(s?.enabled&&s.amount>0)data.supplement={amount:s.amount,comment:s.comment||'Complément d’intervention'};
  else delete data.supplement;
  return data;
}
function syncSupplementCard(prefix='f'){
  const card=$(prefix+'-supplement-card');if(!card)return;
  const allowed=supplementAllowed()&&!(prefix==='m'&&card.dataset.company==='1');
  card.hidden=!allowed;
  if(!allowed)return;
  const enabled=!!$(prefix+'-supp-enabled')?.checked;
  card.classList.toggle('enabled',enabled);
  const apie=$(prefix+'-supp-apie');
  if(apie){
    const op=prefix==='f'?form.operator:(card.dataset.operator||'');
    apie.style.display=op==='orange'?'':'none';
  }
}
function setSupplementInputs(prefix,e){
  const card=$(prefix+'-supplement-card');if(!card)return;
  card.dataset.operator=e?.op||'';card.dataset.company=e?.companyId?'1':'0';
  const amount=Number(e?.supplementAmount||0),comment=String(e?.supplementComment||'');
  $(prefix+'-supp-enabled').checked=amount>0;
  $(prefix+'-supp-amount').value=amount>0?amount:'';
  $(prefix+'-supp-comment').value=comment||'';
  syncSupplementCard(prefix);
}
function clearSupplementInputs(prefix='f'){
  if(!$(prefix+'-supp-enabled'))return;
  $(prefix+'-supp-enabled').checked=false;$(prefix+'-supp-amount').value='';$(prefix+'-supp-comment').value='';
  syncSupplementCard(prefix);
}
function supplementHistoryChip(e){
  const amount=Number(e?.supplementAmount||0);if(!(amount>0))return'';
  const label=e?.supplementComment||'Complément';
  return `<span class="supplement-history-chip">＋${money(amount)} · ${esc(label)}</span>`;
}
function supplementAutomaticComment(e){
  const amount=Number(e?.supplementAmount||0);if(!(amount>0))return String(e?.comment||'');
  const label=String(e?.supplementComment||'Complément d’intervention');
  return [String(e?.comment||'').trim(),`${label} (+${money(amount)})`].filter(Boolean).join(' · ');
}
function bindSupplementInputs(prefix='f'){
  const enabled=$(prefix+'-supp-enabled'),amount=$(prefix+'-supp-amount'),comment=$(prefix+'-supp-comment'),apie=$(prefix+'-supp-apie');
  if(!enabled)return;
  enabled.addEventListener('change',()=>{
    if(enabled.checked&&!comment.value.trim())comment.value='Complément d’intervention';
    syncSupplementCard(prefix);if(prefix==='f'){preview();saveDraft()}
  });
  amount?.addEventListener('input',()=>{if(prefix==='f'){preview();saveDraft()}});
  comment?.addEventListener('input',()=>{if(prefix==='f')saveDraft()});
  apie?.addEventListener('click',()=>{
    enabled.checked=true;comment.value='APIE';syncSupplementCard(prefix);amount?.focus();if(prefix==='f'){preview();saveDraft()}
  });
}
bindSupplementInputs('f');bindSupplementInputs('m');
/* FIBRE OPS INTERVENTION SUPPLEMENTS END */

`;
html=mustReplace(html,'function preview(){',helpers+'function preview(){','helpers');
html=mustReplace(html,"function preview(){\n  const t=selectedType();","function preview(){\n  const t=selectedType();\n  syncSupplementCard('f');",'sync preview');
html=mustReplace(html,"  const base=form.result==='Échec'?0:(Number(t?.amount)||0);\n  let amount=base;","  const tariffBase=form.result==='Échec'?0:(Number(t?.amount)||0);\n  const supplement=readInterventionSupplement('f');\n  const base=tariffBase+(supplement.amount>0?supplement.amount:0);\n  let amount=base;",'calcul preview');
html=mustReplace(html,"\n  if($('previewDetail'))$('previewDetail').textContent=detail;","\n  if(supplement.amount>0){\n    const extra=`Complément ${money(supplement.amount)}${supplement.comment?' · '+supplement.comment:''}`;\n    detail=detail?`${detail} · ${extra}`:extra;\n  }\n  if($('previewDetail'))$('previewDetail').textContent=detail;",'detail preview');

const saveHead="  const date=$('f-date').value,reference=$('f-num').value.trim(),address=$('f-addr').value.trim(),notes=$('f-comment').value.trim(),t=selectedType();";
html=mustReplace(html,saveHead,saveHead+"\n  const supplement=readInterventionSupplement('f');\n  if(supplement.enabled&&(!(supplement.amount>0)||supplement.amount>10000))return toast('Indique un montant de complément entre 0,01 € et 10 000 €');",'validation save');
html=mustReplace(html,"result:form.result,reference:reference||null,address:address||null,notes:notes||null,operator_data:{}","result:form.result,reference:reference||null,address:address||null,notes:notes||null,operator_data:mergeSupplementOperatorData({},supplement)",'payload supplement');
html=mustReplace(html,"  $('f-num').value=$('f-addr').value=$('f-comment').value='';\n  $('f-typo').value='';form.typeId='';","  $('f-num').value=$('f-addr').value=$('f-comment').value='';\n  clearSupplementInputs('f');\n  $('f-typo').value='';form.typeId='';",'reset supplement');

html=html.replace(/comment:x\.notes\|\|'',created_at:x\.created_at/g,"comment:x.notes||'',operatorData:x.operator_data||{},supplementAmount:supplementAmountFromData(x.operator_data),supplementComment:supplementCommentFromData(x.operator_data),created_at:x.created_at");
if(!html.includes('supplementAmount:supplementAmountFromData'))throw new Error('Mapping operator_data non appliqué');

html=mustReplace(html,"[e.num,e.typo,e.addr,e.op,e.comment,e.workMode,memberName(e.soloUserId)]","[e.num,e.typo,e.addr,e.op,e.comment,e.supplementComment,e.workMode,memberName(e.soloUserId)]",'recherche historique');
html=mustReplace(html,"${mode}${e.readOnlyHistory?`<span class=\"history-company-chip\">🏢 ${esc(e.companyName||'Historique société')}</span>`:''}","${mode}${supplementHistoryChip(e)}${e.readOnlyHistory?`<span class=\"history-company-chip\">🏢 ${esc(e.companyName||'Historique société')}</span>`:''}",'badge historique');

const modalFill="  $('m-date').value=e.date;$('m-num').value=e.num;$('m-addr').value=e.addr;$('m-comment').value=e.comment;";
html=mustReplace(html,modalFill,modalFill+"\n  setSupplementInputs('m',e);",'prefill modal');

const updateBlock=`  const {error}=await supabase.from('interventions').update({
    intervention_date:$('m-date').value,
    reference:$('m-num').value.trim()||null,
    address:$('m-addr').value.trim()||null,
    notes:$('m-comment').value.trim()||null
  }).eq('id',editId);`;
const updateReplacement=`  const current=interventions.find(x=>x.id===editId);
  const supplement=readInterventionSupplement('m');
  if(supplement.enabled&&(!(supplement.amount>0)||supplement.amount>10000))return toast('Indique un montant de complément entre 0,01 € et 10 000 €');
  const {error}=await supabase.from('interventions').update({
    intervention_date:$('m-date').value,
    reference:$('m-num').value.trim()||null,
    address:$('m-addr').value.trim()||null,
    notes:$('m-comment').value.trim()||null,
    operator_data:mergeSupplementOperatorData(current?.operatorData||{},supplement)
  }).eq('id',editId);`;
html=mustReplace(html,updateBlock,updateReplacement,'update modal');

html=mustRegex(html,/function saveDraft\(\)\{[^\n]+\}\nfunction restoreDraft\(\)\{[^\n]+\}/,`function saveDraft(){
  if(!user)return;
  const supplement=readInterventionSupplement('f');
  const d={date:$('f-date').value,num:$('f-num').value,addr:$('f-addr').value,comment:$('f-comment').value,typeId:form.typeId,operator:form.operator,result:form.result,workMode:form.workMode,soloUserId:form.soloUserId,supplement};
  if(!d.num&&!d.addr&&!d.comment&&!d.typeId&&!supplement.enabled)return localStorage.removeItem(draftKey());
  localStorage.setItem(draftKey(),JSON.stringify(d));
}
function restoreDraft(){
  if(!user)return;
  try{
    const d=JSON.parse(localStorage.getItem(draftKey())||'null');if(!d)return;
    $('f-date').value=d.date||iso();$('f-num').value=d.num||'';$('f-addr').value=d.addr||'';$('f-comment').value=d.comment||'';
    if(activeOps().includes(d.operator))form.operator=d.operator;form.result=d.result||'Réussite';form.typeId=d.typeId||'';
    if(hasTeam()){form.workMode=d.workMode==='Solo'?'Solo':'Binôme';form.soloUserId=teamMembers.some(m=>m.id===d.soloUserId)?d.soloUserId:user.id}else{form.workMode='Personal';form.soloUserId=user.id}
    if(d.supplement?.enabled){$('f-supp-enabled').checked=true;$('f-supp-amount').value=d.supplement.amount||'';$('f-supp-comment').value=d.supplement.comment||'Complément d’intervention'}else clearSupplementInputs('f');
    populateOperatorUI();setSeg('f-op',form.operator);setSeg('f-statut',form.result);setSeg('f-work-mode',form.workMode);if($('f-solo-tech'))$('f-solo-tech').value=form.soloUserId;toggleSoloFields();fillTypeSelect($('f-typo'),form.operator,form.typeId);syncSupplementCard('f');preview();toast('📝 Brouillon restauré')
  }catch{}
}`,'draft supplement');

html=html.replace('V3 Production 1.3','V3 Production 1.4');
fs.writeFileSync('index.html',html);

let bridge=fs.readFileSync('sheets-bridge.js','utf8');
if(!bridge.includes('function sheetCommentWithSupplement')){
  bridge=mustReplace(bridge,'  function bodyFor(e,action=\'\',oldNum=\'\',idOverride=\'\'){',`  function sheetCommentWithSupplement(e){
    const base=String(e?.comment||'').trim();
    const amount=Number(e?.supplementAmount||0);
    if(!(amount>0))return base;
    const label=String(e?.supplementComment||'Complément d’intervention').trim()||'Complément d’intervention';
    const moneyText=amount.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
    return [base,\`${'${label}'} (+\${moneyText})\`].filter(Boolean).join(' · ');
  }
  function bodyFor(e,action='',oldNum='',idOverride=''){`,'bridge helper');
  bridge=mustReplace(bridge,"techSolo:profile?.first_name||TECH,apie:false,montant:Number(e.montant)||0,comment:e.comment||'',tech:TECH","techSolo:profile?.first_name||TECH,apie:String(e.supplementComment||'').trim().toUpperCase()==='APIE',montant:Number(e.montant)||0,comment:sheetCommentWithSupplement(e),tech:TECH",'bridge body');
}
fs.writeFileSync('sheets-bridge.js',bridge);

// Validation rapide des scripts inline de index.html.
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(m=>!/^<script[^>]*\bsrc=/i.test(m[0])).map(m=>m[1]);
const cp=require('child_process'),os=require('os'),path=require('path');
inline.forEach((code,i)=>{const p=path.join(os.tmpdir(),`fibre-inline-${i}.js`);fs.writeFileSync(p,code);cp.execFileSync(process.execPath,['--check',p],{stdio:'pipe'});fs.unlinkSync(p)});
cp.execFileSync(process.execPath,['--check','sheets-bridge.js'],{stdio:'inherit'});

console.log('Compléments d’intervention appliqués et syntaxe validée.');
