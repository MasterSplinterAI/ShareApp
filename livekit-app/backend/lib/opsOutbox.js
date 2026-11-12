const db = require('../db/v2Database');
const {
  BUSINESS_OUTBOX_SCHEMA,
  enqueueBusinessEvent,
  nextSourceRevision,
  createBusinessEventWorker,
  createVerifiedStripeWorker,
  persistVerifiedStripeReceipt,
  stripeBusinessEvent,
  usdToMicros
} = require('@rhule/ops-sdk');
const businessId = () => String(process.env.OPS_HUB_BUSINESS_ID || 'lalia');
async function ensureOpsOutboxSchema() {
  await db.run('CREATE TABLE IF NOT EXISTS ops_customer_source(source_id TEXT PRIMARY KEY,revision TEXT NOT NULL,sequence BIGINT NOT NULL,deleted INTEGER NOT NULL,payload TEXT NOT NULL)');
  for (const statement of BUSINESS_OUTBOX_SCHEMA) await db.run(statement);
}
async function queueCostEvent(tx, row) {
  if (!row.id || !Number.isSafeInteger(Number(row.id))) throw Error('Persisted cost row identity required');
  const sourceId = `lalia_cost_row_${row.id}`,
    revision = await nextSourceRevision(tx, sourceId);
  await enqueueBusinessEvent(tx, {
    schemaVersion: 1,
    businessId: businessId(),
    environment: 'live',
    type: 'usage.accrued',
    eventId: `${sourceId}:${revision}`,
    sourceRevision: revision,
    occurredAt: new Date(row.ts).toISOString(),
    payload: {
      sourceId,
      costMicros: usdToMicros(row.total_cost_usd),
      originalCost: String(row.total_cost_usd),
      costSource: 'estimated',
      provider: row.provider,
      currency: 'USD',
      category: /llm|translate/i.test(row.event_type) ? 'ai_inference' : 'media_stt',
      boundary: 'per_row',
      aliases: [`lalia_cost_${row.meeting_id}_${row.id}`],
      sourceSystem: 'lalia_meeting_cost_events',
      sourceRowId: String(row.id),
      ...(process.env.OPS_USAGE_BOUNDARY_ID ? {
        sourceBoundaryId: process.env.OPS_USAGE_BOUNDARY_ID
      } : {})
    }
  });
}
/** Acquire before any customer source row or per-source revision lock. Reports
 * use this same fence. Only customer mutations opt in; unrelated transactions
 * never acquire it. Call customerMutation at the outer source mutation boundary. */
