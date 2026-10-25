export type PriceVisibility='visible'|'hidden';

export function priceVisibility(snapshot:any):PriceVisibility{
  return snapshot?.backup_price_visibility==='hidden'?'hidden':'visible';
}

const clean=(value:unknown,max=500)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const operator=(value:unknown)=>({orange:'Orange',sfr:'SFR',bouygues:'Bouygues Telecom',free:'Free'} as Record<string,string>)[String(value||'').toLowerCase()]||clean(value,80);
const result=(value:unknown)=>{const raw=String(value||'').toLowerCase();return raw.startsWith('réuss')||raw==='success'?'Réussite':'Échec'};
const mode=(snapshot:any)=>snapshot?.work_mode==='Binôme'?'Binôme':'Solo';

export const PRICED_MONTHLY_HEADERS=['Date','N° intervention','Adresse client','Typologie raccordement','Réussite / Échec','Opérateur','Total journalier (€)','Mode','Montant (€)','Commentaire'];
export const HIDDEN_MONTHLY_HEADERS=['Date','N° intervention','Adresse client','Typologie raccordement','Réussite / Échec','Opérateur','Mode','Commentaire'];

export const PRICED_JOURNAL_HEADERS=['Event ID','Action','Horodatage','Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Montant','Commentaire','Complément','Montant complément','État','ID FIBRE OPS'];
export const HIDDEN_JOURNAL_HEADERS=['Event ID','Action','Horodatage','Date','Référence','Adresse','Typologie','Résultat','Opérateur','Mode','Commentaire','État','ID FIBRE OPS'];

export function hiddenMonthlyRow(snapshot:any){
  return[
    clean(snapshot?.intervention_date,20),
    clean(snapshot?.reference,120),
    clean(snapshot?.address,400),
    clean(snapshot?.intervention_type_name,160),
    result(snapshot?.result),
    operator(snapshot?.operator),
    mode(snapshot),
    clean(snapshot?.notes,500),
  ];
}

export function hiddenTechnicalRow(snapshot:any,state:string){
  return[new Date().toISOString(),state,clean(snapshot?.id,80)];
}

export function hiddenJournalRow(job:any,state:string){
  return[
    clean(job?.id,80),
    clean(job?.action,30),
    new Date().toISOString(),
    clean(job?.snapshot?.intervention_date,20),
    clean(job?.snapshot?.reference,120),
    clean(job?.snapshot?.address,400),
    clean(job?.snapshot?.intervention_type_name,160),
    result(job?.snapshot?.result),
    operator(job?.snapshot?.operator),
    mode(job?.snapshot),
    clean(job?.snapshot?.notes,500),
    state,
    clean(job?.snapshot?.id,80),
  ];
}

export function templateKey(title:string,visibility:PriceVisibility,version:number){
  return `__template_${visibility}_v${version}__${title}`;
}

export function assertNoMoneyInHiddenSnapshot(snapshot:any){
  if(priceVisibility(snapshot)!=='hidden')return;
  const forbidden=['applied_amount','agency_amount_snapshot','amount','price','payout','tariff','agency_amount','supplement_amount'];
  const raw=JSON.stringify(snapshot||{}).toLowerCase();
  for(const key of forbidden){if(raw.includes(`\"${key}\"`))throw new Error('HIDDEN_SNAPSHOT_CONTAINS_MONEY_FIELD:'+key)}
}
