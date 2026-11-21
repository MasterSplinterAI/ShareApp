import { createHash } from 'node:crypto';
import type { MarketingDbAdapter } from './schema.js';

export interface ConsentScope { businessId:string; recipient:string; channel:string; purpose:string }
export interface ConsentEvidence { kind:'explicit_choice'; text:string; version:string }
export interface ConsentEvent {
 id:string; sourceId:string; sourceRevision:string; scope:ConsentScope; granted:boolean;
 evidence:ConsentEvidence|null; supersedes:string[]; expectedVersion?:string; occurredAt?:string;
 /** Provider deliverability blocks cannot be cleared by a preference change. */
 permanent?:boolean;
 pending?:boolean;
}
export interface ConsentFacts {
 authorityId:string; coverageRevision?:string; scope:ConsentScope; version:string; coverage:'complete'; observedAt?:string;
 suppressions:Array<{id:string;sourceRevision:string;permanent?:boolean}>;
 grants:Array<{id:string;sourceRevision:string;evidence:ConsentEvidence;supersedes:string[]}>;
}
export interface ConsentDecision {registryRevision?:string; status:'eligible'|'suppressed'|'paused'; startedAt:string; checkedAt:string; expiresAt:string; checks:ConsentFacts[]; reason:string}
export interface ConsentAuthority { businessId:string; id:string; endpoint:string; keyRef:string }
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function normalizeConsentScope(s:ConsentScope):ConsentScope {
 if(!s.businessId||s.businessId==='all'||!s.recipient?.includes('@')||!s.channel||!s.purpose)throw Error('Explicit consent business, recipient, channel and purpose required');
 return {businessId:s.businessId,recipient:s.recipient.trim().toLowerCase(),channel:s.channel,purpose:s.purpose};
}
const scopeId=(s:ConsentScope)=>hash(normalizeConsentScope(s));
export const CONSENT_SCHEMA=[
 'CREATE TABLE IF NOT EXISTS mkt_consent_heads (scope_id TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS mkt_consent_events (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision BIGINT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,accepted_at TEXT NOT NULL,UNIQUE(scope_id,source_id,source_revision))',
 'CREATE INDEX IF NOT EXISTS mkt_consent_events_scope ON mkt_consent_events(scope_id)',
 'CREATE TABLE IF NOT EXISTS mkt_consent_source_reports (source_id TEXT PRIMARY KEY,delivered_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS mkt_consent_report_receipts (event_id TEXT PRIMARY KEY,delivered_at TEXT NOT NULL)',
 "CREATE TABLE IF NOT EXISTS mkt_consent_authorities (business_id TEXT NOT NULL,id TEXT NOT NULL,endpoint TEXT NOT NULL,key_ref TEXT NOT NULL,retirement TEXT,PRIMARY KEY(business_id,id))",
 'CREATE TABLE IF NOT EXISTS mkt_consent_retirements (receipt_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,authority_id TEXT NOT NULL,proof TEXT NOT NULL,verified_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS mkt_consent_authorizations (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL,campaign_id TEXT,decision TEXT NOT NULL,checked_at TEXT NOT NULL)',
];

