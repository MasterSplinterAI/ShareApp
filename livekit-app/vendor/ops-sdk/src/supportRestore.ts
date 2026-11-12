import {supportPayloadHash} from './supportGateway.js';
import type {SupportForwardedUser} from './index.js';
export const RESTORE_TABLES={tickets:'support_tickets',messages:'support_messages',proposals:'support_proposals',gaps:'support_knowledge_gaps',kb:'support_kb_articles',revisions:'support_kb_revisions',leads:'support_leads'} as const;
export interface RecoverySql {all(sql:string,params?:unknown[]):Promise<any[]>;get(sql:string,params?:unknown[]):Promise<any>;run(sql:string,params?:unknown[]):Promise<unknown>;columns(table:string):Promise<string[]>;identity():Promise<string>}
export interface RecoveryDatabase {transaction<T>(work:(sql:RecoverySql)=>Promise<T>):Promise<T>}
export interface ReverseArtifact {version:number;businessId:string;generation:string;freezeId:string;targetHash:string;checksum:string;snapshot:{tables:Record<string,any[]>};reverse:Record<string,any[]>}
const stringify=(v:unknown)=>JSON.stringify(v);
const dto=(row:any)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),value]));
const schema=[
 'CREATE TABLE IF NOT EXISTS ops_support_restore_backups(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,checksum TEXT NOT NULL,snapshot_json TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ops_support_restore_runs(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,artifact_hash TEXT NOT NULL,source_generation TEXT NOT NULL,freeze_id TEXT NOT NULL,backup_hash TEXT NOT NULL,target_hash TEXT NOT NULL,proof_json TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ops_support_restore_archive(business_id TEXT NOT NULL,collection TEXT NOT NULL,row_key TEXT NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(business_id,collection,row_key))',
 'CREATE TABLE IF NOT EXISTS ops_support_recovery_receipts(business_id TEXT NOT NULL,actor_type TEXT NOT NULL,actor_id TEXT NOT NULL,operation TEXT NOT NULL,request_key TEXT NOT NULL,payload_hash TEXT NOT NULL,actor_org_id TEXT,result_json TEXT NOT NULL,PRIMARY KEY(business_id,actor_type,actor_id,operation,request_key))',
];
async function initialize(sql:RecoverySql){for(const statement of schema)await sql.run(statement);}
async function snapshot(sql:RecoverySql,business:string){const tables:Record<string,any[]>={};for(const [entity,table] of Object.entries(RESTORE_TABLES))tables[entity]=await sql.all(`SELECT * FROM ${table} WHERE tenant_id=? ORDER BY id`,[business]);tables.archive=await sql.all('SELECT * FROM ops_support_restore_archive WHERE business_id=? ORDER BY collection,row_key',[business]);tables.receipts=await sql.all('SELECT * FROM ops_support_recovery_receipts WHERE business_id=? ORDER BY actor_type,actor_id,operation,request_key',[business]);return tables;}
async function pendingEvidence(sql:RecoverySql,business:string){const tables=await sql.columns('ops_support_pending');if(!tables.length)return [];const rows=await sql.all('SELECT receipt_id,record_json,status,encrypted_secret FROM ops_support_pending WHERE business_id=? ORDER BY receipt_id',[business]);return Promise.all(rows.map(async row=>{const i=JSON.parse(row.record_json);if(await supportPayloadHash(i.payload)!==i.payloadHash)throw Error('Pending payload integrity mismatch');return {receiptId:i.receiptId,businessId:i.businessId,generation:i.generation,actorType:i.actorType,actorId:i.actor.id,orgId:i.actor.orgId??null,operation:i.operation,key:i.key,payloadHash:i.payloadHash,acceptedAt:i.acceptedAt,acceptedUntil:i.acceptedUntil,status:row.status,proofAvailable:i.actorType==='customer'||Boolean(row.encrypted_secret)};}));}
async function privatePendingHash(sql:RecoverySql,business:string){return supportPayloadHash((await sql.columns('ops_support_pending')).length?await sql.all('SELECT * FROM ops_support_pending WHERE business_id=? ORDER BY receipt_id',[business]):[]);}
function staging(identity:string){if(!/(?:^|[\/_-])(staging|test)(?:[\/_-]|$)/i.test(identity)||/production|(?:^|[\/_-])prod(?:[\/_-]|$)/i.test(identity))throw Error('Restored staging/test source required');}
export async function createSupportRestoreBackup(db:RecoveryDatabase,businessId:string){return db.transaction(async sql=>{staging(await sql.identity());await initialize(sql);const data=await snapshot(sql,businessId),checksum=await supportPayloadHash(data),id=crypto.randomUUID();await sql.run('INSERT INTO ops_support_restore_backups(id,business_id,checksum,snapshot_json) VALUES(?,?,?,?)',[id,businessId,checksum,stringify(data)]);return {id,checksum};});}
/** Applies only to a fenced restored staging source. No provider, legacy proposal, or sender is invoked. */
export async function applySupportReverseDelta(db:RecoveryDatabase,artifact:ReverseArtifact,backupId:string,verifyFrozen:()=>Promise<{businessId:string;generation:string;freezeId:string;state:string;acceptanceClosed:boolean}>){
 const {checksum,...body}=artifact;if(artifact.version!==1||await supportPayloadHash(body)!==checksum)throw Error('Reverse artifact checksum mismatch');
 const authority=await verifyFrozen();if(authority.businessId!==artifact.businessId||authority.generation!==artifact.generation||authority.freezeId!==artifact.freezeId||authority.state!=='central_frozen'||!authority.acceptanceClosed)throw Error('Sealed central authority required');
 return db.transaction(async sql=>{
  const identity=await sql.identity();staging(identity);await initialize(sql);
  const backup=await sql.get('SELECT * FROM ops_support_restore_backups WHERE id=? AND business_id=?',[backupId,artifact.businessId]);if(!backup||backup.checksum!==await supportPayloadHash(await snapshot(sql,artifact.businessId)))throw Error('Restored-source backup revision changed');
  const beforePending=await pendingEvidence(sql,artifact.businessId),pendingStorageHash=await privatePendingHash(sql,artifact.businessId);const business=artifact.businessId;
  for(const table of Object.values(RESTORE_TABLES).reverse())await sql.run(`DELETE FROM ${table} WHERE tenant_id=?`,[business]);
  for(const [entity,table] of Object.entries(RESTORE_TABLES)){
   const allowed=new Set(await sql.columns(table));
   for(const raw of artifact.snapshot.tables[entity]??[]){if(raw.tenant_id!==business)throw Error('Reverse cross-business row');const row={...raw};if(entity==='proposals')row.status='rejected';if(entity==='messages')row.attachments_json=null;
    const columns=Object.keys(row).filter(k=>allowed.has(k));if(!columns.includes('id')||!columns.includes('tenant_id'))throw Error('Restored schema incompatible');
    await sql.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,columns.map(k=>row[k]));
   }
  }
  await sql.run('DELETE FROM ops_support_restore_archive WHERE business_id=?',[business]);
  for(const [collection,rows] of Object.entries(artifact.snapshot.tables))for(let index=0;index<rows.length;index++)await sql.run('INSERT INTO ops_support_restore_archive(business_id,collection,row_key,record_json) VALUES(?,?,?,?)',[business,collection,String(index).padStart(12,'0'),stringify(rows[index])]);
  await sql.run('DELETE FROM ops_support_recovery_receipts WHERE business_id=?',[business]);
  for(const row of artifact.snapshot.tables.ops_support_receipts??[]){const pending=beforePending.find(e=>e.actorType===row.actor_type&&e.actorId===row.actor_id&&e.operation===row.operation&&e.key===row.request_key);const ticket=artifact.snapshot.tables.tickets.find(t=>t.id===row.result?.body?.ticket?.id);await sql.run('INSERT INTO ops_support_recovery_receipts(business_id,actor_type,actor_id,operation,request_key,payload_hash,actor_org_id,result_json) VALUES(?,?,?,?,?,?,?,?)',[business,row.actor_type,row.actor_id,row.operation,row.request_key,row.payload_hash,pending?.orgId??ticket?.org_id??null,stringify(row.result)]);}
  if(pendingStorageHash!==await privatePendingHash(sql,business)||await supportPayloadHash(beforePending)!==await supportPayloadHash(await pendingEvidence(sql,business)))throw Error('Host pending receipts changed during restore');
  const targetHash=await supportPayloadHash(await snapshot(sql,business)),restoreId=crypto.randomUUID();
  const proof={version:1,businessId:business,restoreId,artifactHash:checksum,generation:artifact.generation,freezeId:artifact.freezeId,backupHash:backup.checksum,targetHash,pending:beforePending,pendingHash:await supportPayloadHash(beforePending),pendingStorageHash,identity,writer:'frozen',sender:'disabled'};
  await sql.run('INSERT INTO ops_support_restore_runs(id,business_id,artifact_hash,source_generation,freeze_id,backup_hash,target_hash,proof_json) VALUES(?,?,?,?,?,?,?,?)',[restoreId,business,checksum,artifact.generation,artifact.freezeId,backup.checksum,targetHash,stringify(proof)]);
  return {...proof,checksum:await supportPayloadHash(proof)};
 });
}
/** Called by the authenticated source authority endpoint; computes current evidence, not caller flags. */
export async function verifyRestoredSupportSource(db:RecoveryDatabase,businessId:string,restoreId:string){return db.transaction(async sql=>{
 await initialize(sql);const row=await sql.get('SELECT * FROM ops_support_restore_runs WHERE id=? AND business_id=?',[restoreId,businessId]);if(!row)throw Error('Unknown restore');const proof=JSON.parse(row.proof_json);
 if(proof.pendingStorageHash!==await privatePendingHash(sql,businessId)||row.target_hash!==await supportPayloadHash(await snapshot(sql,businessId))||proof.pendingHash!==await supportPayloadHash(await pendingEvidence(sql,businessId)))throw Error('Restored-source reconciliation changed');
 return {...proof,checksum:await supportPayloadHash(proof)};
});}
export async function resolveRestoredSupportAlias(sql:RecoverySql,business:string,alias:string,source?:string){const rows=(await sql.all("SELECT record_json FROM ops_support_restore_archive WHERE business_id=? AND collection='ops_support_history_aliases'",[business])).map(r=>JSON.parse(r.record_json)).filter(r=>r.alias===alias&&(!source||r.source===source));const ids=[...new Set(rows.map(r=>r.central_id))];if(ids.length!==1)throw Error('Unknown or ambiguous source alias');return ids[0];}
export interface RecoveryActor extends SupportForwardedUser {principalType:'customer'|'guest'}
/** Limited recovery: only current server-authenticated actors, own history, deduplicated capture; zero providers. */
export async function runRestoredSupportRequest(db:RecoveryDatabase,input:{businessId:string;generation:string;method:string;path:string;key?:string;payload:Record<string,any>;actor:RecoveryActor;authorize:()=>Promise<boolean>;authority:()=>Promise<{state:string;generation:string;restoreId?:string}>}){
 return db.transaction(async sql=>{
  const authority=await input.authority();if(authority.state!=='recovery'||authority.generation!==input.generation||!authority.restoreId)throw Error('Restored recovery authority unavailable');
  const restore=await sql.get('SELECT id FROM ops_support_restore_runs WHERE id=? AND business_id=?',[authority.restoreId,input.businessId]);if(!restore||!await input.authorize())throw Error('Current own-history authority required');
  const {businessId,actor}=input;const path=input.path.split('?')[0];const scope=[businessId,actor.principalType,actor.id,`${input.method}:${path}`,input.key];
  const ticket=async(id:string)=>sql.get('SELECT * FROM support_tickets WHERE tenant_id=? AND id=? AND user_id=?',[businessId,id,actor.id]);
  if(input.method==='GET'){
   if(path==='/tickets')return {statusCode:200,body:{ok:true,tickets:(await sql.all('SELECT * FROM support_tickets WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC',[businessId,actor.id])).map(dto)}};
   const match=path.match(/^\/tickets\/([A-Za-z0-9_-]{1,128})$/);if(!match)throw Error('Unsupported recovery read');const row=await ticket(match[1]);if(!row)return {statusCode:404,body:{error:'Not found'}};return {statusCode:200,body:{ok:true,ticket:dto(row),messages:(await sql.all('SELECT * FROM support_messages WHERE tenant_id=? AND ticket_id=? ORDER BY created_at,id',[businessId,row.id])).map(dto)}};
  }
  if(input.method!=='POST'||!/^([A-Za-z0-9:_-]{8,128})$/.test(input.key??'')||!/^\/(tickets|leads|tickets\/[A-Za-z0-9_-]{1,128}\/messages)$/.test(path))throw Error('Only bounded customer capture is available during recovery');
  const payloadHash=await supportPayloadHash(input.payload);const previous=await sql.get('SELECT * FROM ops_support_recovery_receipts WHERE business_id=? AND actor_type=? AND actor_id=? AND operation=? AND request_key=?',scope);
  if(previous&&previous.actor_org_id!==(actor.orgId??null))return {statusCode:409,body:{error:'Original organization required'}};
  if(previous)return previous.payload_hash===payloadHash?JSON.parse(previous.result_json):{statusCode:409,body:{error:'Idempotency key payload conflict'}};
  const now=new Date().toISOString();let result:any;
  if(path==='/leads'){
   const email=String(input.payload.email??'').trim(),name=String(input.payload.name??'').trim();if(!email||!name||email.length>254||name.length>320)throw Error('Invalid lead');
   const old=await sql.get('SELECT id FROM support_leads WHERE tenant_id=? AND email=?',[businessId,email]);const id=old?.id??crypto.randomUUID();if(!old)await sql.run('INSERT INTO support_leads(id,tenant_id,email,name,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',[id,businessId,email,name,'recovery',now,now]);result={statusCode:201,body:{ok:true,lead:{id},deliveryStatus:'unavailable'}};
  }else{
   const message=String(input.payload.body??'');if(!message.trim()||message.length>64000)throw Error('A bounded message is required');let row:any;
   if(path==='/tickets'){const id=crypto.randomUUID(),number=Number((await sql.get('SELECT COALESCE(MAX(public_number),0)+1 AS n FROM support_tickets WHERE tenant_id=?',[businessId])).n);await sql.run('INSERT INTO support_tickets(id,tenant_id,public_number,kind,topic,category,status,subject,user_id,org_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,businessId,number,input.payload.kind??'support',input.payload.topic??'other','general','open',String(input.payload.subject??'').slice(0,1000),actor.id,actor.orgId??null,now,now]);row=await ticket(id);}
   else{row=await ticket(path.split('/')[2]);if(!row)return {statusCode:404,body:{error:'Not found'}};}
   await sql.run('INSERT INTO support_messages(id,tenant_id,ticket_id,author_type,author_id,body,created_at) VALUES(?,?,?,?,?,?,?)',[crypto.randomUUID(),businessId,row.id,'user',actor.id,message,now]);result={statusCode:201,body:{ok:true,ticket:dto(row),deliveryStatus:'unavailable',recovery:true}};
  }
  await sql.run('INSERT INTO ops_support_recovery_receipts(business_id,actor_type,actor_id,operation,request_key,payload_hash,actor_org_id,result_json) VALUES(?,?,?,?,?,?,?,?)',[...scope,payloadHash,actor.orgId??null,stringify(result)]);return result;
 });
}
export function createPostgresRecoveryDatabase(pool:{connect():Promise<any>}):RecoveryDatabase{return {transaction:async work=>{const client=await pool.connect();const convert=(sql:string)=>{let n=0;return sql.replace(/\?/g,()=>'$'+(++n));};const query=(sql:string,params:unknown[]=[])=>client.query(convert(sql),params);try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15s'");await client.query("SELECT pg_advisory_xact_lock(hashtext('support.recovery'))");const result=await work({all:async(sql,p)=>(await query(sql,p)).rows,get:async(sql,p)=>(await query(sql,p)).rows[0],run:query,columns:async table=>(await query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?',[table])).rows.map((r:any)=>r.column_name),identity:async()=>{const row=(await client.query('SELECT current_database() AS name,current_schema() AS schema')).rows[0];return row.name+'/'+row.schema;}});await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};}
export function createSqliteRecoveryDatabase(open:()=>Promise<{all(sql:string,params?:unknown[]):Promise<any[]>;close():Promise<void>}>):RecoveryDatabase{return {transaction:async work=>{const connection=await open();try{await connection.all('BEGIN IMMEDIATE');const result=await work({all:connection.all,get:async(sql,p)=>(await connection.all(sql,p))[0],run:connection.all,columns:async table=>{if(!/^[a-z_]+$/.test(table))throw Error('Invalid table');return (await connection.all('PRAGMA table_info('+table+')')).map(r=>r.name);},identity:async()=>(await connection.all('PRAGMA database_list')).find(r=>r.name==='main').file});await connection.all('COMMIT');return result;}catch(error){await connection.all('ROLLBACK');throw error;}finally{await connection.close();}}};}
export async function resolveRestoredSupportGuest(db:RecoveryDatabase,businessId:string,token:string,accepted?:{acceptedAt:number;acceptedUntil:number}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));const digest=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 return db.transaction(async sql=>{const guests=await sql.all("SELECT record_json FROM ops_support_restore_archive WHERE business_id=? AND collection='support_guest_sessions'",[businessId]);const row=guests.map(r=>JSON.parse(r.record_json)).find(r=>r.token_hash===digest);if(!row)return null;const expiry=Date.parse(row.expires_at);if(expiry<=Date.now()&&!(accepted&&accepted.acceptedUntil>Date.now()&&accepted.acceptedAt<expiry&&accepted.acceptedAt>=expiry-86400000))return null;return {id:row.owner_id,role:'user' as const,principalType:'guest' as const,email:row.email,name:row.name};});
}
