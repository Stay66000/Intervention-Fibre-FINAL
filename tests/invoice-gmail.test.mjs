import test from 'node:test';
import assert from 'node:assert/strict';
import {validEmail,buildGmailMessage} from '../invoice-gmail.mjs';
import {onRequestGet} from '../functions/api/invoice-gmail-config.js';

test('constructs a Gmail message with a UTF-8 body and a PDF attachment',()=>{
 const pdfBytes=new Uint8Array([37,80,68,70,45,49,46,55]);
 const raw=buildGmailMessage({from:'sender@gmail.com',to:'client@example.com',subject:'Facture été',body:'Bonjour,\nVoici la facture.',pdfBytes,filename:'Facture-42.pdf',boundary:'fibreops_0123456789abcdef'});
 const mime=Buffer.from(raw,'base64url').toString('utf8');
 assert.match(mime,/From: sender@gmail\.com\r\nTo: client@example\.com/);
 assert.match(mime,/Content-Type: application\/pdf/);
 assert.match(mime,/filename="Facture-42\.pdf"/);
 assert.ok(mime.includes(Buffer.from(pdfBytes).toString('base64')));
 assert.ok(mime.includes(Buffer.from('Facture été').toString('base64')));
});
test('rejects forged headers and malformed addresses',()=>{
 assert.equal(validEmail('a@example.com\r\nBcc:other@example.com'),false);
 assert.throws(()=>buildGmailMessage({from:'a@example.com',to:'b@example.com',subject:'test\r\nBcc:x@example.com',body:'',pdfBytes:[],filename:'x.pdf',boundary:'1234567890123456'}),/objet/);
});
test('configuration endpoint exposes only a valid public OAuth client ID',async()=>{
 let r=await onRequestGet({env:{GMAIL_OAUTH_CLIENT_ID:'123-example.apps.googleusercontent.com',SECRET:'hidden'}});
 assert.deepEqual(await r.json(),{client_id:'123-example.apps.googleusercontent.com'});
 r=await onRequestGet({env:{GMAIL_OAUTH_CLIENT_ID:'malformed'}});
 assert.deepEqual(await r.json(),{client_id:null});
});
