import test from 'node:test';import assert from 'node:assert/strict';
import {supportFetch} from './supportFetch.js';import {PendingIntents} from './pendingIntent.js';
test('launcher keeps expired proof only for its retained receipt and exact retry',async t=>{
 const priorFetch=globalThis.fetch;const priorStorage=globalThis.sessionStorage;let expired=false;let seen:any[]=[];let pendingResponse=true;
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>JSON.stringify({token:'proof-token',expiresAt:new Date(Date.now()+(expired?-1000:10000)).toISOString()})}});
 globalThis.fetch=async(_url,init)=>{seen.push(init);return new Response(JSON.stringify(pendingResponse?{status:'pending',receiptId:'receipt-1'}:{}),{status:pendingResponse?202:200});};
 t.after(()=>{globalThis.fetch=priorFetch;Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:priorStorage});});
 const p=new PendingIntents();const init={method:'POST',body:'{"body":"draft"}'};
 await assert.rejects(()=>supportFetch('/support','/tickets',init,undefined,p),/pending/);const key=seen[0].headers['Idempotency-Key'];expired=true;pendingResponse=false;
 await supportFetch('/support','/pending/receipt-1',undefined,undefined,p);assert.equal(seen.at(-1).headers['x-support-guest-token'],'proof-token');
 await supportFetch('/support','/tickets',init,undefined,p);assert.equal(seen.at(-1).headers['x-support-guest-token'],'proof-token');assert.equal(seen.at(-1).headers['Idempotency-Key'],key);
 await supportFetch('/support','/tickets',undefined,undefined,p);assert.equal(seen.at(-1).headers['x-support-guest-token'],undefined);
 await supportFetch('/support','/pending/someone-else',undefined,undefined,new PendingIntents());assert.equal(seen.at(-1).headers['x-support-guest-token'],undefined);
});
test('an aborted client cannot settle a late response even when transport ignores abort',async t=>{
 const original=globalThis.fetch;let finish:(response:Response)=>void=()=>{};
 globalThis.fetch=()=>new Promise<Response>(resolve=>finish=resolve);t.after(()=>{globalThis.fetch=original;});
 const pending=new PendingIntents(),controller=new AbortController();
 const response=supportFetch('/support','/tickets',{method:'POST',body:'{"body":"old actor"}',signal:controller.signal},undefined,pending,'old-actor');
 controller.abort();finish(new Response('{"status":"pending","receiptId":"old-private-receipt"}',{status:202}));
 await assert.rejects(()=>response,(error:any)=>error.name==='AbortError');assert.equal(pending.ownsReceipt('old-private-receipt'),false);
});
test('customer cookie and JWT retries never inherit a guest proof and retain their key through reauthentication',async t=>{
 const original=globalThis.fetch,storage=globalThis.sessionStorage;const seen:any[]=[];let expired=false;
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>JSON.stringify({token:'surviving-guest-proof',expiresAt:new Date(Date.now()+60000).toISOString()})}});
 globalThis.fetch=async(_url,init)=>{seen.push(init);return new Response(JSON.stringify(expired?{error:'Sign in again',code:'customer_auth_required'}:{status:'pending',receiptId:'owned-receipt'}),{status:expired?401:202});};
 t.after(()=>{globalThis.fetch=original;Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});});
 for(const jwt of [false,true]) {
  const pending=new PendingIntents();const init={method:'POST',body:'{"body":"customer draft"}'};let token=jwt?'valid-jwt':null;expired=false;
  await assert.rejects(()=>supportFetch('/support','/tickets',init,()=>token,pending,'customer'),/pending/);const first=seen.at(-1).headers;
  assert.equal(first['x-support-guest-token'],undefined);assert.equal(first['x-support-require-customer'],'1');
  expired=true;token=null;await assert.rejects(()=>supportFetch('/support','/tickets',init,()=>token,pending,'customer'),/Sign in/);
  assert.equal(seen.at(-1).headers['Idempotency-Key'],first['Idempotency-Key']);assert.equal(seen.at(-1).headers['x-support-guest-token'],undefined);
  expired=false;token=jwt?'renewed-jwt':null;await assert.rejects(()=>supportFetch('/support','/tickets',init,()=>token,pending,'customer'),/pending/);assert.equal(seen.at(-1).headers['Idempotency-Key'],first['Idempotency-Key']);
 }
 const freshGuest=new PendingIntents();await assert.rejects(()=>supportFetch('/support','/tickets',{method:'POST',body:'{}'},undefined,freshGuest),/pending/);assert.equal(seen.at(-1).headers['x-support-guest-token'],'surviving-guest-proof');assert.equal(seen.at(-1).headers['x-support-require-customer'],undefined);
});
test('explicit public transport omits ambient cookies and bearer while retaining guest proof/key',async t=>{
 const original=globalThis.fetch,storage=globalThis.sessionStorage;const seen:any[]=[];Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>JSON.stringify({token:'public-proof',expiresAt:new Date(Date.now()+60000).toISOString()})}});globalThis.fetch=async(_url,init)=>{seen.push(init);return new Response('{"status":"pending","receiptId":"guest-receipt"}',{status:202});};t.after(()=>{globalThis.fetch=original;Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});});
 const pending=new PendingIntents();for(const token of ['existing-token','expired-token'])await assert.rejects(()=>supportFetch('/support','/leads',{method:'POST',body:'{}'},()=>token,pending,undefined,true),/pending/);
 assert.equal(seen[0].headers['Idempotency-Key'],seen[1].headers['Idempotency-Key']);for(const request of seen){assert.equal(request.credentials,'omit');assert.equal(request.headers.Authorization,undefined);assert.equal(request.headers['x-support-guest-token'],'public-proof');assert.equal(request.headers['x-support-require-customer'],undefined);}
});
test('retained customer requests constrain user and explicit workspace independent of rotated JWT',async t=>{
 const original=globalThis.fetch;const seen:any[]=[];globalThis.fetch=async(_url,init)=>{seen.push(init);return new Response('{"status":"pending","receiptId":"owned"}',{status:202});};t.after(()=>globalThis.fetch=original);
 const pending=new PendingIntents(),init={method:'POST',body:'{"body":"owned draft"}'};
 for(const token of ['jwt-a','jwt-other-actor'])await assert.rejects(()=>supportFetch('/support','/tickets',init,()=>token,pending,'customer-a',false,'org-a'),/pending/);
 assert.equal(seen[0].headers['Idempotency-Key'],seen[1].headers['Idempotency-Key']);for(const request of seen)assert.deepEqual(JSON.parse(decodeURIComponent(request.headers['x-support-expected-customer'])),{id:'customer-a',orgId:'org-a'});
 await assert.rejects(()=>supportFetch('/support','/tickets',init,()=>null,pending,'customer-a',false,null),/pending/);assert.deepEqual(JSON.parse(decodeURIComponent(seen.at(-1).headers['x-support-expected-customer'])),{id:'customer-a',orgId:null});assert.notEqual(seen.at(-1).headers['Idempotency-Key'],seen[0].headers['Idempotency-Key']);
 await assert.rejects(()=>supportFetch('/support','/tickets',init,()=>null,pending,'customer-a'),/pending/);assert.deepEqual(JSON.parse(decodeURIComponent(seen.at(-1).headers['x-support-expected-customer'])),{id:'customer-a'});
});
