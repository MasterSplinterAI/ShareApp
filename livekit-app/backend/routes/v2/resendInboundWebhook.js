const db = require('../../db/v2Database');
const { verifySvixWebhook } = require('../../lib/resendWebhookVerify');
const { processInboundRsvpEmail, recordInboundEvent } = require('../../lib/guestInviteRsvp');
const { getEmailSettings } = require('../../lib/v2EmailSettings');

async function handleResendInboundWebhook(req, res) {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Expected raw body' });
  }

  const bodyText = rawBody.toString('utf8');
  // Signing secret is stored (encrypted at rest) via Admin → Communications,
  // falling back to RESEND_WEBHOOK_SECRET env if set.
  let secret = '';
  try {
    const settings = await getEmailSettings();
    secret = settings.resendWebhookSecret || '';
  } catch (e) {
    console.error('[resend/inbound] failed to load webhook secret from settings:', e);
    secret = process.env.RESEND_WEBHOOK_SECRET || '';
  }

  if (secret) {
    const check = verifySvixWebhook(bodyText, req.headers, secret);
    if (!check.ok) {
      console.warn('[resend/inbound] webhook verification failed:', check.reason);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  } else {
    console.warn('[resend/inbound] no webhook signing secret configured (Admin → Communications or RESEND_WEBHOOK_SECRET) — accepting webhook without verification');
  }

  let event;
  try {
    event = JSON.parse(bodyText);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (event.type !== 'email.received') {
    return res.json({ ok: true, ignored: event.type });
  }

  const emailId = event.data?.email_id;
  const svixId = req.headers['svix-id'] || emailId;
  if (!emailId) {
    return res.status(400).json({ error: 'Missing email_id' });
  }

  try {
    const dedupe = await recordInboundEvent(String(svixId), bodyText.slice(0, 50000));
    if (dedupe.duplicate) {
      return res.json({ ok: true, duplicate: true });
    }

    const result = await processInboundRsvpEmail(emailId, {
      from: event.data?.from,
      to: event.data?.to,
      cc: event.data?.cc,
    });

    if (!result.ok) {
      console.log('[resend/inbound] RSVP not applied:', result.error, emailId);
    } else {
      console.log('[resend/inbound] RSVP updated:', result.meetingId, result.guestEmail, result.rsvpStatus);
    }

    return res.json({ ok: true, result });
  } catch (e) {
    console.error('[resend/inbound]', e);
    return res.status(500).json({ error: 'Processing failed' });
  }
}

module.exports = { handleResendInboundWebhook };
