import test from 'node:test';import assert from 'node:assert/strict';import {PendingIntents} from './pendingIntent.js';
test('uncertain same intent reuses key, new body/actor/business cannot reuse it',()=>{
 const p=new PendingIntents();const key=p.key('business:actor:POST:/tickets','hello');assert.equal(p.key('business:actor:POST:/tickets','hello'),key);
 assert.notEqual(p.key('other:actor:POST:/tickets','hello'),key);assert.notEqual(p.key('business:other:POST:/tickets','hello'),key);
 assert.notEqual(p.key('business:actor:POST:/tickets','changed'),key);
});
test('success consumes key without clearing a newer intent',()=>{const p=new PendingIntents();const a=p.key('scope','a'),b=p.key('scope','b');p.complete('scope',a);assert.equal(p.key('scope','b'),b);p.complete('scope',b);assert.notEqual(p.key('scope','b'),b);});
test('202 retains key and reports pending without pretending a ticket exists',()=>{
 const p=new PendingIntents();const key=p.key('scope','draft');
 assert.throws(()=>p.settle('scope',key,202,{status:'pending',receiptId:'receipt-1'}),(e:any)=>e.code==='support_pending'&&e.receiptId==='receipt-1');
 assert.equal(p.key('scope','draft'),key);
 p.settle('scope',key,201,{ticket:{id:'real'}});assert.notEqual(p.key('scope','draft'),key);
});
test('different drafts retain independent original keys and guest proofs until settled',()=>{
 const pending=new PendingIntents();const first=pending.key('lead','first','old-proof');pending.key('lead','second','new-proof');
 assert.equal(pending.key('lead','first','new-proof'),first);assert.equal(pending.retained('lead','first')?.guestToken,'old-proof');
 assert.throws(()=>pending.settle('lead',first,202,{status:'pending',receiptId:'old-receipt',retryPaused:true}),(error:any)=>error.retryPaused===true);
 assert.equal(pending.receiptProof('old-receipt'),'old-proof');
});