/** Immutable events are also the reporting queue. A report receipt never changes evidence. */
export class ConsentStore {
 constructor(readonly db:MarketingDbAdapter,readonly authorityId:string){}
 /** Configured only by the authenticated peer policy; never supplied by a public mutation. */
 retirementVerifier?: (authority:ConsentAuthority)=>Promise<{receiptId:string;[key:string]:unknown}>;
 async ensureSchema(){for(const sql of CONSENT_SCHEMA)await this.db.run(sql);}
 async append(input:ConsentEvent, originAuthorityId=this.authorityId):Promise<{id:string;stale:boolean}> {
  const scope=normalizeConsentScope(input.scope);
  if(input.sourceRevision!=='auto'&&!/^\d+$/.test(input.sourceRevision)||!input.id||!input.sourceId)throw Error('Consent source identity/revision required');
  if(input.granted&&(!input.evidence||input.evidence.kind!=='explicit_choice'||!input.evidence.text||!input.evidence.version))throw Error('Fresh explicit consent evidence required');
  const {expectedVersion,...body}=input;
  const event={...body,scope,supersedes:[...new Set(input.supersedes)].sort()};
  const id=`${originAuthorityId}:${input.id}`, sid=scopeId(scope);
  const work=async(db:MarketingDbAdapter)=>{
   // A write locks this scope through commit on both PostgreSQL and SQLite.
   await db.run('INSERT INTO mkt_consent_heads(scope_id,revision) VALUES(?,0) ON CONFLICT(scope_id) DO UPDATE SET revision=mkt_consent_heads.revision',[sid]);
   const repeated=await db.get<any>('SELECT payload_hash,payload FROM mkt_consent_events WHERE id=?',[id]);
   if(repeated){if(input.sourceRevision==='auto')event.sourceRevision=JSON.parse(repeated.payload).sourceRevision;if(repeated.payload_hash!==hash(event))throw Error('Consent event identity conflict');return {id,stale:false};}
   const version=String((await db.get<any>('SELECT revision FROM mkt_consent_heads WHERE scope_id=?',[sid]))?.revision||0);
   if(input.sourceRevision==='auto')event.sourceRevision=String(BigInt(version)+BigInt(1));
   const digest=hash(event);
   if(expectedVersion!==undefined&&version!==expectedVersion)throw Error('Consent preference version conflict');
   const latest=await db.get<any>('SELECT source_revision,payload_hash FROM mkt_consent_events WHERE scope_id=? AND source_id=? ORDER BY source_revision DESC LIMIT 1',[sid,`${originAuthorityId}:${event.sourceId}`]);
   if(latest&&BigInt(latest.source_revision)===BigInt(event.sourceRevision))throw Error('Consent source revision conflict');
   await db.run('INSERT INTO mkt_consent_events(id,scope_id,source_id,source_revision,payload,payload_hash,accepted_at) VALUES(?,?,?,?,?,?,?)',[id,sid,`${originAuthorityId}:${event.sourceId}`,event.sourceRevision,JSON.stringify(event),digest,new Date().toISOString()]);
   await db.run('UPDATE mkt_consent_heads SET revision=revision+1 WHERE scope_id=?',[sid]);
   return {id,stale:Boolean(latest&&BigInt(latest.source_revision)>BigInt(event.sourceRevision))};
  };
  if(!this.db.transaction)throw Error('Transactional consent storage required');
  return this.db.transaction(work);
 }
 async facts(input:ConsentScope):Promise<ConsentFacts>{
  const scope=normalizeConsentScope(input),sid=scopeId(scope);
  const rows=await this.db.all<any>('SELECT h.revision,e.id,e.source_id,e.payload FROM mkt_consent_heads h LEFT JOIN mkt_consent_events e ON e.scope_id=h.scope_id WHERE h.scope_id=? ORDER BY e.source_revision DESC',[sid]);
  const current=new Set<string>();const grants:ConsentFacts['grants']=[],suppressions:ConsentFacts['suppressions']=[];
  for(const row of rows){if(!row.id)continue;const e=JSON.parse(row.payload) as ConsentEvent;
   // All acknowledged withdrawals persist until explicitly covered; delayed old grants never become current.
   if(!e.granted)suppressions.push({id:row.id,sourceRevision:e.sourceRevision,...(e.permanent?{permanent:true}:{})});
   if(!current.has(row.source_id)&&e.granted&&!e.pending&&e.evidence)grants.push({id:row.id,sourceRevision:e.sourceRevision,evidence:e.evidence,supersedes:e.supersedes});
   current.add(row.source_id);
  }
  return {authorityId:this.authorityId,scope,coverage:'complete',version:String(rows[0]?.revision||0),grants,suppressions};
 }
 async pendingReports(){return this.db.all<any>('SELECT e.id,e.payload,e.accepted_at FROM mkt_consent_events e LEFT JOIN mkt_consent_report_receipts r ON r.event_id=e.id WHERE r.event_id IS NULL ORDER BY e.accepted_at LIMIT 100');}
 async acknowledgeReport(id:string){await this.db.run('INSERT INTO mkt_consent_report_receipts(event_id,delivered_at) VALUES(?,?) ON CONFLICT(event_id) DO NOTHING',[id,new Date().toISOString()]);}
 async registerAuthority(a:ConsentAuthority){
  if(!a.businessId||a.businessId==='all'||!a.id||!a.endpoint||!a.keyRef)throw Error('Complete business authority configuration required');
  await this.db.run('INSERT INTO mkt_consent_authorities(business_id,id,endpoint,key_ref) VALUES(?,?,?,?) ON CONFLICT(business_id,id) DO UPDATE SET endpoint=excluded.endpoint,key_ref=excluded.key_ref WHERE mkt_consent_authorities.retirement IS NULL',[a.businessId,a.id,a.endpoint,a.keyRef]);
 }
 async registry(businessId:string){const authorities=await this.authorities(businessId);return {businessId,revision:hash(authorities),authorities};}
 async authorities(businessId:string):Promise<ConsentAuthority[]>{return (await this.db.all<any>('SELECT * FROM mkt_consent_authorities WHERE business_id=? AND retirement IS NULL ORDER BY id',[businessId])).map(r=>({businessId:r.business_id,id:r.id,endpoint:r.endpoint,keyRef:r.key_ref}));}
 /** Final source closure compares this replicated immutable-event inventory with its signed proof. */
 async reconciliation(businessId:string,authorityId:string){
  const rows=await this.db.all<any>('SELECT id,payload,payload_hash FROM mkt_consent_events ORDER BY id');
  const origin=rows.filter(r=>r.id.startsWith(authorityId+':')&&JSON.parse(r.payload).scope.businessId===businessId);
  return {highWater:String(origin.length),suppressionDigest:hash(origin.filter(r=>!JSON.parse(r.payload).granted).map(r=>[r.id,r.payload_hash]))};
 }
 /** A fresh signed source-closure proof is loaded server-to-server. Caller evidence is ignored. */
 async retireAuthority(businessId:string,id:string,_untrustedEvidence?:unknown):Promise<void>{
  const authority=(await this.authorities(businessId)).find(a=>a.id===id);
  if(!authority||id===this.authorityId||!this.retirementVerifier)throw Error('Authority retirement requires verified URL/preference rerouting and final suppression reconciliation receipt');
  const proof=await this.retirementVerifier(authority);
  const reconciled=await this.reconciliation(businessId,id);
  if(proof.highWater!==reconciled.highWater||proof.suppressionDigest!==reconciled.suppressionDigest)throw Error('Final suppression reconciliation mismatch');
  if(!this.db.transaction)throw Error('Transactional authority retirement required');
  await this.db.transaction(async db=>{
   const final=await new ConsentStore(db,this.authorityId).reconciliation(businessId,id);
   if(final.highWater!==proof.highWater||final.suppressionDigest!==proof.suppressionDigest)throw Error('Final suppression reconciliation changed');
   const current=await db.get<any>('SELECT endpoint,key_ref,retirement FROM mkt_consent_authorities WHERE business_id=? AND id=?',[businessId,id]);
   if(!current||current.retirement||current.endpoint!==authority.endpoint||current.key_ref!==authority.keyRef)throw Error('Authority configuration changed during retirement');
   await db.run('INSERT INTO mkt_consent_retirements(receipt_id,business_id,authority_id,proof,verified_at) VALUES(?,?,?,?,?)',[proof.receiptId,businessId,id,JSON.stringify(proof),new Date().toISOString()]);
   const updated=await db.run('UPDATE mkt_consent_authorities SET retirement=? WHERE business_id=? AND id=? AND retirement IS NULL AND endpoint=? AND key_ref=?',[proof.receiptId,businessId,id,authority.endpoint,authority.keyRef]);
   if(updated.changes!==1)throw Error('Authority configuration changed during retirement');
  });
 }

