import type {RecoveryDatabase} from './supportRestore.js';
import type {SupportAuthorityLatch} from './supportAuthority.js';
export const SUPPORT_IDENTITY_SCHEMA='CREATE TABLE IF NOT EXISTS ops_support_host_identity (installation_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,origin TEXT NOT NULL)';
export const SUPPORT_AUTHORITY_LATCH_SCHEMA='CREATE TABLE IF NOT EXISTS ops_support_host_fence (business_id TEXT PRIMARY KEY, revision BIGINT NOT NULL, authority_origin TEXT NOT NULL, legacy_disabled INTEGER NOT NULL DEFAULT 0)';
export function supportBusinessId(configured:string|undefined,fallback:string){const id=(configured??fallback).trim();if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw Error('Invalid configured support business ID');return id;}
/** Installation is the immutable host/source namespace; business is the authenticated central registry ID. */
export function createSupportInstallationStore(db:RecoveryDatabase,installationId:string){
 const tx=<T>(businessId:string,work:(sql:any,binding:any)=>Promise<T>)=>db.transaction(async sql=>{
  await sql.run(SUPPORT_IDENTITY_SCHEMA);await sql.run(SUPPORT_AUTHORITY_LATCH_SCHEMA);
  const binding=await sql.get('SELECT * FROM ops_support_host_identity WHERE installation_id=?',[installationId]);
  const prior=await sql.all('SELECT business_id FROM ops_support_host_fence');
  if(binding&&binding.business_id!==businessId||prior.some(row=>row.business_id!==businessId))throw Error('Known installation business identity cannot be changed');
  return work(sql,binding);
 });
 return {
  async read(businessId:string):Promise<SupportAuthorityLatch|null>{return tx(businessId,async sql=>{const row=await sql.get('SELECT revision,authority_origin,legacy_disabled FROM ops_support_host_fence WHERE business_id=?',[businessId]);return row?{revision:Number(row.revision),origin:row.authority_origin,legacyDisabled:Number(row.legacy_disabled)===1}:null;});},
  async write(businessId:string,revision:number,details:{origin:string;legacyDisabled:boolean}){return tx(businessId,async(sql,binding)=>{
   if(binding&&binding.origin!==details.origin)throw Error('Known installation origin cannot be changed');
   await sql.run('INSERT INTO ops_support_host_identity(installation_id,business_id,origin) VALUES(?,?,?) ON CONFLICT(installation_id) DO NOTHING',[installationId,businessId,details.origin]);
   await sql.run('INSERT INTO ops_support_host_fence(business_id,revision,authority_origin,legacy_disabled) VALUES(?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET revision=CASE WHEN ops_support_host_fence.revision>excluded.revision THEN ops_support_host_fence.revision ELSE excluded.revision END,legacy_disabled=CASE WHEN ops_support_host_fence.legacy_disabled>excluded.legacy_disabled THEN ops_support_host_fence.legacy_disabled ELSE excluded.legacy_disabled END',[businessId,revision,details.origin,details.legacyDisabled?1:0]);
  });},
 };
}
export function supportWorkspaceHandoff(base:string,businessId:string,legacyQuery:string){
 const url=new URL('/support',base),query=new URLSearchParams(legacyQuery);url.searchParams.set('business',businessId);
 const ticket=query.get('ticket'),source=query.get('source');if(ticket&&/^[a-zA-Z0-9_-]{1,128}$/.test(ticket)){url.searchParams.set('legacyTicket',ticket);if(source&&/^[a-zA-Z0-9_-]{1,120}$/.test(source))url.searchParams.set('source',source);}
 return url.toString();
}
