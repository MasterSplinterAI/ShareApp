const crypto = require('crypto');
const db = require('../../db/v2Database');
const { getStripeSettings } = require('../../lib/v2StripeSettings');
const { applyStripeSubscriptionToOrg, applyCheckoutSessionToOrg } = require('../../lib/v2StripeSubscriptionSync');
const { applyStripeDisputeEvent } = require('../../lib/v2StripeDispute');

const MAX_PAYLOAD_CHARS = 500_000;

function verifyStripeSignature(rawBuffer, sigHeader, secret, maxSkewSec = 300) {
  if (!secret || !sigHeader || typeof sigHeader !== 'string') {
    return { ok: false, reason: 'missing_secret_or_sig' };
  }
  const parts = sigHeader.split(',').map((p) => p.trim());
  let t;
  const v1s = [];
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i);
    const v = p.slice(i + 1);
    if (k === 't') t = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || v1s.length === 0) return { ok: false, reason: 'malformed_sig' };
  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSec) return { ok: false, reason: 'timestamp_skew' };
  const signed = Buffer.concat([Buffer.from(`${t}.`, 'utf8'), rawBuffer]);
  const expectedHex = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const expBuf = Buffer.from(expectedHex, 'hex');
  for (const sig of v1s) {
    try {
      const sb = Buffer.from(sig, 'hex');
      if (sb.length === expBuf.length && crypto.timingSafeEqual(sb, expBuf)) return { ok: true };
    } catch {
      // ignore invalid hex
    }
  }
  return { ok: false, reason: 'sig_mismatch' };
}

async function processStripeEvent(event) {
  const type = event.type;
  const obj = event.data && event.data.object;
  if (!obj) return;

  if (type === 'checkout.session.completed') {
    await applyCheckoutSessionToOrg(obj);
    return;
  }

  if (type === 'customer.subscription.deleted') {
    await applyStripeSubscriptionToOrg({ ...obj, status: 'canceled' });
    return;
  }

  if (type.startsWith('customer.subscription.')) {
    await applyStripeSubscriptionToOrg(obj);
    return;
  }

  if (type.startsWith('charge.dispute.')) {
    const result = await applyStripeDisputeEvent(type, obj);
    console.info('[v2/billing/webhook] dispute', type, result);
  }
}

async function handleV2BillingWebhook(req, res) {
  try {
    const settings = await getStripeSettings();
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '', 'utf8');
    const sig = req.headers['stripe-signature'];
    const secret = settings.webhookSecret;
    if (secret) {
      const v = verifyStripeSignature(rawBody, sig, secret);
      if (!v.ok) {
        console.warn('[v2/billing/webhook] signature verification failed:', v.reason);
        return res.status(400).json({ error: 'Invalid signature' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[v2/billing/webhook] STRIPE_WEBHOOK_SECRET unset in production');
      return res.status(400).json({ error: 'Webhook secret not configured' });
    } else {
      console.warn('[v2/billing/webhook] STRIPE_WEBHOOK_SECRET unset — accepting unsigned webhook (development only)');
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventId = event.id;
    if (!eventId || typeof eventId !== 'string') {
      return res.status(400).json({ error: 'Missing event id' });
    }

    const existing = await db.get(`SELECT id, processed_at FROM v2_webhook_events WHERE id = ?`, [eventId]);
    if (existing && existing.processed_at) {
      return res.json({ received: true, duplicate: true });
    }

    const payloadStr = JSON.stringify(event);
    const truncated = payloadStr.length > MAX_PAYLOAD_CHARS ? payloadStr.slice(0, MAX_PAYLOAD_CHARS) : payloadStr;

    if (!existing) {
      try {
        await db.run(
          `INSERT INTO v2_webhook_events (id, provider, type, payload_json, received_at) VALUES (?,?,?,?, datetime('now'))`,
          [eventId, 'stripe', String(event.type || 'unknown').slice(0, 128), truncated]
        );
      } catch (e) {
        if (!String(e.message || '').includes('SQLITE_CONSTRAINT')) throw e;
      }
    }

    const again = await db.get(`SELECT processed_at FROM v2_webhook_events WHERE id = ?`, [eventId]);
    if (again && again.processed_at) {
      return res.json({ received: true, duplicate: true });
    }

    await processStripeEvent(event);

    await db.run(`UPDATE v2_webhook_events SET processed_at = datetime('now'), type = ? WHERE id = ?`, [
      String(event.type || 'unknown').slice(0, 128),
      eventId,
    ]);

    res.json({ received: true });
  } catch (e) {
    console.error('[v2/billing/webhook]', e.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

module.exports = { handleV2BillingWebhook };
