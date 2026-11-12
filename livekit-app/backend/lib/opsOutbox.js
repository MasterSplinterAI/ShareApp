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
async function queueContact(tx, userId) {
  const user = await tx.get(`SELECT id,email,display_name FROM v2_users WHERE id=?${db.isPostgres() ? ' FOR UPDATE' : ''}`, [userId]);
  if (!user) throw Error('Persisted contact required');
  const revision = await nextSourceRevision(tx, `contact:${user.id}`);
  const memberships = await tx.all('SELECT m.org_id,m.role,s.plan_id,s.status FROM v2_org_members m LEFT JOIN v2_org_subscriptions s ON s.org_id=m.org_id WHERE m.user_id=? ORDER BY m.org_id', [user.id]);
  await enqueueBusinessEvent(tx, {
    schemaVersion: 1,
    businessId: businessId(),
    environment: 'live',
    type: 'contact.changed',
    eventId: `contact:${user.id}:${revision}`,
    sourceRevision: revision,
    occurredAt: new Date().toISOString(),
    payload: {
      sourceId: user.id,
      email: user.email,
      name: user.display_name,
      memberships
    }
  });
}
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
  ensureOpsOutboxSchema,
  queueCostEvent,
  queueContact,
  queueConsent,
  queueStripeEvent,
  createOpsOutboxWorker,
  acceptVerifiedStripeEvent,
  createStripeReceiptWorker,
  startOpsEventWorkers,
  opsEventDiagnostics
};
