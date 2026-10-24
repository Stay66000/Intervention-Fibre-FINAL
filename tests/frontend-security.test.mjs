import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {securityHeaders} from '../functions/_lib/security-headers.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('application inline scripts compile after removal of legacy invitation path',()=>{
 const html=read('index.html');let count=0;
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=/.test(match[1]))continue;
  new vm.Script(match[2]);count++;
 }
 assert.ok(count>=2);
 assert.doesNotMatch(html,/company-create-technician-access|temporary_password|companyTempPassword/);
 assert.doesNotMatch(html,/<[^>]+\s(?:onclick|onload)="/i);
 assert.match(html,/get_my_password_setup_status/);
});
test('CSP uses per-response nonce and denies unsafe inline scripts, embedding and unrelated connections',()=>{
 const a=securityHeaders('nonce-a'),b=securityHeaders('nonce-b');
 assert.notEqual(a['Content-Security-Policy'],b['Content-Security-Policy']);
 const scripts=a['Content-Security-Policy'].split(';').find(x=>x.trim().startsWith('script-src'));
 assert.match(scripts,/'nonce-nonce-a'/);assert.doesNotMatch(scripts,/'unsafe-inline'|'unsafe-eval'/);
 assert.match(a['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.equal(a['Cache-Control'],'no-store');assert.equal(a['Referrer-Policy'],'no-referrer');
});
test('public Sheets transports cannot issue anonymous network calls',()=>{
 for(const name of ['sheets-bridge.js','sheets-pull.js'])assert.doesNotMatch(read(name),/script\.google\.com|fetch\s*\(/);
 const gas=read('apps-script-sheets-test.gs');new vm.Script(gas);
 assert.match(gas,/computeHmacSha256Signature/);assert.match(gas,/fibreAuthorize_\(raw\)/);
 assert.match(gas,/replayed_request/);
});
