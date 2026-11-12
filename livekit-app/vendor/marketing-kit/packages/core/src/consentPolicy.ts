import { randomUUID, timingSafeEqual,createHash,createHmac } from 'node:crypto';
import { ConsentStore, authorizeConsent, normalizeConsentScope, type ConsentScope, type ConsentFacts, type ConsentEvent, type ConsentAuthority, type ConsentDecision } from './consent.js';

export interface ConsentPolicyOptions {
 store:ConsentStore;
 registry?:(businessId:string)=>Promise<{businessId:string;revision:string;authorities:ConsentAuthority[]}>;
 resolveScope?:(scope:ConsentScope)=>ConsentScope;
 /** Local facts include every intake table owned by this authority. Missing tables must throw. */
 localFacts:(scope:ConsentScope)=>Promise<ConsentFacts>;
 resolveKey:(reference:string)=>string|undefined|Promise<string|undefined>;
 /** Exact business/authority/action grants; these credentials never grant marketing console access. */
 peers:()=>Array<{businessId:string;authorityId:string;key:string}>|Promise<Array<{businessId:string;authorityId:string;key:string}>>;
 fetch?:typeof fetch;
}
export class ConsentPolicy {
 constructor(readonly options:ConsentPolicyOptions){options.store.retirementVerifier=a=>this.verifyRetirement(a);}
 private async verifyRetirement(a:ConsentAuthority){
  const key=await this.options.resolveKey(a.keyRef);if(!key)throw Error('Retirement peer unavailable');
  const response=await (this.options.fetch||fetch)(a.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Consent-Key':key,'X-Consent-Authority':this.options.store.authorityId},body:JSON.stringify({businessId:a.businessId,action:'closure-proof'}),signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok)throw Error('Source closure proof unavailable');
  const {proof,signature}=await response.json() as any;
  const digest=createHash('sha256').update(JSON.stringify([a.businessId,a.id,a.endpoint,a.keyRef])).digest('hex');
  if(!proof||proof.businessId!==a.businessId||proof.authorityId!==a.id||proof.configDigest!==digest||proof.closed!==true||proof.urlsRerouted!==true||proof.preferencesRerouted!==true||proof.backlog!==0||!/^\d+$/.test(proof.highWater)||!/^([a-f0-9]{64})$/.test(proof.suppressionDigest)||typeof proof.receiptId!=='string'||!proof.receiptId)throw Error('Incomplete source closure/reconciliation proof');
  const expected=createHmac('sha256',key).update(JSON.stringify(proof)).digest('hex');
  if(typeof signature!=='string'||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error('Invalid signed closure proof');
  return proof;
 }
 private scope(scope:ConsentScope){return normalizeConsentScope(this.options.resolveScope?this.options.resolveScope(scope):scope);}
 async localFacts(scope:ConsentScope){return this.options.localFacts(this.scope(scope));}
 async authenticate(businessId:string,authorityId:string,key:string){
  return (await this.options.peers()).some(p=>p.businessId===businessId&&p.authorityId===authorityId&&!!p.key&&Buffer.byteLength(key)===Buffer.byteLength(p.key)&&timingSafeEqual(Buffer.from(key),Buffer.from(p.key)));
 }
 private async registry(businessId:string){
  const registry=await (this.options.registry?this.options.registry(businessId):this.options.store.registry(businessId));
  const authorities=registry?.authorities;
  if(registry?.businessId!==businessId||!/^([a-f0-9]{64})$/.test(registry.revision)||!Array.isArray(authorities)||!authorities.length||new Set(authorities.map(a=>a.id)).size!==authorities.length||authorities.some(a=>a.businessId!==businessId||!a.id||!a.endpoint||!a.keyRef)||!authorities.some(a=>a.id===this.options.store.authorityId))throw Error('Complete current authority registry required');
  return registry;
 }
 async check(scope:ConsentScope):Promise<ConsentDecision>{
  scope=this.scope(scope);
  const startedAt=new Date().toISOString();
  try{
   const registry=await this.registry(scope.businessId);
   const decision=await authorizeConsent(scope,registry.authorities.map(a=>()=>a.id===this.options.store.authorityId?this.localFacts(scope):this.remoteFacts(a,scope)));
   decision.startedAt=startedAt;decision.expiresAt=new Date(Date.parse(startedAt)+10000).toISOString();decision.registryRevision=registry.revision;
   const current=await this.registry(scope.businessId);decision.checkedAt=new Date().toISOString();
   if(current.revision!==registry.revision||Date.now()>Date.parse(decision.expiresAt))return {...decision,status:'paused',reason:'Authority registry changed or authorization expired; fresh checks required'};
   return decision;
  }catch{return {...await authorizeConsent(scope,[]),startedAt,reason:'Current consent authority registry unavailable'};}
 }
 private async remoteFacts(a:ConsentAuthority,scope:ConsentScope):Promise<ConsentFacts>{
  const key=await this.options.resolveKey(a.keyRef);if(!key)throw Error('Missing consent peer configuration');
  const response=await (this.options.fetch||fetch)(a.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Consent-Key':key,'X-Consent-Authority':this.options.store.authorityId},body:JSON.stringify(scope),signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok)throw Error('Consent authority unavailable');const result=await response.json() as ConsentFacts;
  if(result.authorityId!==a.id)throw Error('Wrong consent authority');return result;
 }
 async authorize(scope:ConsentScope,campaignId:string|null){
  scope=this.scope(scope);
  const decision=await this.check(scope);
  await this.options.store.audit(randomUUID(),scope,campaignId,decision);
  return decision;
 }
 /** Observations are collected by this server. The caller cannot supply a supersession vector. */
 async choose(input:Omit<ConsentEvent,'supersedes'>){
  input={...input,scope:this.scope(input.scope)};
  if(!input.granted)return this.options.store.append({...input,supersedes:[]});
  const before=await this.localFacts(input.scope);
  if(input.expectedVersion!==undefined&&input.expectedVersion!==before.version)throw Error('Consent preference version conflict');
  const decision=await this.check(input.scope);
  if(decision.status==='paused')return {...await this.options.store.append({...input,expectedVersion:before.version,pending:true,supersedes:[]}),pending:true};
  return this.options.store.append({...input,expectedVersion:before.version,supersedes:decision.checks.flatMap(f=>f.suppressions.filter(s=>!s.permanent).map(s=>s.id))});
 }
}
