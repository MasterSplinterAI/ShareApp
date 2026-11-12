const {AsyncLocalStorage}=require('node:async_hooks');
const {timingSafeEqual}=require('node:crypto');
const {createSupportAuthorityClient,createLegacySupportFence}=require('@rhule/ops-sdk');
const db=require('../db/v2Database');
const acceptance=require('./supportRecoveryDatabase').getSupportAcceptanceStore();
const config=()=>{const cfg=require('./opsHubClient').getOpsHubConfig();return {...cfg,tenantSlug:'lalia',mode:cfg.supportMode};};
const schema='CREATE TABLE IF NOT EXISTS ops_support_host_fence (business_id TEXT PRIMARY KEY, revision BIGINT NOT NULL, authority_origin TEXT NOT NULL, legacy_disabled INTEGER NOT NULL DEFAULT 0)';
async function ensureSupportAuthoritySchema(){await acceptance.sql.run(schema);}
function createHostSupportAuthority(){return createSupportAuthorityClient({businessId:'lalia',acceptance,getConfig:config,
 readLatch:async()=>{await ensureSupportAuthoritySchema();const row=await acceptance.sql.get("SELECT revision,authority_origin,legacy_disabled FROM ops_support_host_fence WHERE business_id='lalia'");return row?{revision:Number(row.revision),origin:row.authority_origin,legacyDisabled:Number(row.legacy_disabled)===1}:null;},
 writeLatch:async(revision,details)=>{await acceptance.sql.run("INSERT INTO ops_support_host_fence(business_id,revision,authority_origin,legacy_disabled) VALUES('lalia',?,?,?) ON CONFLICT(business_id) DO UPDATE SET revision=CASE WHEN ops_support_host_fence.revision>excluded.revision THEN ops_support_host_fence.revision ELSE excluded.revision END,legacy_disabled=CASE WHEN ops_support_host_fence.legacy_disabled>excluded.legacy_disabled THEN ops_support_host_fence.legacy_disabled ELSE excluded.legacy_disabled END",[revision,details.origin,details.legacyDisabled?1:0]);},
});}
const hostSupportAuthority=createHostSupportAuthority();
const legacySupportFence=createLegacySupportFence({context:new AsyncLocalStorage(),acquire:hostSupportAuthority.acquire,release:hostSupportAuthority.release});
function fenceSupportAdapter(adapter){return new Proxy(adapter,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);return typeof value==='function'&&/^(send|notify|createIssue|complete|editProposalMessage|answerCallback)/.test(String(key))?(...args)=>legacySupportFence.effect(()=>Reflect.apply(value,target,args)):value;}});}
async function supportAuthorityHttp(req,res){
 const pathname=String(req.url).split('?')[0];
 if(pathname==='/authority-state'&&req.method==='GET'){try{const state=await hostSupportAuthority.read();res.json({state:state.state,central:!['unmanaged','legacy'].includes(state.state),url:'https://ops.lalia.cloud/support?business=lalia'});}catch{res.status(503).json({central:true,state:'unavailable',url:'https://ops.lalia.cloud/support?business=lalia'});}return true;}
 if(['/authority/customer','/authority/restore-evidence','/authority/seal-acceptance'].includes(pathname)&&req.method==='POST'){
  const cfg=config(),given=Buffer.from(String(req.headers['x-ops-key']||'')),expected=Buffer.from(cfg.secretKey||'');
  if(!expected.length||given.length!==expected.length||!timingSafeEqual(given,expected)||req.body?.businessId!=='lalia'){res.status(403).json({error:'Forbidden'});return true;}
  if(pathname==='/authority/seal-acceptance'){res.json(await hostSupportAuthority.sealAcceptance(String(req.body.freezeId)));return true;}
  if(pathname==='/authority/restore-evidence'){const state=await hostSupportAuthority.read();if(state.state!=='central_frozen'||!state.acceptanceClosed){res.status(409).json({error:'Source must remain frozen'});return true;}const {getSupportRecoveryDatabase}=require('./supportRecoveryDatabase');res.json(await require('@rhule/ops-sdk').verifyRestoredSupportSource(getSupportRecoveryDatabase(),'lalia',String(req.body.restoreId)));return true;}
  const user=await db.get('SELECT id,disabled_at FROM v2_users WHERE id=?',[String(req.body.actorId)]);const member=req.body.orgId?await db.get('SELECT org_id FROM v2_org_members WHERE user_id=? AND org_id=?',[String(req.body.actorId),String(req.body.orgId)]):true;res.json({active:Boolean(user&&!user.disabled_at&&member)});return true;
 }
 return false;
}
module.exports={createHostSupportAuthority,hostSupportAuthority,legacySupportFence,fenceSupportAdapter,supportAuthorityHttp,ensureSupportAuthoritySchema};
