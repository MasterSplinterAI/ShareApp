import type {ConsentEvent,ConsentStore} from './consent.js';
/** Source history remains owned by the intake host across support authority migrations.
 * Reporting reads immutable rows and writes only delivery receipts; it never clears suppression. */
export function createConsentReporter(options:{store:ConsentStore;businessId:()=>string;localTenantId?:string;deliver:(event:any)=>Promise<unknown>}){
 let running=false;
 async function runOnce(){
  if(running)return 0;running=true;let delivered=0;
  try{
   const businessId=options.businessId(),db=options.store.db;
   const deliver=async(id:string,event:ConsentEvent,occurredAt:string)=>{
    await options.deliver({schemaVersion:1,businessId,environment:'live',type:'consent.changed',eventId:id,sourceRevision:event.sourceRevision,occurredAt,payload:{sourceId:event.sourceId,consent:event}});
   };
   for(const row of await options.store.pendingReports()){
    const event=JSON.parse(row.payload) as ConsentEvent;
    if(event.scope.businessId!==businessId)continue;
    await deliver(row.id,event,event.occurredAt||row.accepted_at);
    await options.store.acknowledgeReport(row.id);delivered++;
   }
   const rows=await db.all<any>('SELECT e.* FROM support_lead_consent_events e LEFT JOIN mkt_consent_source_reports r ON r.source_id=e.id WHERE e.tenant_id=? AND r.source_id IS NULL ORDER BY e.revision,e.id LIMIT 100',[options.localTenantId||businessId]);
   for(const row of rows){
    const event:ConsentEvent={id:`support-lead:${row.id}`,sourceId:`support-lead:${row.lead_id}:${row.channel}`,sourceRevision:String(row.revision),scope:{businessId,recipient:row.email,channel:row.channel,purpose:row.purpose},granted:Boolean(Number(row.granted)),evidence:Number(row.granted)&&row.consent_text?{kind:'explicit_choice',text:row.consent_text,version:row.policy_version}:null,supersedes:[],occurredAt:row.occurred_at};
    // Unproven historical positives are not transformed into grants during reporting.
    if(event.granted&&!event.evidence){await db.run('INSERT INTO mkt_consent_source_reports(source_id,delivered_at) VALUES(?,?) ON CONFLICT(source_id) DO NOTHING',[row.id,new Date().toISOString()]);continue;}
    await deliver(`${options.store.authorityId}:${event.id}`,event,event.occurredAt!);
    await db.run('INSERT INTO mkt_consent_source_reports(source_id,delivered_at) VALUES(?,?) ON CONFLICT(source_id) DO NOTHING',[row.id,new Date().toISOString()]);delivered++;
   }
   return delivered;
  }finally{running=false;}
 }
 function start(intervalMs=15000){const timer=setInterval(()=>void runOnce().catch(()=>{}),intervalMs);timer.unref?.();return ()=>clearInterval(timer);}
 return {runOnce,start};
}
