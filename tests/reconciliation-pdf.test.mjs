import test from 'node:test';
import assert from 'node:assert/strict';
import {tableFromItems} from '../reconciliation-pdf.mjs';

const item=(str,x,y,width=0)=>({str,transform:[1,0,0,1,x,y],width});
test('detects table columns and excludes totals and adjustment lines',()=>{
  const rows=tableFromItems([[item('RefInter',10,100),item('Type',100,100),item('Rémunération',300,100),
    item('123456789',10,90),item('SAV',100,90),item('18,00 €',310,90),
    item('TOTAL – 1 intervention',10,80),item('18,00 €',310,80),
    item('PÉNALITÉ',10,70),item('10,00 €',310,70)]]);
  assert.deepEqual(rows,[['RefInter','Type','Rémunération'],['123456789','SAV','18,00 €']]);
});
test('splits adjacent Orange references and keeps the ND as its own column',()=>{
  const rows=tableFromItems([[item('N° OT',10,100),item('N° att.',110,100),item('ND',210,100),item('Montant ST calculé',310,100),
    item('0000026417021',10,90),item('1065808033 0468043576',110,90,200),item('168,6',320,90)]]);
  assert.deepEqual(rows[1],['0000026417021','1065808033','0468043576','168,6']);
});
test('rejects an image-only PDF instead of reporting a successful empty match',()=>{
  assert.throws(()=>tableFromItems([[]]),/Aucun tableau lisible/);
});
