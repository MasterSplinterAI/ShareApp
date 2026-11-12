import type {RecoveryDatabase,RecoverySql} from './supportRestore.js';
import type {HostSupportAuthority} from './supportAuthority.js';
export interface HostAcceptanceGrant {id:string;businessId:string;generation:string;expiresAt:number}
export const SUPPORT_ACCEPTANCE_SCHEMA='CREATE TABLE IF NOT EXISTS ops_support_host_acceptance (business_id TEXT PRIMARY KEY,generation TEXT NOT NULL,closed INTEGER NOT NULL,grant_json TEXT,authority_json TEXT,origin TEXT NOT NULL)';
/** The host supplies AsyncLocalStorage. Pending writes and recovery mutations use this same transaction. */
export function createSupportAcceptanceStore(raw:RecoveryDatabase,context:{getStore():RecoverySql|undefined;run<T>(sql:RecoverySql,work:()=>T):T}){
 const denied=new WeakMap<RecoverySql,Set<string>>();
 const database:RecoveryDatabase={transaction:async work=>{
  const active=context.getStore();if(active)return work(active);
  let rejection:{error:unknown}|undefined;
  const result=await raw.transaction(async sql=>{
   // Keep the source lock while rolling back caller work. A confirmed denial must
   // become durable before another process can start an acceptance transaction.
   await sql.run('SAVEPOINT support_acceptance_work');
   return context.run(sql,async()=>{
    try{return await work(sql);}
    catch(error){
     const invalidations=denied.get(sql);if(!invalidations?.size)throw error;
     await sql.run('ROLLBACK TO SAVEPOINT support_acceptance_work');
     await sql.run(SUPPORT_ACCEPTANCE_SCHEMA);
     for(const business of invalidations)await sql.run('UPDATE ops_support_host_acceptance SET authority_json=NULL WHERE business_id=?',[business]);
     rejection={error};return undefined;
    }finally{denied.delete(sql);}
   });
  });
  if(rejection)throw rejection.error;return result as Awaited<ReturnType<typeof work>>;
 }};
 const transaction=<T>(work:(sql:RecoverySql)=>Promise<T>)=>database.transaction(sql=>context.run(sql,async()=>{await sql.run(SUPPORT_ACCEPTANCE_SCHEMA);return work(sql);}));
 const row=(sql:RecoverySql,business:string)=>sql.get('SELECT * FROM ops_support_host_acceptance WHERE business_id=?',[business]);
 return {
  database,
  sql:{all:(s:string,p?:unknown[])=>database.transaction(sql=>sql.all(s,p)),get:(s:string,p?:unknown[])=>database.transaction(sql=>sql.get(s,p)),run:(s:string,p?:unknown[])=>database.transaction(sql=>sql.run(s,p))},
  async invalidate(business:string){const active=context.getStore();if(active){let entries=denied.get(active);if(!entries){entries=new Set();denied.set(active,entries);}entries.add(business);await active.run('UPDATE ops_support_host_acceptance SET authority_json=NULL WHERE business_id=?',[business]);return;}await transaction(sql=>sql.run('UPDATE ops_support_host_acceptance SET authority_json=NULL WHERE business_id=?',[business]));},
  async cached(business:string,origin:string){return transaction(async sql=>{const r=await row(sql,business);if(!r||r.closed||r.origin!==origin||!r.grant_json||!r.authority_json)return null;const grant=JSON.parse(r.grant_json),authority=JSON.parse(r.authority_json);return grant.expiresAt>Date.now()&&authority.expiresAt>Date.now()?authority as HostSupportAuthority:null;});},
  async establish(authority:HostSupportAuthority,origin:string,acquire:()=>Promise<HostAcceptanceGrant>,release:(id:string)=>Promise<unknown>){return transaction(async sql=>{
   const existing=await row(sql,authority.businessId);if(existing?.origin&&existing.origin!==origin)throw Error('Acceptance origin mismatch');
   if(existing&&BigInt(existing.generation)>BigInt(authority.generation))throw Error('Acceptance generation rollback');
   if(existing?.closed&&existing.generation===authority.generation)throw Error('Source acceptance sealed');
   const old=existing?.grant_json?JSON.parse(existing.grant_json):null;
   let grant=old?.generation===authority.generation&&old.expiresAt>Date.now()?old:null;
   if(!grant){if(old)await release(old.id);grant=await acquire();if(grant.businessId!==authority.businessId||grant.generation!==authority.generation||grant.expiresAt<=Date.now())throw Error('Invalid acceptance grant');}
   await sql.run('INSERT INTO ops_support_host_acceptance(business_id,generation,closed,grant_json,authority_json,origin) VALUES(?,?,0,?,?,?) ON CONFLICT(business_id) DO UPDATE SET generation=excluded.generation,closed=0,grant_json=excluded.grant_json,authority_json=excluded.authority_json',[authority.businessId,authority.generation,JSON.stringify(grant),JSON.stringify(authority),origin]);return grant;
  });},
  async run<T>(business:string,generation:string,work:()=>Promise<T>):Promise<T>{return transaction(async sql=>{const r=await row(sql,business),grant=r?.grant_json?JSON.parse(r.grant_json):null;if(!r||r.closed||r.generation!==generation||!grant||!r.authority_json||JSON.parse(r.authority_json).expiresAt<=Date.now()||grant.expiresAt<=Date.now())throw Error('Source acceptance unavailable or expired');return context.run(sql,work);});},
  async seal(authority:HostSupportAuthority,origin:string){return transaction(async sql=>{const r=await row(sql,authority.businessId);if(r&&(r.origin!==origin||r.generation!==authority.generation))throw Error('Source seal generation mismatch');await sql.run('INSERT INTO ops_support_host_acceptance(business_id,generation,closed,origin) VALUES(?,?,1,?) ON CONFLICT(business_id) DO UPDATE SET closed=1',[authority.businessId,authority.generation,origin]);return r?.grant_json?JSON.parse(r.grant_json) as HostAcceptanceGrant:null;});},
 };
}
