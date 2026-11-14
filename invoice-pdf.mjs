// Generates the PDF locally from the saved invoice snapshot; no invoice data is uploaded.
const asText=value=>String(value??'').trim();
const dateFr=value=>/^\d{4}-\d{2}-\d{2}/.test(asText(value))?`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`:'—';
const money=value=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(value)||0);
const safeFilename=value=>`Facture-${asText(value).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80)||'sans-numero'}.pdf`;

export function buildInvoicePdf(row,{jsPDF,fontBytes}){
  if(!row?.invoice_number)throw new Error('Enregistre la facture avant de télécharger le PDF.');
  const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
  let binary='';const bytes=new Uint8Array(fontBytes);
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  doc.addFileToVFS('DejaVuSans.ttf',binary);doc.addFont('DejaVuSans.ttf','DejaVu','normal');doc.setFont('DejaVu','normal');
  const left=18,right=192,width=174,bottom=275,lineHeight=4.5;
  const seller=row.seller_snapshot||{},client=row.client_snapshot||{};
  const amount=row.total_amount??row.unit_price??0;
  const text=(value,x,y,{size=9,max=width,align='left'}={})=>{
    doc.setFontSize(size);const parts=doc.splitTextToSize(asText(value),max);
    doc.text(parts,x,y,{align});return parts.length*lineHeight;
  };
  let y=21;
  text(`FACTURE - ${row.invoice_number}`,105,y,{size:15,max:87});y+=7;
  text(`Date de facturation: ${dateFr(row.issue_date)}`,105,y,{max:87});y+=5;
  text(`Échéance: ${dateFr(row.due_date)}`,105,y,{max:87});y+=5;
  text(`Type d'opération: ${asText(row.operation_type)||'Bien et services'}`,105,y,{max:87});
  const partyStart=Math.max(62,y+14);
  const party=(lines,x)=>{let pos=partyStart;for(const value of lines){if(!asText(value))continue;pos+=text(value,x,pos,{max:76})}return pos};
  const sellerEnd=party([seller.business_name||'Ma société',seller.owner_name,seller.address_line1,seller.address_line2,[seller.postal_code,seller.city].filter(Boolean).join(' '),seller.phone,seller.email],left);
  const clientEnd=party([client.name||'Société cliente',client.address_line1,client.address_line2,[client.postal_code,client.city].filter(Boolean).join(' '),client.email,client.siret?`Numéro de SIRET ${client.siret}`:''],112);
  y=Math.max(115,sellerEnd+10,clientEnd+10);
  const ensure=height=>{if(y+height>bottom){doc.addPage();y=20}};
  const paragraph=(value,{size=9,gap=3}={})=>{const v=asText(value);if(!v)return;doc.setFontSize(size);const lines=doc.splitTextToSize(v,width);for(const line of lines){ensure(lineHeight);doc.text(line,left,y);y+=lineHeight}y+=gap};
  paragraph(row.period_label||'Facture du mois',{gap:7});
  const cols=[18,27,84,106,118,131,161,192];
  const headers=['No.','Description','Date','Qté','Unité','Prix unitaire','Montant'];
  ensure(20);doc.setFillColor(222,222,222);doc.rect(left,y-4,width,8,'F');doc.setFontSize(7);
  headers.forEach((h,i)=>doc.text(h,i<2?cols[i]+1:cols[i+1]-1,y+1,{align:i<2?'left':'right'}));y+=9;
  const description=doc.splitTextToSize(asText(row.description)||'Bien et services',cols[2]-cols[1]-3);
  const tableHeight=Math.max(8,description.length*lineHeight+3);ensure(tableHeight);
  doc.text('1',cols[0]+1,y);doc.text(description,cols[1]+1,y);
  [dateFr(row.issue_date),'1,00','pce',money(amount),money(amount)].forEach((v,i)=>doc.text(v,cols[i+3]-1,y,{align:'right'}));
  y+=tableHeight;doc.setDrawColor(210);doc.line(left,y-3,right,y-3);y+=5;
  if(row.vat_note)paragraph(row.vat_note,{gap:2});
  ensure(14);doc.line(112,y-3,right,y-3);text('Net à payer',112,y+2,{size:11,max:40});text(money(amount),right,y+2,{size:11,max:40,align:'right'});y+=16;
  ensure(14);text('Conditions de paiement:',left,y,{max:55});text(`${Number(row.payment_terms_days||7)} jours`,77,y,{max:115});y+=5;
  y+=text("Pas d'escompte en cas de paiement anticipé.",77,y,{max:115});y+=8;
  paragraph(row.late_penalty_text,{gap:1});
  paragraph(`Une indemnité forfaitaire pour frais de recouvrement d'un montant de ${money(row.recovery_fee??40)} sera exigible.`,{gap:5});
  const footer=[seller.business_name||'Ma société',[seller.address_line1,[seller.postal_code,seller.city].filter(Boolean).join(' ')].filter(Boolean).join(' - ')].filter(Boolean).join(' - ');
  const footer2=[seller.siret?`Numéro de SIRET: ${seller.siret}`:'',seller.legal_status].filter(Boolean).join(' - ');
  ensure(17);y=Math.max(y,268);text(footer,105,y,{size:8,max:width,align:'center'});if(footer2)text(footer2,105,y+5,{size:8,max:width,align:'center'});
  return {doc,filename:safeFilename(row.invoice_number)};
}

export async function createInvoicePdf(row){
  if(!globalThis.jspdf?.jsPDF)await import('./vendor/invoice-pdf/jspdf.umd.min.js');
  if(!globalThis.jspdf?.jsPDF)throw new Error('Impossible de charger l’outil PDF.');
  const response=await fetch('./vendor/invoice-pdf/DejaVuSans.ttf');
  if(!response.ok)throw new Error('Impossible de charger la police du PDF.');
  return buildInvoicePdf(row,{jsPDF:globalThis.jspdf.jsPDF,fontBytes:await response.arrayBuffer()});
}
