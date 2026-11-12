import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createMarketingKit } from './router.js';
function fixture(batch:boolean){
 const raw=new DatabaseSync(':memory:');const delivered:string[]=[];let check=0,offline=false;
 const db:any={async run(s:string,p:any[]=[]){return {changes:Number(raw.prepare(s).run(...p).changes)}},async get(s:string,p:any[]=[]){return raw.prepare(s).get(...p)},async all(s:string,p:any[]=[]){return raw.prepare(s).all(...p)}};
 const kit=createMarketingKit({tenantId:'lalia',db,brand:{tenantId:'lalia',name:'test',domain:'test.invalid',tagline:'',brandVoice:'',primaryColor:'',accentColor:'',signupUrl:'/',pricingSummary:'',coreFeatures:[],targetAudiences:[]},llm:{complete:async()=>''},
  consent:{authorize:async()=>{check++;return {expiresAt:new Date(Date.now()+10000).toISOString(),status:offline?'paused':check===2?'suppressed':'eligible'};}} as any,
  resolveSegmentContacts:async()=>['a','b','c'].map(id=>({id,tenantId:'lalia',email:`${id}@example.test`,name:id,firstName:id,planTier:'',lifecycleState:'',unsubscribeToken:'',marketingOptIn:true})),
  email:{sendEmail:async m=>{delivered.push(m.to);offline=true;return {status:'sent',providerMessageId:m.to}},...(batch?{sendBatch:async (ms:any[])=>{assert.equal(ms.length,1);delivered.push(ms[0].to);offline=true;return [{to:ms[0].to,status:'sent' as const,providerMessageId:ms[0].to}]}}:{})}});
 return {kit,delivered,restore(){offline=false;}};
}
for(const batch of [false,true])test(`live dispatch pauses without replay after partial delivery (${batch?'batch':'single'})`,async()=>{
 const {kit,delivered,restore}=fixture(batch);await kit.ensureSchema();const c=await kit.store.createCampaign('lalia',{subject:'test',segmentId:'account'});
 await kit.store.updateCampaign('lalia',c.id,{status:'scheduled',scheduledAt:'2020-01-01T00:00:00.000Z'});await kit.runScheduledWork();
 assert.deepEqual(delivered,['a@example.test']);assert.equal((await kit.store.getCampaign('lalia',c.id))?.status,'paused');
 assert.equal((await kit.store.listRecipients(c.id)).filter(r=>r.status==='sent').length,1);
 restore();await kit.store.updateCampaign('lalia',c.id,{status:'scheduled',scheduledAt:'2020-01-01T00:00:00.000Z'});await kit.runScheduledWork();assert.equal(delivered.filter(e=>e==='a@example.test').length,1);
});
test('expired authorization never dispatches and resume obtains entirely fresh checks',async()=>{
 const {kit,delivered}=fixture(false);await kit.ensureSchema();const c=await kit.store.createCampaign('lalia',{subject:'test',segmentId:'account'});
 const transition=kit.store.transitionRecipient.bind(kit.store);const originalNow=Date.now;let expired=false;
 kit.store.transitionRecipient=async(...args:any[])=>{const result=await (transition as any)(...args);if(args[2]==='dispatching'){expired=true;Date.now=()=>originalNow()+20000;}return result;};
 try{await kit.store.updateCampaign('lalia',c.id,{status:'scheduled',scheduledAt:'2020-01-01T00:00:00Z'});await kit.runScheduledWork();}finally{Date.now=originalNow;kit.store.transitionRecipient=transition;}
 assert.equal(expired,true);assert.equal(delivered.length,0);assert.equal((await kit.store.getCampaign('lalia',c.id))?.status,'paused');assert.equal((await kit.store.listRecipients(c.id))[0].status,'queued');
 await kit.store.updateCampaign('lalia',c.id,{status:'scheduled',scheduledAt:'2020-01-01T00:00:00Z'});await kit.runScheduledWork();
 assert.deepEqual(delivered,['b@example.test'],'new checks suppress the previously authorized first recipient');
});
