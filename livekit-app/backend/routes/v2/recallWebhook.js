'use strict';

const db = require('../../db/v2Database');
const { verifySvixWebhook } = require('../../lib/resendWebhookVerify');
const { getNotetakerSettings, syncRecallBotSession } = require('../../lib/recallNotetaker');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');

async function handleRecallWebhook(req, res) {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ error: 'Expected raw body' });
  }

  const bodyText = rawBody.toString('utf8');
  let settings;
  try {
    settings = await getNotetakerSettings();
  } catch (err) {
    console.error('[recall/webhook] failed to load settings:', err.message);
    settings = { recallWebhookSecret: process.env.RECALL_WEBHOOK_SECRET || '' };
  }

  if (settings.recallWebhookSecret) {
    const normalizedHeaders = {
      'svix-id': req.headers['svix-id'] || req.headers['webhook-id'],
      'svix-timestamp': req.headers['svix-timestamp'] || req.headers['webhook-timestamp'],
      'svix-signature': req.headers['svix-signature'] || req.headers['webhook-signature'],
    };
    const check = verifySvixWebhook(bodyText, normalizedHeaders, settings.recallWebhookSecret);
    if (!check.ok) {
      console.warn('[recall/webhook] signature verification failed:', check.reason);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(bodyText);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (event?.event === 'ping') {
    return res.json({ ok: true, pong: true });
  }

  const externalBotId = event?.data?.bot?.id || event?.data?.bot_id || event?.bot?.id || null;
  if (!externalBotId) {
    return res.json({ ok: true, ignored: true });
  }

  try {
    const session = await db.get(
      `SELECT * FROM v2_external_bot_sessions WHERE external_bot_id = ? LIMIT 1`,
      [String(externalBotId)]
    );
    if (!session) {
      return res.json({ ok: true, unmatched: true });
    }

    const result = await syncRecallBotSession(session, {
      publicBaseUrl: publicFrontendBaseUrl(req),
    });
    return res.json({ ok: true, synced: Boolean(result?.ok), result });
  } catch (err) {
    console.error('[recall/webhook] sync failed:', err.message);
    return res.status(500).json({ error: 'Recall webhook processing failed' });
  }
}

module.exports = { handleRecallWebhook };
