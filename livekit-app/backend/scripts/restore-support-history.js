'use strict';
// Restored staging sources only. No app startup, dotenv, provider adapter, or legacy sender is imported.
const fs=require('node:fs/promises'),path=require('node:path');
const sdk=require('@rhule/ops-sdk');
async function privateJson(file){if(!path.isAbsolute(file))throw Error('Absolute private manifest path required');const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('Private regular 0600 manifest required');return JSON.parse(await fs.readFile(file,'utf8'));}
function stagingName(name){if(!/(?:^|[\/_-])(test|staging)(?:[\/_-]|$)/i.test(name)||/production|(?:^|[\/_-])prod(?:[\/_-]|$)/i.test(name))throw Error('Explicit restored staging/test target required');}
async function connect(){
 const raw=process.env.SUPPORT_RESTORE_DATABASE_URL,file=process.env.SUPPORT_RESTORE_SQLITE_PATH;
 if(Boolean(raw)===Boolean(file))throw Error('Choose SUPPORT_RESTORE_DATABASE_URL or SUPPORT_RESTORE_SQLITE_PATH; inherited DATABASE_URL is ignored');
 if(raw){const url=new URL(raw);if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash)throw Error('Plain PostgreSQL target required');stagingName(url.pathname);const {Pool}=require('pg');const pool=new Pool({connectionString:raw,max:2,connectionTimeoutMillis:5000});return {db:sdk.createPostgresRecoveryDatabase(pool),close:()=>pool.end()};}
 if(!path.isAbsolute(file)||(await fs.lstat(file)).isSymbolicLink())throw Error('Existing absolute SQLite target required');stagingName(file);const sqlite=require('sqlite3');return {db:sdk.createSqliteRecoveryDatabase(async()=>{const c=await new Promise((resolve,reject)=>{const c=new sqlite.Database(file,sqlite.OPEN_READWRITE,e=>e?reject(e):resolve(c));});c.configure('busyTimeout',10000);return {all:(s,p=[])=>new Promise((resolve,reject)=>c.all(s,p,(e,r)=>e?reject(e):resolve(r))),close:()=>new Promise((resolve,reject)=>c.close(e=>e?reject(e):resolve()))};}),close:async()=>{}};
}
async function frozen(businessId){const base=new URL(process.env.SUPPORT_RESTORE_HUB_URL??'');if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Authenticated HTTPS hub required');const key=process.env.SUPPORT_RESTORE_HUB_KEY;if(!key)throw Error('Hub support.customer key required');const response=await fetch(new URL('/api/v1/support/authority',base),{headers:{'X-Ops-Key':key,'X-Ops-Tenant':businessId},redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Live authority unavailable');const authority=await response.json();if(authority.businessId!==businessId||authority.state!=='central_frozen'||!authority.acceptanceClosed)throw Error('Sealed central freeze required');return authority;}
async function main(argv=process.argv.slice(2)){
 const flags=new Map();for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))throw Error('Named options required');flags.set(argv[i],argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:'true');}
 const get=k=>{const v=flags.get(k);if(!v||v==='true')throw Error(k+' required');return v;};const modes=['--backup','--apply','--verify'].filter(k=>flags.has(k));if(modes.length!==1)throw Error('Choose --backup, --apply or --verify');
 const business=get('--business');await frozen(business);const connection=await connect();try{
 if(flags.has('--backup'))return await sdk.createSupportRestoreBackup(connection.db,business);
 if(flags.has('--verify')){const proof=await sdk.verifyRestoredSupportSource(connection.db,business,get('--restore-id'));return {restoreId:proof.restoreId,checksum:proof.checksum,targetHash:proof.targetHash,pendingCount:proof.pending.length,writer:proof.writer,sender:proof.sender};}
 const artifact=await privateJson(get('--manifest'));if(artifact.businessId!==business)throw Error('Business mismatch');const proof=await sdk.applySupportReverseDelta(connection.db,artifact,get('--backup-id'),()=>frozen(business));return {restoreId:proof.restoreId,checksum:proof.checksum,targetHash:proof.targetHash,pendingCount:proof.pending.length,writer:proof.writer,sender:proof.sender};
 }finally{await connection.close();}
}
module.exports={main,connect,frozen};if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
