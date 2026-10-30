// Pure planning: one immutable ID, one active row across the entire workbook.
export const JOURNAL = '_JOURNAL_BACKUP';
export const LEGACY = '_LEGACY_BACKUP';
export const MONTH = /^(Janvier|Février|Mars|Avril|Mai|Juin|Juillet|Août|Septembre|Octobre|Novembre|Décembre) \d{4}$/;
export const clean = (v, max = 500) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0,max);
const number = v => Number.isFinite(Number(v)) ? Number(v) : 0;
export const hidden = s => s?.backup_price_hidden === true || s?.backup_price_visibility === 'hidden';
export function monthTitle(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('INVALID_INTERVENTION_DATE');
  const d = new Date(date+'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==date) throw new Error('INVALID_INTERVENTION_DATE');
  return `${['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const success = s => /^(réuss|success)/i.test(s?.result || '');
const mode = s => s?.work_mode === 'Binôme' ? 'Binôme' : 'Solo';
const operator = s => ({orange:'Orange',sfr:'SFR',bouygues:'Bouygues Telecom',free:'Free'})[s?.operator] || clean(s?.operator,80);
export function supplement(s) {
  const data=s?.operator_data || {};
  return {label:clean(data.supplement?.comment ?? data.supplement_comment ?? data.supplement_label ?? '',200),amount:hidden(s)?'':number(data.supplement?.amount ?? data.supplement_amount)};
}
export function amount(s) {
  // applied_amount already includes the complement in Postgres; never add it twice.
  if(hidden(s))return '';
  if(!success(s))return 0;
  return Math.round(number(s.backup_personal_amount ?? s.applied_amount)*100)/100;
}
export const dailyFormula = '=IF(INDEX(A:A,ROW())="","",SUMIFS(I:I,A:A,INDEX(A:A,ROW()),E:E,"Réussite"))';
export function formulaSeparator(locale='en_US'){try{return new Intl.NumberFormat(locale.replace('_','-')).format(1.1).includes(',')?';':','}catch{return ','}}
export function monthlyRow(s,at,separator=',') {
  const supp=supplement(s);
  return [clean(s.intervention_date,20),clean(s.reference,120),clean(s.address,400),clean(s.intervention_type_name,160),success(s)?'Réussite':'Échec',operator(s),hidden(s)?'':dailyFormula.replaceAll(',',separator),mode(s),amount(s),clean(s.notes), '', '', '', '', supp.label,supp.amount,at,'Active',clean(s.id,80)];
}
export function journalRow(job,at) {
  const s=job.snapshot || {},supp=supplement(s);
  return [job.id,job.action,at,clean(s.intervention_date,20),clean(s.reference,120),clean(s.address,400),clean(s.intervention_type_name,160),success(s)?'Réussite':'Échec',operator(s),mode(s),job.action==='delete'?0:amount(s),clean(s.notes),supp.label,supp.amount,job.action==='delete'?'Supprimée dans FIBRE OPS':'Active',clean(job.intervention_id || s.id,80)];
}
function sameRow(actual,expected) {
  // Q is the sync timestamp; K:N is the summary table, never intervention data.
  return [0,1,2,3,4,5,6,7,8,9,14,15,17,18].every(i => {
    const a=actual[i] ?? '', b=expected[i] ?? '';
    return typeof b==='number' ? Math.abs(number(a)-b)<0.005 && a!=='' : String(a)===String(b);
  });
}
export function redactLegacyRow(row){const copy=[...row];for(const i of [6,8,10,11,12,13,15])copy[i]='';return copy}
export function planMirror({sheets, snapshots, jobs=[], reconcile=false, hidePrices=false, separator=',', at=new Date().toISOString()}) {
  const canonical=new Map(snapshots.map(s=>[s.id,s]));
  const targets=new Set(reconcile?canonical.keys():jobs.map(j=>j.intervention_id || j.snapshot?.id));
  const index=new Map(),next=new Map(),writes=[],events=[],legacy=[];
  const report={missing:0,changed:0,duplicates:0,moved:0,deleted:0,legacy:0};
  for(const sheet of sheets.filter(s=>MONTH.test(s.title))) {
    next.set(sheet.title,2);
    sheet.values.slice(1).forEach((row,i)=>{
      const occupied=[...row.slice(0,10),...row.slice(14,19)].some(v=>v!=='' && v!=null);
      if(occupied)next.set(sheet.title,i+3); // Preserve ID-less rows; ignore the K:N summary.
      const id=clean(row[18],80),pos={sheet,row:i+2,values:row};
      if(id){const list=index.get(id)||[];list.push(pos);index.set(id,list);if(reconcile)targets.add(id)}
      else if(reconcile && occupied)legacy.push(pos);
    });
  }
  function clear(pos){writes.push({sheetId:pos.sheet.sheetId,row:pos.row,col:0,values:Array(10).fill('')},{sheetId:pos.sheet.sheetId,row:pos.row,col:14,values:Array(5).fill('')})}
  for(const id of targets) {
    if(!id)throw new Error('MISSING_IMMUTABLE_ID');
    const s=canonical.get(id),positions=index.get(id)||[];
    if(!s){for(const p of positions)clear(p);report.deleted+=positions.length;continue}
    const title=monthTitle(s.intervention_date),sheet=sheets.find(t=>t.title===title);
    if(!sheet)throw new Error('MISSING_MONTH_SHEET:'+title);
    const chosen=positions.find(p=>p.sheet.title===title);
    const others=positions.filter(p=>p!==chosen);
    for(const p of others)clear(p);
    report.duplicates+=Math.max(0,positions.length-1);
    if(!chosen && positions.length)report.moved++;
    const expected=monthlyRow(s,at,separator);
    if(!chosen||!sameRow(chosen.values,expected)) {
      const row=chosen?.row ?? next.get(title) ?? 2;
      if(!chosen){next.set(title,row+1);report.missing++}else report.changed++;
      writes.push({sheetId:sheet.sheetId,row,col:0,values:expected.slice(0,10)},{sheetId:sheet.sheetId,row,col:14,values:expected.slice(14,19)});
    }
  }
  for(const pos of legacy){clear(pos);report.legacy++;}
  const journal=sheets.find(s=>s.title===JOURNAL),seen=new Set((journal?.values||[]).slice(1).map(r=>String(r[0])));
  let jr=Math.max(2,(journal?.values.length||1)+1);
  for(const job of jobs)if(!seen.has(String(job.id))){seen.add(String(job.id));events.push(job);writes.push({sheetId:journal.sheetId,row:jr++,col:0,values:journalRow(job,at)})}
  // Reconciliation itself is journaled once in the same atomic Google commit.
  if(reconcile && Object.values(report).some(Boolean)) {
    const id='reconcile:'+crypto.randomUUID();
    writes.push({sheetId:journal.sheetId,row:jr++,col:0,values:[id,'reconcile',at,'','','','','','','',0,JSON.stringify(report),'',0,'Rapprochement Supabase','']});
  }
  if(legacy.length){
    const archive=sheets.find(s=>s.title===LEGACY);let row=Math.max(2,(archive?.values.length||1)+1);
    for(const pos of legacy){
      // No guessed identity: preserve the entire source row before clearing active cells.
      writes.push({sheetId:archive.sheetId,row:row++,col:0,values:[crypto.randomUUID(),pos.sheet.title,pos.row,at,JSON.stringify(hidePrices?redactLegacyRow(pos.values):pos.values)]});
    }
  }
  return {writes,report};
}
// Typed cells keep addresses, references (including leading zeros), and comments literal.
export function cell(value,formula=false) {
  return {userEnteredValue: typeof value==='number'?{numberValue:value}:formula?{formulaValue:value}:{stringValue:String(value??'')}};
}
export function gridRequests(writes) {
  return writes.map(w=>({updateCells:{start:{sheetId:w.sheetId,rowIndex:w.row-1,columnIndex:w.col},rows:[{values:w.values.map((v,i)=>cell(v,w.col+i===6&&(v===dailyFormula||v===dailyFormula.replaceAll(',',';'))))}],fields:'userEnteredValue'}}));
}
