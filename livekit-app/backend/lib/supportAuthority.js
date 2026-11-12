const {AsyncLocalStorage}=require('node:async_hooks');
const {timingSafeEqual}=require('node:crypto');
const {createSupportAuthorityClient,createLegacySupportFence,createSupportInstallationStore,supportWorkspaceHandoff}=require('@rhule/ops-sdk');
const db=require('../db/v2Database');
const acceptance=require('./supportRecoveryDatabase').getSupportAcceptanceStore();
const {getSupportBusinessId,LEGACY_SUPPORT_TENANT}=require('./supportIdentity');
const config=()=>{const cfg=require('./opsHubClient').getOpsHubConfig();return {...cfg,tenantSlug:getSupportBusinessId(),businessId:getSupportBusinessId(),mode:cfg.supportMode};};
const installation=createSupportInstallationStore(acceptance.database,LEGACY_SUPPORT_TENANT);
async function ensureSupportAuthoritySchema(){await installation.read(getSupportBusinessId());}
function createHostSupportAuthority(){const businessId=getSupportBusinessId();return createSupportAuthorityClient({businessId,acceptance,getConfig:config,readLatch:()=>installation.read(businessId),writeLatch:(revision,details)=>installation.write(businessId,revision,details)});}
const hostSupportAuthority=createHostSupportAuthority();
const legacySupportFence=createLegacySupportFence({context:new AsyncLocalStorage(),acquire:hostSupportAuthority.acquire,release:hostSupportAuthority.release});
function fenceSupportAdapter(adapter){return new Proxy(adapter,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);return typeof value==='function'&&/^(send|notify|createIssue|complete|editProposalMessage|answerCallback)/.test(String(key))?(...args)=>legacySupportFence.effect(()=>Reflect.apply(value,target,args)):value;}});}
async function supportAuthorityHttp(req,res){
 const pathname=String(req.url).split('?')[0],businessId=getSupportBusinessId();
 if(pathname==='/authority-state'&&req.method==='GET'){try{const state=await hostSupportAuthority.read();res.json({state:state.state,central:!['unmanaged','legacy'].includes(state.state),url:supportWorkspaceHandoff('https://ops.lalia.cloud',businessId,String(req.url).split('?')[1]??'')});}catch{res.status(503).json({central:true,state:'unavailable'});}return true;}
 if(['/authority/customer','/authority/restore-evidence','/authority/seal-acceptance'].includes(pathname)&&req.method==='POST'){
  const cfg=config(),given=Buffer.from(String(req.headers['x-ops-key']||'')),expected=Buffer.from(cfg.secretKey||'');
  if(!expected.length||given.length!==expected.length||!timingSafeEqual(given,expected)||req.body?.businessId!==businessId){res.status(403).json({error:'Forbidden'});return true;}
  await installation.read(businessId);
  if(pathname==='/authority/seal-acceptance'){res.json(await hostSupportAuthority.sealAcceptance(String(req.body.freezeId)));return true;}
  if(pathname==='/authority/restore-evidence'){const state=await hostSupportAuthority.read();if(state.state!=='central_frozen'||!state.acceptanceClosed){res.status(409).json({error:'Source must remain frozen'});return true;}const {getSupportRecoveryDatabase}=require('./supportRecoveryDatabase');res.json(await require('@rhule/ops-sdk').verifyRestoredSupportSource(getSupportRecoveryDatabase(),businessId,String(req.body.restoreId)));return true;}
  const user=await db.get('SELECT id,disabled_at FROM v2_users WHERE id=?',[String(req.body.actorId)]);const member=req.body.orgId?await db.get('SELECT org_id FROM v2_org_members WHERE user_id=? AND org_id=?',[String(req.body.actorId),String(req.body.orgId)]):true;res.json({active:Boolean(user&&!user.disabled_at&&member)});return true;
 }
 return false;
}
module.exports={createHostSupportAuthority,hostSupportAuthority,legacySupportFence,fenceSupportAdapter,supportAuthorityHttp,ensureSupportAuthoritySchema};
