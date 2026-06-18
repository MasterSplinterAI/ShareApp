const crypto = require('crypto');
const db = require('../../db/v2Database');
const { getStripeSettings } = require('../../lib/v2StripeSettings');

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

function unixToIso(sec) {
  if (sec == null) return null;
  const n = Number(sec);
  if (!Number.isFinite(n)) return null;
  return new Date(Math.floor(n * 1000)).toISOString();
}

async function upsertSubscriptionFromStripe(stripeSub) {
  const stripeSubId = stripeSub.id;
  const customerId =
    typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id || null;
  let orgId = stripeSub.metadata && stripeSub.metadata.org_id ? String(stripeSub.metadata.org_id) : null;
  const planIdMeta =
    stripeSub.metadata && stripeSub.metadata.plan_id ? String(stripeSub.metadata.plan_id) : null;
  const bySub = await db.get(`SELECT org_id, is_comp FROM v2_org_subscriptions WHERE stripe_subscription_id = ?`, [
    stripeSubId,
  ]);
  if (bySub) orgId = bySub.org_id;
  if (!orgId) {
    console.warn('[v2/billing/webhook] subscription event with no org mapping', stripeSubId);
    return;
  }
  const exists = await db.get(`SELECT org_id, is_comp FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
  if (!exists) return;

  if (exists.is_comp === 1 && ['canceled', 'unpaid', 'past_due'].includes(String(stripeSub.status || ''))) {
    console.log('[v2/billing/webhook] skipping status downgrade for comp org', orgId);
    return;
  }

  const status = String(stripeSub.status || 'active').slice(0, 32);
  const cps = unixToIso(stripeSub.current_period_start);
  const cpe = unixToIso(stripeSub.current_period_end);
  const planId = planIdMeta || null;
  if (planId) {
    await db.run(
      `UPDATE v2_org_subscriptions SET
         stripe_subscription_id = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         status = ?,
         plan_id = ?,
         current_period_start = COALESCE(?, current_period_start),
         current_period_end = COALESCE(?, current_period_end)
       WHERE org_id = ?`,
      [stripeSubId, customerId, status, planId, cps, cpe, orgId]
    );
  } else {
    await db.run(
      `UPDATE v2_org_subscriptions SET
         stripe_subscription_id = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         status = ?,
         current_period_start = COALESCE(?, current_period_start),
         current_period_end = COALESCE(?, current_period_end)
       WHERE org_id = ?`,
      [stripeSubId, customerId, status, cps, cpe, orgId]
    );
  }
}

async function processStripeEvent(event) {
  const type = event.type;
  const obj = event.data && event.data.object;
  if (!obj) return;

  if (type === 'checkout.session.completed') {
    const orgId = obj.metadata && obj.metadata.org_id ? String(obj.metadata.org_id) : null;
    const planId = obj.metadata && obj.metadata.plan_id ? String(obj.metadata.plan_id) : null;
    const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription && obj.subscription.id;
    const custId = typeof obj.customer === 'string' ? obj.customer : obj.customer && obj.customer.id;
    if (orgId && custId) {
      const row = await db.get(`SELECT is_comp FROM v2_org_subscriptions WHERE org_id = ?`, [orgId]);
      if (row?.is_comp === 1) {
        console.log('[v2/billing/webhook] checkout completed for comp org — plan unchanged', orgId);
        return;
      }
      if (planId) {
        await db.run(
          `UPDATE v2_org_subscriptions SET
             stripe_customer_id = COALESCE(?, stripe_customer_id),
             stripe_subscription_id = COALESCE(?, stripe_subscription_id),
             plan_id = ?,
             status = 'active'
           WHERE org_id = ?`,
          [custId, subId || null, planId, orgId]
        );
      } else {
        await db.run(
          `UPDATE v2_org_subscriptions SET
             stripe_customer_id = COALESCE(?, stripe_customer_id),
             stripe_subscription_id = COALESCE(?, stripe_subscription_id)
           WHERE org_id = ?`,
          [custId, subId || null, orgId]
        );
      }
    }
    return;
  }

  if (type.startsWith('customer.subscription.')) {
    await upsertSubscriptionFromStripe(obj);
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
