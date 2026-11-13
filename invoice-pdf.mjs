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
  const margin=18,width=174,lineHeight=5;let y=20;
  const ensure=height=>{if(y+height>280){doc.addPage();y=20}};
  const line=(value,{size=10,gap=1}={})=>{
    const text=asText(value);if(!text)return;
    doc.setFontSize(size);const lines=doc.splitTextToSize(text,width);
    for(const part of lines){ensure(lineHeight);doc.text(part,margin,y);y+=lineHeight}
    y+=gap;
  };
  const seller=row.seller_snapshot||{},client=row.client_snapshot||{};
  line(`FACTURE - ${row.invoice_number}`,{size:16,gap:5});
  line(`Date de facturation : ${dateFr(row.issue_date)}   Échéance : ${dateFr(row.due_date)}`);
  line(`Type d'opération : ${asText(row.operation_type)||'Bien et services'}`,{gap:5});
  line('ÉMETTEUR',{size:11});
  [seller.business_name,seller.owner_name,seller.address_line1,seller.address_line2,[seller.postal_code,seller.city].filter(Boolean).join(' '),seller.phone,seller.email,seller.siret?`SIRET : ${seller.siret}`:'',seller.legal_status].forEach(v=>line(v,{gap:0}));
  y+=4;line('CLIENT',{size:11});
  [client.name,client.address_line1,client.address_line2,[client.postal_code,client.city].filter(Boolean).join(' '),client.email,client.siret?`SIRET : ${client.siret}`:''].forEach(v=>line(v,{gap:0}));
  y+=5;line(row.period_label||'Facture du mois',{size:11});
  line(`Description : ${asText(row.description)||'Bien et services'}`);
  line(`Date : ${dateFr(row.issue_date)}   Quantité : 1,00   Unité : pce`);
  line(`Prix unitaire : ${money(row.unit_price??row.total_amount)}   Montant : ${money(row.total_amount??row.unit_price)}`);
  y+=3;line(`Net à payer : ${money(row.total_amount??row.unit_price)}`,{size:13});
  line(row.vat_note);
  line(`Conditions de paiement : ${Number(row.payment_terms_days||7)} jours. Pas d'escompte en cas de paiement anticipé.`);
  line(row.late_penalty_text);
  line(`Une indemnité forfaitaire pour frais de recouvrement d'un montant de ${money(row.recovery_fee??40)} sera exigible.`);
  return {doc,filename:safeFilename(row.invoice_number)};
}

export async function createInvoicePdf(row){
  if(!globalThis.jspdf?.jsPDF)await import('./vendor/invoice-pdf/jspdf.umd.min.js');
  if(!globalThis.jspdf?.jsPDF)throw new Error('Impossible de charger l’outil PDF.');
  const response=await fetch('./vendor/invoice-pdf/DejaVuSans.ttf');
  if(!response.ok)throw new Error('Impossible de charger la police du PDF.');
  return buildInvoicePdf(row,{jsPDF:globalThis.jspdf.jsPDF,fontBytes:await response.arrayBuffer()});
}
