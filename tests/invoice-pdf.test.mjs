import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {jsPDF} from 'jspdf';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {buildInvoicePdf} from '../invoice-pdf.mjs';

test('exports the saved invoice as a legible PDF with French characters',async()=>{
 const fontBytes=readFileSync(new URL('../vendor/invoice-pdf/DejaVuSans.ttf',import.meta.url));
 const row={invoice_number:'2026-001',issue_date:'2026-11-13',due_date:'2026-11-20',total_amount:168.60,unit_price:168.60,
  seller_snapshot:{business_name:'Électricité Test',siret:'123456789'},client_snapshot:{name:'Société Cliente',email:'client@example.invalid'},
  period_label:'Facture de novembre',description:'Intervention aérienne',vat_note:'TVA non applicable',payment_terms_days:7,late_penalty_text:'Pénalités de retard',recovery_fee:40};
 const {doc,filename}=buildInvoicePdf(row,{jsPDF,fontBytes});
 assert.equal(filename,'Facture-2026-001.pdf');
 const pdf=await getDocument({data:new Uint8Array(doc.output('arraybuffer'))}).promise;
 const text=(await (await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');
 for(const part of ['2026-001','Électricité Test','Société Cliente','Intervention aérienne','168,60','TVA non applicable','Pénalités de retard'])assert.ok(text.includes(part),`missing ${part}: ${text}`);
 await pdf.destroy();
});
test('rejects a draft without an invoice number',()=>{
 assert.throws(()=>buildInvoicePdf({},{jsPDF,fontBytes:new Uint8Array()}),/Enregistre la facture/);
});
