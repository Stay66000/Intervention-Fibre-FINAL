import assert from 'node:assert/strict';
import test from 'node:test';
import { createInviteHandler, allowedOrigin } from '../supabase/functions/company-invite-technician-access/handler.ts';
const origin='https://intervention-fibre-final.pages.dev';
const valid={email:'test@security-test.invalid',first_name:'Test',employment_type:'salaried',hide_prices:true};
function setup({authError=false,reserveError=null,finalizeError=false,abortOwned='new-user',deleteError=false}={}){
 const calls=[];
 const admin={auth:{getUser:async()=>({data:{user:authError?null:{id:'actor'}},error:authError}),admin:{
  inviteUserByEmail:async(email,options)=>{calls.push(['invite',email,options]);return {data:{user:{id:'new-user'}}};},
  deleteUser:async id=>{calls.push(['delete',id]);return {error:deleteError};}
 }},rpc:async(name,args)=>{calls.push([name,args]);return name==='abort_company_technician_invitation'?{data:abortOwned}: {error:finalizeError?{message:'internal secret detail'}:null};}};
 const caller={rpc:async(name,args)=>{calls.push([name,args]);return {data:{attempt_id:'attempt',company_name:'Fixture'},error:reserveError};}};
 const handler=createInviteHandler((url,key)=>key==='service'?admin:caller,name=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'public'}[name]));
 const request=(body=valid,headers={},method='POST')=>new Request(origin,{method,headers:{Origin:origin,Authorization:'Bearer token','Content-Type':'application/json',...headers},body:method==='POST'?JSON.stringify(body):undefined});
 return {handler,calls,request};
}
test('origin allowlist rejects localhost and deceptive suffixes',()=>{
 assert.equal(allowedOrigin(origin),true);assert.equal(allowedOrigin('https://preview.intervention-fibre-final.pages.dev'),true);
 for(const value of ['http://localhost:3000','https://intervention-fibre-final.pages.dev.evil.test','https://evil-intervention-fibre-final.pages.dev','null',''])assert.equal(allowedOrigin(value),false);
});
test('rejects missing token, invalid JWT, untrusted origin and method before provisioning',async()=>{
 for(const [headers,method,status] of [[{Authorization:''},'POST',401],[{Origin:'https://evil.test'},'POST',403],[{},'GET',405]]){
  const x=setup();assert.equal((await x.handler(x.request(valid,headers,method))).status,status);assert.equal(x.calls.length,0);
 }
 const x=setup({authError:true});assert.equal((await x.handler(x.request())).status,401);assert.equal(x.calls.length,0);
});
test('validates types and body limits',async()=>{
 for(const body of [null,[],{...valid,email:'invalid'},{...valid,hide_prices:'false'},{...valid,first_name:123}]){
  const x=setup();assert.equal((await x.handler(x.request(body))).status,400);assert.equal(x.calls.length,0);
 }
 const x=setup();assert.equal((await x.handler(x.request({...valid,last_name:'a'.repeat(5000)}))).status,413);
});
test('enforces server authorization and quotas before sending email',async()=>{
 for(const [code,status] of [['42501',403],['23505',409],['P0001',429]]){
  const x=setup({reserveError:{code,message:'private database detail'}});const res=await x.handler(x.request());
  assert.equal(res.status,status);assert.equal(x.calls.length,1);assert.doesNotMatch(await res.text(),/private database detail/);
 }
});
test('client company/user identifiers are ignored and only the finalized invitation succeeds',async()=>{
 const x=setup();const res=await x.handler(x.request({...valid,company_id:'foreign-company',user_id:'foreign-user'}));
 assert.equal(res.status,200);assert.deepEqual(x.calls[0],['reserve_company_technician_invitation',{p_email:valid.email}]);
 assert.equal(x.calls[1][2].data.fibre_invitation_id,'attempt');
 assert.equal(x.calls[2][1].p_user_id,'new-user');assert.equal(x.calls[2][1].p_hide_prices,true);
 const data=await res.json();assert.equal(data.invitation_sent,true);assert.equal(data.user_id,undefined);assert.equal(data.temporary_password,undefined);
});
test('failed finalization disables owned account before Auth cleanup, never deletes an unowned account',async()=>{
 for(const abortOwned of ['new-user',null]){
  const x=setup({finalizeError:true,abortOwned});const res=await x.handler(x.request());
  assert.equal(res.status,500);assert.doesNotMatch(await res.text(),/internal secret detail/);
  assert.equal(x.calls[3][0],'abort_company_technician_invitation');
  assert.equal(x.calls.some(c=>c[0]==='delete'),!!abortOwned);
 }
});
