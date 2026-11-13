import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ConsentStore, authorizeConsent, type ConsentScope } from './consent.js';

function database() {
 const raw=new DatabaseSync(':memory:');
 const adapter:any={async run(sql:string, p:any[]=[]){return {changes:Number(raw.prepare(sql).run(...p).changes)}},async get<T>(sql:string,p:any[]=[]){return raw.prepare(sql).get(...p) as T},async all<T>(sql:string,p:any[]=[]){return raw.prepare(sql).all(...p) as T[]},async transaction(work:any){raw.exec('BEGIN');try{const result=await work(adapter);raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}}};return adapter;
}
const scope:ConsentScope={businessId:'lalia',recipient:'a@example.test',channel:'email',purpose:'marketing'};
async function fixture(){const store=new ConsentStore(database(),'lalia');await store.ensureSchema();return store;}
const event=(id:string,revision:string,granted:boolean,extra:any={})=>({id,sourceId:'account:42',sourceRevision:revision,scope,granted,evidence:granted?{kind:'explicit_choice',text:'Email marketing',version:'1'}:null,supersedes:[],...extra});
test('absent consent and snapshots cannot grant; source revisions cannot undo suppression',async()=>{
 const s=await fixture();assert.equal((await authorizeConsent(scope,[()=>s.facts(scope)])).status,'suppressed');
 await assert.rejects(s.append(event('snapshot','1',true,{evidence:null})),/evidence/);
 await s.append(event('off','2',false));await s.append(event('old','1',true));
 assert.equal((await authorizeConsent(scope,[()=>s.facts(scope)])).status,'suppressed');
 await assert.rejects(s.append(event('conflict','2',true)),/revision conflict/);
 assert.equal((await s.pendingReports()).length,2);
});
test('fresh consent must cover every live suppression revision, across authorities',async()=>{
 const a=await fixture(),b=await fixture();await a.append(event('on','1',true));await b.append(event('off','2',false));
 const checks=[()=>a.facts(scope),()=>b.facts(scope)];assert.equal((await authorizeConsent(scope,checks)).status,'suppressed');
 const observed=await b.facts(scope);await a.append(event('fresh','3',true,{supersedes:observed.suppressions.map(x=>x.id)}));
 assert.equal((await authorizeConsent(scope,checks)).status,'eligible');
 await b.append(event('off-again','4',false));assert.equal((await authorizeConsent(scope,checks)).status,'suppressed');
});
test('business/channel/purpose separation and unavailable checks fail closed',async()=>{
 const s=await fixture();await s.append(event('on','1',true));
 assert.equal((await authorizeConsent({...scope,businessId:'legalai'},[()=>s.facts({...scope,businessId:'legalai'})])).status,'suppressed');
 assert.equal((await authorizeConsent({...scope,channel:'sms'},[()=>s.facts({...scope,channel:'sms'})])).status,'suppressed');
 assert.equal((await authorizeConsent({...scope,purpose:'support'},[()=>s.facts({...scope,purpose:'support'})])).status,'suppressed');
 assert.equal((await authorizeConsent(scope,[()=>s.facts(scope),async()=>{throw Error('offline')}])).status,'paused');
 assert.equal((await authorizeConsent(scope,[])).status,'paused');
});
test('repeated event tokens are idempotent; grants require current version; retirement requires reconciliation',async()=>{
 const s=await fixture();await s.append(event('off','1',false));await s.append(event('off','1',false));assert.equal((await s.pendingReports()).length,1);
 await assert.rejects(s.append(event('on','2',true,{expectedVersion:'stale'})),/version conflict/);
 await s.registerAuthority({businessId:'lalia',id:'legacy',endpoint:'http://127.0.0.1/consent',keyRef:'LEGACY_KEY'});
 await assert.rejects(s.retireAuthority('lalia','legacy',{}),/rerout|reconcil/);
 assert.equal((await s.authorities('lalia')).length,1);
});
