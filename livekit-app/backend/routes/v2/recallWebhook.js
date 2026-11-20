'use strict';

const db = require('../../db/v2Database');
const {
  getNotetakerSettings,
  verifyRequestFromRecall,
  processVerifiedRecallWebhookEvent,
} = require('../../lib/recallNotetaker');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');

const pendingWebhookJobs = new Set();

function extractEventResourceId(event) {
  const data = event?.data || {};
  return (
    data?.bot?.id ||
    data?.bot_id ||
    data?.recording?.id ||
    data?.transcript?.id ||
    data?.calendar_id ||
    null
  );
}

async function handleRecallWebhook(req, res) {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Expected raw body' });
  }

  let settings;
  try {
    settings = await getNotetakerSettings();
  } catch (err) {
    console.error('[recall/webhook] settings load failed:', err.message);
    settings = {
      recallWebhookSecret:
        process.env.RECALL_WEBHOOK_VERIFICATION_SECRET ||
        process.env.RECALL_WORKSPACE_VERIFICATION_SECRET ||
        process.env.RECALL_WEBHOOK_SECRET ||
        '',
    };
  }

  // Strictly verify every webhook from Recall before accepting, storing, or enqueueing.
  const check = verifyRequestFromRecall({
    secret: settings.recallWebhookSecret,
    headers: req.headers,
    rawBody,
  });
  if (!check.ok) {
    console.warn(`[recall/webhook] unverified request rejected reason=${check.reason}`);
    return res.status(401).json({ error: 'Request not verified' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = String(event?.event || 'unknown').slice(0, 100);
  const resourceId = extractEventResourceId(event);
  const nowIso = new Date().toISOString();

  // Record idempotency before enqueueing side effects.
  try {
    const dedupe = await db.run(
      `INSERT INTO v2_recall_webhook_events (webhook_id, event_type, resource_id, status, received_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(webhook_id) DO NOTHING`,
      [check.webhookId, eventType, resourceId ? String(resourceId).slice(0, 128) : null, 'queued', nowIso]
    );
    if (!dedupe?.changes) {
      return res.json({ ok: true, duplicate: true });
    }
  } catch (err) {
    console.error(`[recall/webhook] idempotency write failed id=${check.webhookId}:`, err.message);
    return res.status(500).json({ error: 'Webhook persistence failed' });
  }

  console.log(`[recall/webhook] verified id=${check.webhookId} event=${eventType}`);

  const baseUrl = publicFrontendBaseUrl(req);
  const jobPromise = new Promise((resolve) => {
    setImmediate(async () => {
      try {
        await processVerifiedRecallWebhookEvent(event, { publicBaseUrl: baseUrl });
        await db
          .run(
            `UPDATE v2_recall_webhook_events SET status = 'processed', processed_at = ? WHERE webhook_id = ?`,
            [new Date().toISOString(), check.webhookId]
          )
          .catch(() => {});
      } catch (err) {
        console.error(`[recall/webhook] async processing error id=${check.webhookId}:`, err.message);
        await db
          .run(
            `UPDATE v2_recall_webhook_events SET status = 'failed', error_code = ?, processed_at = ? WHERE webhook_id = ?`,
            [String(err.message || 'error').slice(0, 120), new Date().toISOString(), check.webhookId]
          )
          .catch(() => {});
      } finally {
        resolve();
      }
    });
  }).finally(() => {
    pendingWebhookJobs.delete(jobPromise);
  });

  pendingWebhookJobs.add(jobPromise);
  return res.status(200).json({ ok: true, queued: true });
}

async function drainPendingRecallWebhookJobs() {
  while (pendingWebhookJobs.size > 0) {
    await Promise.allSettled([...pendingWebhookJobs]);
  }
}

module.exports = { handleRecallWebhook, drainPendingRecallWebhookJobs };