async function lockCustomerDataset(tx) {
  return tx.get("INSERT INTO ops_source_revisions(source_id,revision) VALUES('customer-dataset',0) ON CONFLICT(source_id) DO UPDATE SET revision=ops_source_revisions.revision RETURNING revision");
}
async function customerMutation(work) {
  return db.transaction(async tx => {
    await lockCustomerDataset(tx);
    return work(tx);
  });
}
async function queueContact(tx,userId) {
 await lockCustomerDataset(tx);
 const user=await tx.get(`SELECT id,email,display_name,disabled_at FROM v2_users WHERE id=?${db.isPostgres()?' FOR UPDATE':''}`,[userId]);if(!user)throw Error('Persisted contact required');
 const memberships=await tx.all("SELECT m.org_id,o.name,m.role,s.plan_id,s.status,CASE WHEN o.suspended_at IS NOT NULL THEN 'suspended' ELSE o.billing_status END AS account_status FROM v2_org_members m JOIN v2_organizations o ON o.id=m.org_id LEFT JOIN v2_org_subscriptions s ON s.org_id=m.org_id WHERE m.user_id=? ORDER BY m.org_id",[user.id]);
 return queueCustomerPayload(tx,{sourceId:user.id,email:user.email,name:user.display_name,accountStatus:user.disabled_at?'disabled':'active',memberships});
}
async function queueCustomerPayload(tx,payload){
 await lockCustomerDataset(tx);
 const revision=await nextSourceRevision(tx,`contact:${payload.sourceId}`),sequence=await nextSourceRevision(tx,'customer-dataset');
 const previous=await tx.get('SELECT deleted FROM ops_customer_source WHERE source_id=?',[payload.sourceId]);
 if(Number(previous?.deleted)===1&&!payload.deleted)throw Error('Deleted customer cannot be recreated by snapshot');
 await tx.run('INSERT INTO ops_customer_source(source_id,revision,sequence,deleted,payload) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,sequence=excluded.sequence,deleted=excluded.deleted,payload=excluded.payload',[payload.sourceId,revision,sequence,payload.deleted?1:0,JSON.stringify(payload)]);
 await enqueueBusinessEvent(tx,{schemaVersion:1,businessId:businessId(),environment:'live',type:'contact.changed',eventId:`contact:${payload.sourceId}:${revision}`,sourceRevision:revision,occurredAt:new Date().toISOString(),payload});
}
async function queueOrgContacts(tx,orgId){await lockCustomerDataset(tx);for(const row of await tx.all('SELECT user_id FROM v2_org_members WHERE org_id=? ORDER BY user_id',[orgId]))await queueContact(tx,row.user_id);}
async function queueContactTombstone(tx,id){return queueCustomerPayload(tx,{sourceId:id,deleted:true});}
async function queueStripeEvent(tx, event) {
  const normalized = stripeBusinessEvent(businessId(), event);
  if (normalized) await enqueueBusinessEvent(tx, normalized);
}
async function queueConsent(tx, record) {
  const revision = await nextSourceRevision(tx, `consent:${record.userId}:${record.consentType}`);
  await enqueueBusinessEvent(tx, {
    schemaVersion: 1,
    businessId: businessId(),
    environment: 'live',
    type: 'consent.changed',
    eventId: record.id,
    sourceRevision: revision,
    occurredAt: record.occurredAt,
    payload: {
      sourceId: record.userId,
      consentType: record.consentType,
      granted: record.granted,
      policyVersion: record.policyVersion
    }
  });
}
function createOpsOutboxWorker(options = {}) {
  return createBusinessEventWorker({
    db,
    now: options.now,
    deliver: options.deliver || async function (event) {
      const {
        getOpsHubConfig
      } = require('./opsHubClient');
      const cfg = getOpsHubConfig();
      if (!cfg.baseUrl || !cfg.secretKey) throw Error('OpsHub configuration unavailable; pending delivery');
      const response = await fetch(`${cfg.baseUrl}/api/v1/ingest/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ops-Key': cfg.secretKey,
          'X-Ops-Tenant': event.businessId
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10000),
        redirect: 'error'
      });
      if (!response.ok) throw Error(`OpsHub event delivery HTTP ${response.status}`);
      return response.json();
    }
  });
}
async function acceptVerifiedStripeEvent(event) {
  await persistVerifiedStripeReceipt(db, event);
}
function createStripeReceiptWorker(process) {
  return createVerifiedStripeWorker({
    db,
    process: async event => {
      await process(event);
      await db.transaction(tx => queueStripeEvent(tx, event));
    }
  });
}
async function startOpsEventWorkers(process) {
  await ensureOpsOutboxSchema();
  const stops = [createOpsOutboxWorker().start(), createStripeReceiptWorker(process).start()];
  return () => stops.forEach(stop => stop());
}
async function opsEventDiagnostics() {
  return {
    outbox: await db.all('SELECT status,COUNT(*) AS count FROM ops_business_outbox GROUP BY status'),
    stripeReceipts: await db.all('SELECT status,COUNT(*) AS count FROM ops_verified_stripe_receipts GROUP BY status'),
    receiptAttention: await db.all("SELECT id,status,attempts,last_error FROM ops_verified_stripe_receipts WHERE status<>'delivered' ORDER BY id LIMIT 50"),
    attention: await db.all("SELECT event_id,status,attempts,last_error,result FROM ops_business_outbox WHERE status<>'delivered' OR result LIKE '%needs_reconciliation%' OR result LIKE '%deferred%' ORDER BY event_id LIMIT 50"),
    sourceBoundaryId: process.env.OPS_USAGE_BOUNDARY_ID || null,
    centralSupportInferenceCoverage: 'unavailable'
  };
}
module.exports = {
  customerMutation,
  lockCustomerDataset,
  ensureOpsOutboxSchema,
  queueCostEvent,
  queueContact,
  queueContactTombstone,
  queueOrgContacts,
  queueConsent,
  queueStripeEvent,
  createOpsOutboxWorker,
  acceptVerifiedStripeEvent,
  createStripeReceiptWorker,
  startOpsEventWorkers,
  opsEventDiagnostics
};
