import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {ConsentStore,authorizeConsent,type ConsentScope} from './consent.js';
import {ConsentPolicy} from './consentPolicy.js';
import {consentConfigDigest} from './hostConsent.js';
import {createConsentReporter} from './consentReporting.js';
const scope:ConsentScope={businessId:'business-42',recipient:'a@example.test',channel:'email',purpose:'marketing'};
function database(){const raw=new DatabaseSync(':memory:');const db:any={run:async(s:string,p:any[]=[])=>({changes:Number(raw.prepare(s).run(...p).changes)}),get:async(s:string,p:any[]=[])=>raw.prepare(s).get(...p),all:async(s:string,p:any[]=[])=>raw.prepare(s).all(...p),transaction:async(work:any)=>{raw.exec('BEGIN');try{const v=await work(db);raw.exec('COMMIT');return v;}catch(e){raw.exec('ROLLBACK');throw e;}}};return db;}
const choice=(id:string,granted:boolean,revision='1')=>({id,sourceId:'account:42',sourceRevision:revision,scope,granted,evidence:granted?{kind:'explicit_choice' as const,text:'Email',version:'1'}:null,supersedes:[]});
test('acknowledged legacy withdrawal blocks despite broken reporting; disconnected eligibility pauses',async()=>{
 const central=new ConsentStore(database(),'opshub'),legacy=new ConsentStore(database(),'lalia');await central.ensureSchema();await legacy.ensureSchema();
 await central.append(choice('grant',true));await legacy.append(choice('withdrawal',false));
 let offline=false;
 const policy=new ConsentPolicy({store:central,localFacts:s=>central.facts(s),resolveKey:()=> 'peer-key',peers:()=>[],fetch:async()=>{if(offline)throw Error('disconnected');return Response.json(await legacy.facts(scope));}});
 await central.registerAuthority({businessId:scope.businessId,id:'opshub',endpoint:'local',keyRef:'local'});
 await central.registerAuthority({businessId:scope.businessId,id:'lalia',endpoint:'http://fixture.invalid',keyRef:'LALIA'});
 const reporter=createConsentReporter({store:legacy,businessId:()=>scope.businessId,deliver:async()=>{throw Error('report link blocked')}});
 await assert.rejects(reporter.runOnce(),/blocked/);assert.equal((await legacy.pendingReports()).length,1);
 assert.equal((await policy.authorize(scope,'queued-campaign')).status,'suppressed');offline=true;
 assert.equal((await policy.authorize(scope,'queued-campaign')).status,'paused');
 const audit=await central.db.all<any>('SELECT decision FROM mkt_consent_authorizations');assert.equal(audit.length,2);assert.ok(JSON.parse(audit[0].decision).checks.every((c:any)=>c.observedAt));
});
test('late replicated withdrawal preserves origin identity already covered by a fresh explicit choice',async()=>{
 const central=new ConsentStore(database(),'opshub'),legacy=new ConsentStore(database(),'lalia');await central.ensureSchema();await legacy.ensureSchema();
 const off=choice('withdrawal',false);await legacy.append(off);const facts=await legacy.facts(scope);
 await central.append({...choice('fresh',true,'2'),supersedes:facts.suppressions.map(x=>x.id)});
 await central.append(off,'lalia');
 assert.deepEqual((await central.facts(scope)).suppressions.map(x=>x.id),facts.suppressions.map(x=>x.id));
 assert.equal((await authorizeConsent(scope,[()=>central.facts(scope),()=>legacy.facts(scope)])).status,'eligible');
});
test('retirement requires live signed closure and current exact configuration, not caller booleans',async()=>{
 const store=new ConsentStore(database(),'opshub');await store.ensureSchema();const authority={businessId:scope.businessId,id:'lalia',endpoint:'http://fixture.invalid',keyRef:'LALIA'};await store.registerAuthority(authority);
 let backlog=1,wrongConfig=false,wrongReconciliation=false;
 await store.append(choice('closure-withdrawal',false),'lalia');
 new ConsentPolicy({store,localFacts:s=>store.facts(s),resolveKey:()=> 'peer-key',peers:()=>[],fetch:async()=>{
  const proof={receiptId:'closure-1',businessId:scope.businessId,authorityId:'lalia',configDigest:wrongConfig?'old':consentConfigDigest(authority),closed:true,urlsRerouted:true,preferencesRerouted:true,backlog,...await store.reconciliation(scope.businessId,'lalia'),...(wrongReconciliation?{suppressionDigest:'a'.repeat(64)}:{})};
  return Response.json({proof,signature:createHmac('sha256','peer-key').update(JSON.stringify(proof)).digest('hex')});
 }});
 await assert.rejects(store.retireAuthority(scope.businessId,'lalia',{backlog:0}),/proof/);backlog=0;wrongConfig=true;
 await assert.rejects(store.retireAuthority(scope.businessId,'lalia',{}),/proof/);wrongConfig=false;wrongReconciliation=true;
 await assert.rejects(store.retireAuthority(scope.businessId,'lalia'),/reconciliation/);wrongReconciliation=false;
 await store.retireAuthority(scope.businessId,'lalia');assert.deepEqual(await store.authorities(scope.businessId),[]);
 assert.equal((await store.db.all('SELECT * FROM mkt_consent_retirements')).length,1);
});
test('overlapping withdrawal is bounded to the running operation and the next operation observes it',async()=>{
 const a=new ConsentStore(database(),'opshub'),b=new ConsentStore(database(),'lalia');await a.ensureSchema();await b.ensureSchema();await a.append(choice('grant',true));
 let overlap=true;
 const checks=[()=>b.facts(scope),async()=>{if(overlap){overlap=false;await b.append(choice('overlap',false));}return a.facts(scope);}];
 const running=await authorizeConsent(scope,checks);assert.equal(running.status,'eligible');assert.ok(running.startedAt<=running.checkedAt);assert.ok(Date.parse(running.expiresAt)-Date.parse(running.startedAt)<=10001);
 assert.equal((await authorizeConsent(scope,checks)).status,'suppressed');
});
test('new business authorities can be onboarded and active endpoint configuration updated without reviving retirement',async()=>{
 const store=new ConsentStore(database(),'opshub');await store.ensureSchema();const source={businessId:'new-business',id:'new-source',endpoint:'https://old.invalid',keyRef:'OLD'};
 await store.registerAuthority(source);await store.registerAuthority({...source,endpoint:'https://current.invalid',keyRef:'CURRENT'});
 assert.deepEqual(await store.authorities('new-business'),[{...source,endpoint:'https://current.invalid',keyRef:'CURRENT'}]);
 await store.db.run('UPDATE mkt_consent_authorities SET retirement=? WHERE business_id=? AND id=?',['closed',source.businessId,source.id]);
 await store.registerAuthority(source);assert.deepEqual(await store.authorities('new-business'),[]);
});
test('authoritative registry discovery is fresh, scoped, audited and rejects changes during authorization',async()=>{
 const store=new ConsentStore(database(),'lalia');await store.ensureSchema();await store.append(choice('grant',true));
 let revision='a'.repeat(64),calls=0,change=false,offline=false,wrongBusiness=false;
 const policy=new ConsentPolicy({store,resolveKey:()=>'',peers:()=>[],localFacts:async s=>{if(change)revision='b'.repeat(64);return store.facts(s);},registry:async businessId=>{calls++;if(offline)throw Error('registry offline');return {businessId:wrongBusiness?'wrong':businessId,revision,authorities:[{businessId,id:'lalia',endpoint:'local',keyRef:'local'}]};}} as any);
 assert.equal((await policy.authorize(scope,null)).status,'eligible');assert.equal(calls,2);
 change=true;assert.equal((await policy.authorize(scope,null)).status,'paused');change=false;
 wrongBusiness=true;assert.equal((await policy.authorize(scope,null)).status,'paused');wrongBusiness=false;
 offline=true;assert.equal((await policy.authorize(scope,null)).status,'paused');
 await policy.choose(choice('offline-optout',false,'2'));assert.equal((await store.facts(scope)).suppressions.length,1,'withdrawal does not discover registry');
 const audited=JSON.parse((await store.db.get<any>('SELECT decision FROM mkt_consent_authorizations LIMIT 1')).decision);assert.equal(audited.registryRevision,'a'.repeat(64));
});
