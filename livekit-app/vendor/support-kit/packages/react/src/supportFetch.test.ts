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
