'use strict';

const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {exportSupportHistory,supportPayloadHash,supportIntentEvidence,supportBusinessId}=require('@rhule/ops-sdk');
const KIT={tickets:'support_tickets',messages:'support_messages',proposals:'support_proposals',gaps:'support_knowledge_gaps',kb:'support_kb_articles',revisions:'support_kb_revisions',leads:'support_leads'};
async function docsSnapshot(root){const rows=[];async function walk(dir){for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Symlink source document refused');if(entry.isDirectory())await walk(file);else if(entry.name.endsWith('.md')){const id=path.relative(root,file).split(path.sep).join('/');rows.push({id,title:id,body:await fs.readFile(file,'utf8'),source_kind:'docs',source_key:id,status:'draft',created_at:'1970-01-01T00:00:00.000Z',updated_at:'1970-01-01T00:00:00.000Z'});}}}await walk(root);return rows.sort((a,b)=>a.id<b.id?-1:1);}
async function exportHistory(db,options){
 const {businessId,generation,freezeId,docsRoot}=options;const sourceTenantId=options.sourceTenantId??businessId;
 if(freezeId&&!options.verifyFreeze)throw Error('Live frozen authority verification required');
 await options.verifyFreeze?.();await db.begin();
 try{
  const revision=await db.revision();const sources=[];const tables=await db.tables();for(const bindingTable of ['ops_support_host_fence','ops_support_host_identity'])if(tables.includes(bindingTable)&&(await db.identities(bindingTable)).some(row=>row.business_id!==businessId))throw Error('Known installation business identity cannot be changed');
  for(const [source,catalog] of Object.entries(options.catalogs)){
   const selected={};for(const [entity,table] of Object.entries(catalog)){if(tables.includes(table))selected[entity]=table;else if(!['revisions','kb','leads'].includes(entity))throw Error('Required history table missing: '+table);}
   sources.push(await exportSupportHistory({businessId,source,sourceTenantId,generation,freezeId,revision,tables:selected,readPage:async(table,after,limit)=>(await db.page(table,after,limit)).map(row=>{if(row.tenant_id&&![sourceTenantId,businessId].includes(row.tenant_id))throw Error('Foreign source tenant');return {...row,...(row.tenant_id?{tenant_id:businessId}:{})};}),checkpoint:options.checkpoint}));
  }
  let docs;if(docsRoot){docs=await docsSnapshot(docsRoot);sources.push(await exportSupportHistory({businessId,source:'docs',generation,freezeId,revision:await supportPayloadHash(docs),tables:{kb:'documents'},readPage:async(_,after,limit)=>docs.filter(r=>r.id>after).slice(0,limit)}));}
  const pending=[];if(tables.includes('ops_support_pending')){let cursor='';for(;;){const page=await db.pending(cursor,250);if(!page.length)break;for(const row of page){const intent=JSON.parse(row.record_json);if(intent.businessId!==businessId)throw Error('Cross-business pending receipt');pending.push(supportIntentEvidence(intent));cursor=row.receipt_id;}}}
  if(docsRoot&&await supportPayloadHash(docs)!==await supportPayloadHash(await docsSnapshot(docsRoot)))throw Error('Documents changed during export');
  await options.verifyFreeze?.();await db.commit();
  const artifact={version:1,businessId,generation,freezeId:freezeId??null,revision,sources,pending,pendingChecksum:await supportPayloadHash(pending)};
  return {...artifact,checksum:await supportPayloadHash(artifact)};
 }catch(error){await db.rollback();throw error;}
}
async function privateWrite(file,value){if(!path.isAbsolute(file))throw Error('Absolute private output path required');let dir=path.dirname(file);for(;;){if((await fs.lstat(dir)).isSymbolicLink()||await fs.stat(path.join(dir,'.git')).catch(()=>null))throw Error('Artifact directory must be outside git without symlinks');const next=path.dirname(dir);if(next===dir)break;dir=next;}const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}}
async function main(){
 const argv=process.argv.slice(2),arg=name=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];};
 const businessId=supportBusinessId(process.env.OPS_HUB_BUSINESS_ID,BUSINESS);
 const generation=arg('--generation'),freezeId=arg('--freeze-id'),output=arg('--output');if(!generation||!output&&!argv.includes('--stdout'))throw Error('Use --generation N --output /secure/history.json (or --stdout for direct server SSH transport)');
 const connection=await connectExportDatabase();
 try{
  const verifyFreeze=freezeId?async()=>{const origin=process.env.SUPPORT_EXPORT_AUTHORITY_URL,key=process.env.SUPPORT_EXPORT_AUTHORITY_KEY;if(!origin||!key)throw Error('Authenticated hub authority transport required for final snapshot');const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('HTTPS authority origin required');const response=await fetch(url.origin+'/api/v1/support/authority',{headers:{'X-Ops-Key':key,'X-Ops-Tenant':businessId},redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Frozen authority unavailable');const row=await response.json();if(row.businessId!==businessId||row.generation!==generation||row.state!=='frozen'||row.freezeId!==freezeId||row.acceptanceClosed!==true)throw Error('Matching sealed authority required');}:undefined;
  const artifact=await exportHistory(connection,{businessId,sourceTenantId:BUSINESS,generation,freezeId,docsRoot:arg('--docs')??DEFAULT_DOCS,catalogs:CATALOGS,verifyFreeze});
  if(output){await privateWrite(output,artifact);for(const source of artifact.sources)await privateWrite(path.join(path.dirname(output),source.source+'-'+source.checksum+'.json'),source);console.log(JSON.stringify({checksum:artifact.checksum,sources:artifact.sources.map(s=>({source:s.source,checksum:s.checksum,entities:s.entities})),pendingCount:artifact.pending.length}));}else process.stdout.write(JSON.stringify(artifact)+'\n');
 }finally{await connection.close();}
}
async function postgresConnection(url,schema){const {Client}=require('pg');const client=new Client({connectionString:url});await client.connect();if(schema){if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw Error('Invalid source schema');await client.query('SET search_path TO '+schema);}return {
 begin:()=>client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'),commit:()=>client.query('COMMIT'),rollback:()=>client.query('ROLLBACK'),close:()=>client.end(),
 revision:async()=>String((await client.query('SELECT txid_current_snapshot()::text AS revision')).rows[0].revision),
 tables:async()=>(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()")).rows.map(r=>r.table_name),
 page:async(table,after,limit)=>(await client.query(`SELECT * FROM ${table} WHERE id COLLATE "C">$1 COLLATE "C" ORDER BY id COLLATE "C" LIMIT $2`,[after,limit])).rows.map(row=>JSON.parse(JSON.stringify(row))),
 identities:async(table)=>(await client.query('SELECT business_id FROM '+table)).rows,
 pending:async(after,limit)=>(await client.query('SELECT receipt_id,record_json FROM ops_support_pending WHERE receipt_id>$1 ORDER BY receipt_id LIMIT $2',[after,limit])).rows,
 };}

const BUSINESS='lalia';const DEFAULT_DOCS=path.resolve(__dirname,'../docs/support');
const CATALOGS={kit:KIT,legacy_v2:{tickets:'v2_support_tickets',messages:'v2_support_messages',proposals:'v2_support_proposals',gaps:'v2_support_knowledge_gaps'}};
async function connectExportDatabase(){
 const url=process.env.SUPPORT_EXPORT_DATABASE_URL;if(url)return postgresConnection(url);
 const file=process.env.SUPPORT_EXPORT_SQLITE_PATH;if(!file||!path.isAbsolute(file))throw Error('Explicit SUPPORT_EXPORT_DATABASE_URL or absolute SUPPORT_EXPORT_SQLITE_PATH required');
 const sqlite=require('sqlite3');const db=await new Promise((resolve,reject)=>{const value=new sqlite.Database(file,sqlite.OPEN_READONLY,error=>error?reject(error):resolve(value));});
 const all=(sql,params=[])=>new Promise((resolve,reject)=>db.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
 return {begin:()=>all('BEGIN'),commit:()=>all('COMMIT'),rollback:()=>all('ROLLBACK'),close:()=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve())),revision:async()=>randomUUID(),tables:async()=>(await all("SELECT name FROM sqlite_master WHERE type='table'")).map(r=>r.name),page:(table,after,limit)=>all(`SELECT * FROM ${table} WHERE id COLLATE BINARY>? ORDER BY id COLLATE BINARY LIMIT ?`,[after,limit]),identities:table=>all('SELECT business_id FROM '+table),pending:(after,limit)=>all('SELECT receipt_id,record_json FROM ops_support_pending WHERE receipt_id>? ORDER BY receipt_id LIMIT ?',[after,limit])};
}
module.exports={exportHistory,docsSnapshot,KIT,CATALOGS,connectExportDatabase,postgresConnection};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
