const express = require('express');
const router = express.Router();
const { requireV2Auth, optionalV2Auth } = require('../../middleware/v2Auth');
const { requireSuperadmin, writeAdminAudit } = require('../../lib/v2Superadmin');
const db = require('../../db/v2Database');
const support = require('../../lib/supportTickets');
const { listProposals, listProposalsForTicket } = require('../../lib/supportProposals');
const { executeProposalAction } = require('../../lib/proposalExecutor');
const { handleTelegramUpdate } = require('../../lib/supportTelegramWebhook');
const { coachFeatureRequest } = require('../../lib/supportAgent/coach');
const { listKnowledgeGaps, patchKnowledgeGap, getKnowledgeGapById } = require('../../lib/supportKnowledgeGaps');
const { suggestKbEntryForGap } = require('../../lib/supportKbSuggest');

const TICKET_RATE_WINDOW_MS = 15 * 60 * 1000;
const TICKET_RATE_MAX = 10;
const ticketAttempts = new Map();

function ticketRateLimited(ip) {
  const now = Date.now();
  const entry = ticketAttempts.get(ip);
  if (!entry || now - entry.windowStart > TICKET_RATE_WINDOW_MS) {
    ticketAttempts.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > TICKET_RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ticketAttempts) {
    if (now - entry.windowStart > TICKET_RATE_WINDOW_MS) ticketAttempts.delete(ip);
  }
}, TICKET_RATE_WINDOW_MS).unref();

router.post('/coach', optionalV2Auth, async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (ticketRateLimited(String(ip))) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    const { category, messages } = req.body || {};
    if (category !== 'feature_request') {
      return res.status(400).json({ error: 'Only feature_request coaching is supported' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages required' });
    }
    const result = await coachFeatureRequest(messages, { userContext: req.v2Auth });
    res.json(result);
  } catch (e) {
    console.error('[support/coach]', e);
    res.status(500).json({ error: 'Coach unavailable' });
  }
});

router.post('/tickets', optionalV2Auth, async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    if (ticketRateLimited(String(ip))) {
      return res.status(429).json({ error: 'Too many submissions. Try again later.' });
    }
    const result = await support.createTicket(req, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ticket: result.ticket, messages: result.messages });
  } catch (e) {
    console.error('[support/create ticket]', e);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

router.get('/tickets', requireV2Auth, async (req, res) => {
  try {
    const tickets = await support.listUserTickets(req.v2Auth.userId);
    res.json({ tickets });
  } catch (e) {
    console.error('[support/list tickets]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/tickets/:id', requireV2Auth, async (req, res) => {
  try {
    const ticket = await support.getTicketById(req.params.id);
    if (!support.canAccessTicket(ticket, req)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const messages = await support.listMessages(ticket.id);
    res.json({ ticket, messages });
  } catch (e) {
    console.error('[support/get ticket]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/tickets/:id/messages', requireV2Auth, async (req, res) => {
  try {
    const result = await support.addUserMessage(req, req.params.id, req.body?.body);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ message: result.message });
  } catch (e) {
    console.error('[support/user message]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/tickets', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const tickets = await support.adminListTickets({
      status: req.query.status,
      category: req.query.category,
      limit: req.query.limit,
    });
    res.json({ tickets });
  } catch (e) {
    console.error('[support/admin list]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/tickets/:id', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    let ticket = await support.getTicketById(req.params.id);
    if (!ticket && /^\d+$/.test(req.params.id)) {
      ticket = await support.getTicketByPublicNumber(parseInt(req.params.id, 10));
    }
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    const messages = await support.listMessages(ticket.id);
    const submitterEmail = await support.resolveSubmitterEmail(ticket);
    const proposals = await listProposalsForTicket(ticket.id);
    res.json({ ticket, messages, submitterEmail, proposals });
  } catch (e) {
    console.error('[support/admin detail]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/tickets/:id/reply', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const result = await support.adminReply(req, req.params.id, req.body?.body);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    await writeAdminAudit(db, req.v2Auth.email, 'support_staff_reply', {
      ticketId: req.params.id,
    });
    res.json({ message: result.message });
  } catch (e) {
    console.error('[support/admin reply]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/admin/tickets/:id/status', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    const result = await support.adminPatchStatus(req, req.params.id, status);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    await writeAdminAudit(db, req.v2Auth.email, 'support_status_change', {
      ticketId: req.params.id,
      status,
    });
    res.json({ ticket: result.ticket });
  } catch (e) {
    console.error('[support/admin status]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/proposals', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const proposals = await listProposals({
      status: req.query.status || 'pending_review',
      limit: req.query.limit,
    });
    res.json({ proposals });
  } catch (e) {
    console.error('[support/admin proposals]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/proposals/:id/action', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!action) return res.status(400).json({ error: 'action required' });
    const result = await executeProposalAction(req.params.id, action, req.v2Auth.email);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    await writeAdminAudit(db, req.v2Auth.email, 'support_proposal_action', {
      proposalId: req.params.id,
      action,
      result: result.result,
    });
    res.json(result);
  } catch (e) {
    console.error('[support/admin proposal action]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/knowledge-gaps', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const gaps = await listKnowledgeGaps({
      status: req.query.status || 'open',
      limit: req.query.limit,
    });
    res.json({ gaps });
  } catch (e) {
    console.error('[support/admin knowledge gaps]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/admin/knowledge-gaps/:id', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['open', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const gap = await patchKnowledgeGap(req.params.id, status);
    if (!gap) return res.status(404).json({ error: 'Not found' });
    res.json({ gap });
  } catch (e) {
    console.error('[support/admin knowledge gap patch]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/knowledge-gaps/:id/suggest', requireV2Auth, requireSuperadmin, async (req, res) => {
  try {
    const gap = await getKnowledgeGapById(req.params.id);
    const result = await suggestKbEntryForGap(gap);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    await writeAdminAudit(db, req.v2Auth.email, 'support_kb_suggest', {
      gapId: req.params.id,
      targetFile: result.suggestion?.targetFile,
      confidence: result.suggestion?.confidence,
    });
    res.json(result);
  } catch (e) {
    console.error('[support/admin knowledge gap suggest]', e);
    res.status(500).json({ error: 'Suggestion failed' });
  }
});

router.post('/telegram/webhook', async (req, res) => {
  try {
    const secret = process.env.SUPPORT_TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.status(200).json({ ok: true });
    handleTelegramUpdate(req.body || {}).catch((e) =>
      console.error('[support/telegram webhook]', e)
    );
  } catch (e) {
    console.error('[support/telegram webhook]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
