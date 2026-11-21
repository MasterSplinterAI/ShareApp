// Invoked only by the guarded OpsHub cross-host integration test. No campaign handler/provider.
require('./supportIsolation').prepareSupportTest();
Object.assign(process.env,{OPS_HUB_BUSINESS_ID:'lalia',CONSENT_OPSHUB_KEY:'isolated-cross-host-consent',CONSENT_OPSHUB_URL:'http://127.0.0.1:5395/api/v1/consent/eligibility',CONSENT_OPSHUB_REGISTRY_URL:'http://127.0.0.1:5395/api/v1/consent/authorities',CONSENT_OPSHUB_REPORT_URL:'http://127.0.0.1:5395/api/v1/consent/report',MARKETING_KIT_ENABLED:'false'});
const db=require('../db/v2Database');
(async()=>{
 await db.initDatabase();await require('../lib/opsOutbox').ensureOpsOutboxSchema();
 const {consentDatabase,initializeConsent,consentEligibilityHandler,consentReporter}=require('../lib/consent');
 await require('@quill/support-core').ensureSchema(consentDatabase);await require('@rhule/marketing-core').ensureMarketingSchema(consentDatabase);await initializeConsent();
 const app=require('express')();app.use(require('express').json());app.use('/auth',require('../routes/v2/auth'));app.post('/api/consent/eligibility',consentEligibilityHandler);
 const server=app.listen(5396,'127.0.0.1',()=>process.send?.({ready:true}));
 process.on('message',async message=>{if(message==='report'){try{await consentReporter.runOnce();process.send?.({report:'unexpected-success'});}catch{process.send?.({report:'blocked'});}}});
 process.on('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));
})().catch(error=>{process.send?.({error:String(error)});process.exit(1);});
