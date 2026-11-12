const businessId=()=>String(process.env.OPS_HUB_BUSINESS_ID||'lalia');
const db = require('../db/v2Database');
const {createHostConsent,discoverConsentRegistry} = require('@rhule/marketing-core');
const bind = tx => ({run:async(s,p=[])=>({changes:(await tx.run(s,p)).changes||0}),get:(s,p=[])=>tx.get(s,p),all:(s,p=[])=>tx.all(s,p)});
const consentDatabase={...bind(db),transaction:work=>db.transaction(tx=>work(bind(tx))),snapshot:work=>db.transaction(async tx=>{if(db.isPostgres())await tx.run('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return work(bind(tx));})};
const consentRuntime=createHostConsent({db:consentDatabase,authorityId:'lalia',localTenantId:'lalia',businessId,resolveKey:reference=>process.env[reference],registry:businessId=>discoverConsentRegistry({businessId,authorityId:'lalia',endpoint:process.env.CONSENT_OPSHUB_REGISTRY_URL||'https://ops.lalia.cloud/api/v1/consent/authorities',key:process.env.CONSENT_OPSHUB_KEY||'',centralEligibilityEndpoint:process.env.CONSENT_OPSHUB_URL||'https://ops.lalia.cloud/api/v1/consent/eligibility'}),peers:()=>[{businessId:businessId(),authorityId:'opshub',key:process.env.CONSENT_OPSHUB_KEY||''}],additionalFacts:async(scope,tx)=>{
 const grants=[],suppressions=[];
 if(scope.channel!=='email'||scope.purpose!=='marketing')return {grants,suppressions};
 const rows=await tx.all("SELECT c.id,c.user_id,c.granted,c.policy_version,c.created_at,o.envelope FROM v2_consent_events c JOIN v2_users u ON u.id=c.user_id LEFT JOIN ops_business_outbox o ON o.event_id=c.id AND o.event_type='consent.changed' WHERE lower(u.email)=? AND c.consent_type='marketing_email'",[scope.recipient]);
 for(const row of rows){
  const envelope=row.envelope?JSON.parse(row.envelope):null;
  const id=`lalia:account:${row.id}`,revision=envelope?.sourceRevision||String(row.created_at);
  if(!Number(row.granted))suppressions.push({id,sourceRevision:revision});
  // Historical choice records retain evidence but never gain a newly observed vector automatically.
  // Fresh eligible account grants are written to the shared ledger by communicationPrefs.
 }
 return {grants,suppressions};
}});
async function initializeConsent(){await consentRuntime.initialize([
 {businessId:businessId(),id:'lalia',endpoint:'local',keyRef:'local'},
 {businessId:businessId(),id:'opshub',endpoint:process.env.CONSENT_OPSHUB_URL||'https://ops.lalia.cloud/api/v1/consent/eligibility',keyRef:'CONSENT_OPSHUB_KEY'},
]);}
module.exports={consentDatabase,consentRuntime,initializeConsent};
const consentReporter=require('@rhule/marketing-core').createConsentReporter({store:consentRuntime.store,businessId,localTenantId:'lalia',deliver:async event=>{
 const key=process.env.CONSENT_OPSHUB_KEY;if(!key)throw Error('Consent reporting configuration unavailable');
 const response=await fetch(process.env.CONSENT_OPSHUB_REPORT_URL||'https://ops.lalia.cloud/api/v1/consent/report',{method:'POST',headers:{'Content-Type':'application/json','X-Consent-Key':key,'X-Consent-Authority':'lalia'},body:JSON.stringify(event),signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok)throw Error('Consent reporting unavailable');return response.json();
}});
module.exports.consentReporter=consentReporter;

/** Independent of campaign scheduling/authority. This only reads local source state. */
async function consentEligibilityHandler(req,res){
 try{
  const scope=req.body||{};
  if(!await consentRuntime.policy.authenticate(String(scope.businessId||''),String(req.headers['x-consent-authority']||''),String(req.headers['x-consent-key']||'')))return res.status(403).json({error:'Consent peer access denied'});
  return res.json(await consentRuntime.policy.localFacts({businessId:String(scope.businessId||''),recipient:String(scope.recipient||''),channel:String(scope.channel||''),purpose:String(scope.purpose||'')}));
 }catch{return res.status(503).json({error:'Local consent coverage unavailable'});}
}
module.exports.consentEligibilityHandler=consentEligibilityHandler;
