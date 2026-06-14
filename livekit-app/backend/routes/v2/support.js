const express = require('express');
const router = express.Router();
const { requireV2Auth, optionalV2Auth } = require('../../middleware/v2Auth');
const { requireSuperadmin, writeAdminAudit } = require('../../lib/v2Superadmin');
const db = require('../../db/v2Database');
const support = require('../../lib/supportTickets');

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
    res.json({ ticket, messages, submitterEmail });
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

module.exports = router;