 async audit(id:string,scope:ConsentScope,campaignId:string|null,decision:ConsentDecision){await this.db.run('INSERT INTO mkt_consent_authorizations(id,scope_id,campaign_id,decision,checked_at) VALUES(?,?,?,?,?)',[id,scopeId(scope),campaignId,JSON.stringify(decision),decision.checkedAt]);}
}

/** Every check is live, including local reads; there is no positive cache. */
export async function authorizeConsent(scope:ConsentScope,checks:Array<()=>Promise<ConsentFacts>>):Promise<ConsentDecision>{
 const startedAt=new Date().toISOString(),expiresAt=new Date(Date.now()+10_000).toISOString(),facts:ConsentFacts[]=[];
 const times=()=>({startedAt,checkedAt:new Date().toISOString(),expiresAt});
 if(!checks.length)return {status:'paused',...times(),checks:facts,reason:'Consent authority coverage unavailable'};
 try{for(const check of checks){const f=await check();if(f.coverage!=='complete'||hash(normalizeConsentScope(f.scope))!==hash(normalizeConsentScope(scope))||!Array.isArray(f.suppressions)||!Array.isArray(f.grants))throw Error('Incomplete consent authority response');facts.push({...f,observedAt:new Date().toISOString()});}}
 catch{return {status:'paused',...times(),checks:facts,reason:'Consent authority unavailable or unknown'};}
 if(Date.now()>Date.parse(expiresAt))return {status:'paused',...times(),checks:facts,reason:'Authorization expired'};
 const suppressed=facts.flatMap(f=>f.suppressions),grants=facts.flatMap(f=>f.grants);
 const eligible=!suppressed.some(s=>s.permanent)&&grants.some(g=>g.evidence?.kind==='explicit_choice'&&g.evidence.text&&g.evidence.version&&suppressed.every(s=>g.supersedes.includes(s.id)));
 return {status:eligible?'eligible':'suppressed',...times(),checks:facts,reason:eligible?'Explicit consent covers all checked suppressions':'No current proven grant or unresolved suppression'};
}
