const crypto = require('crypto');
const db = require('../../db/v2Database');
const { getStripeSettings } = require('../../lib/v2StripeSettings');
const { reconcileStripeSubscriptionEvent, applyCheckoutSessionToOrg } = require('../../lib/v2StripeSubscriptionSync');
const { applyStripeDisputeEvent } = require('../../lib/v2StripeDispute');
const { markOverageLedgerForInvoice } = require('../../lib/v2OverageSettlement');
const { acceptVerifiedStripeEvent, createStripeReceiptWorker, queueStripeEvent } = require('../../lib/opsOutbox');

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

  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(type)) {
    await applyCheckoutSessionToOrg(obj);
    return;
  }

  if (type === 'customer.subscription.deleted') {
    await reconcileStripeSubscriptionEvent(obj);
    return;
  }

  if (type.startsWith('customer.subscription.')) {
    await reconcileStripeSubscriptionEvent(obj);
    return;
  }

  if (type.startsWith('charge.dispute.')) {
    const result = await applyStripeDisputeEvent(type, obj);
    console.info('[v2/billing/webhook] dispute', type, result);
    return;
  }

  if (type === 'invoice.paid') {
    const result = await db.transaction(async tx => {
      const result = await markOverageLedgerForInvoice(obj, 'charged');
      await queueStripeEvent(tx, event);
      return result;
    });
    if (result.updated) console.info('[v2/billing/webhook] overage invoice paid', result);
    return;
  }

  if (type === 'invoice.payment_failed') {
    const result = await markOverageLedgerForInvoice(obj, 'failed');
    if (result.updated) console.info('[v2/billing/webhook] overage invoice payment_failed', result);
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
    } else {
      console.error('[v2/billing/webhook] STRIPE_WEBHOOK_SECRET unset in production');
      return res.status(400).json({ error: 'Webhook secret not configured' });
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

    // New receipts contain the full verified input. Historical/truncated rows are
    // retained separately and never promoted into automatic verified replay.
    const previous = await db.get('SELECT status FROM ops_verified_stripe_receipts WHERE id=?',[event.id]);
    await acceptVerifiedStripeEvent(event);
    await createStripeReceiptWorker(processStripeEvent).drain();

    res.json({ received: true, ...(previous?.status==='delivered'?{duplicate:true}:{}) });
  } catch (e) {
    console.error('[v2/billing/webhook]', e.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

module.exports = { handleV2BillingWebhook, processStripeEvent, verifyStripeSignature };
