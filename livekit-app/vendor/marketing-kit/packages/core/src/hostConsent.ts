import { createHash } from 'node:crypto';
import type { MarketingDbAdapter } from './schema.js';
import { ConsentPolicy, type ConsentPolicyOptions } from './consentPolicy.js';
import { ConsentStore, type ConsentFacts, type ConsentScope, type ConsentAuthority } from './consent.js';

/** Legacy sources remain live authorities; none of these readers use contact snapshots as grants. */
export async function readKitConsentFacts(db:MarketingDbAdapter,authorityId:string,scope:ConsentScope,localTenantId=scope.businessId):Promise<Pick<ConsentFacts,'grants'|'suppressions'>>{
 const grants:ConsentFacts['grants']=[],suppressions:ConsentFacts['suppressions']=[];
 if(scope.purpose!=='marketing')return {grants,suppressions};
 const rows=await db.all<any>('SELECT * FROM support_lead_consent_events WHERE tenant_id=? AND email=? AND channel=? AND purpose=? ORDER BY revision DESC',[localTenantId,scope.recipient,scope.channel,scope.purpose]);
 const current=new Set<string>();
 for(const row of rows){
  const id=`${authorityId}:support-lead:${row.id}`;
  if(!Number(row.granted))suppressions.push({id,sourceRevision:String(row.revision)});
  else if(!current.has(row.lead_id)&&row.consent_text)grants.push({id,sourceRevision:String(row.revision),evidence:{kind:'explicit_choice',text:row.consent_text,version:row.policy_version},supersedes:[]});
  current.add(row.lead_id);
 }
 if(scope.channel==='email'){
  const sub=await db.get<any>('SELECT unsubscribe_token,unsubscribed_at,source FROM mkt_subscribers WHERE tenant_id=? AND email=?',[localTenantId,scope.recipient]);
  if(sub?.unsubscribed_at)suppressions.push({id:`${authorityId}:legacy-kit:${sub.unsubscribe_token}:${sub.unsubscribed_at}`,sourceRevision:String(sub.unsubscribed_at),...(sub.source==='provider_suppression'?{permanent:true}:{})});
 }
 return {grants,suppressions};
}
export function createHostConsent(options:{db:MarketingDbAdapter;authorityId:string;localTenantId?:string;businessId?:()=>string;resolveKey:ConsentPolicyOptions['resolveKey'];peers:ConsentPolicyOptions['peers'];registry?:ConsentPolicyOptions['registry'];additionalFacts?:(scope:ConsentScope,db:MarketingDbAdapter)=>Promise<Pick<ConsentFacts,'grants'|'suppressions'>>;fetch?:typeof fetch}){
 const store=new ConsentStore(options.db,options.authorityId);
 const policy=new ConsentPolicy({store,resolveScope:scope=>{
  if(!options.businessId)return scope;
  const businessId=options.businessId();
  if(scope.businessId!==businessId&&scope.businessId!==options.localTenantId)throw Error('Consent business scope mismatch');
  return {...scope,businessId};
 },resolveKey:options.resolveKey,peers:options.peers,registry:options.registry,...(options.fetch?{fetch:options.fetch}:{}),localFacts:async scope=>{
  if(!options.db.snapshot)throw Error("Coherent consent snapshot unavailable");
  return options.db.snapshot(async db=>{
  const base=await new ConsentStore(db,options.authorityId).facts(scope);
  const extra=await readKitConsentFacts(db,options.authorityId,scope,options.localTenantId);
  const host=options.additionalFacts?await options.additionalFacts(scope,db):{grants:[],suppressions:[]};
  return {...base,coverageRevision:createHash('sha256').update(JSON.stringify([base,extra,host])).digest('hex'),grants:[...base.grants,...extra.grants,...host.grants],suppressions:[...base.suppressions,...extra.suppressions,...host.suppressions]};
  });
 }});
 return {store,policy,async initialize(authorities:ConsentAuthority[]){await store.ensureSchema();for(const authority of authorities)await store.registerAuthority(authority);}};
}
export const consentConfigDigest=(a:ConsentAuthority)=>createHash('sha256').update(JSON.stringify([a.businessId,a.id,a.endpoint,a.keyRef])).digest('hex');

/** Dedicated peer discovery never exposes credentials and never recursively asks for eligibility. */
export async function discoverConsentRegistry(options:{businessId:string;authorityId:string;endpoint:string;key:string;centralEligibilityEndpoint:string;fetch?:typeof fetch}){
 if(!options.key)throw Error('Consent registry credential unavailable');
 const response=await (options.fetch||fetch)(options.endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Consent-Key':options.key,'X-Consent-Authority':options.authorityId},body:JSON.stringify({businessId:options.businessId}),signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok)throw Error('Consent registry unavailable');
 const registry=await response.json() as any;
 if(registry.businessId!==options.businessId||!Array.isArray(registry.authorities))throw Error('Invalid consent registry');
 return {...registry,authorities:registry.authorities.map((a:ConsentAuthority)=>({...a,endpoint:a.id==='opshub'?options.centralEligibilityEndpoint:a.endpoint,keyRef:`CONSENT_${a.id.toUpperCase().replace(/[^A-Z0-9]/g,'_')}_KEY`}))};
}
