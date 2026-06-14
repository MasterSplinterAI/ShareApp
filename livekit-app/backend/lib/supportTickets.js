const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');
const { notifyNewTicket, notifyUserMessage } = require('./telegramSupport');
const { shouldNotifyOpsOnNewTicket, shouldNotifyOpsOnUserMessage } = require('./supportAgent/routing');
const { isSuperadminEmail } = require('./v2Superadmin');

const CATEGORIES = new Set(['customer_support', 'bug_report', 'feature_request']);
const STATUSES = new Set([
  'open',
  'ai_reviewing',
  'pending_review',
  'waiting_user',
  'escalated',
  'resolved',
  'closed',
]);
const BUG_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const FEATURE_PRIORITIES = new Set(['nice_to_have', 'important', 'critical']);
const MAX_BODY = 8000;
const MAX_SUBJECT = 200;

function emailValid(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function sanitizeText(value, maxLen) {
  if (value == null) return '';
  return String(value).trim().slice(0, maxLen);
}

async function nextPublicNumber() {
  const row = await db.get(`SELECT COALESCE(MAX(public_number), 0) + 1 AS n FROM v2_support_tickets`);
  return row?.n || 1;
}

function buildContext(req, clientContext = {}) {
  const ua = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 512) : null;
  return {
    url: sanitizeText(clientContext.url, 512) || null,
    userAgent: sanitizeText(clientContext.userAgent, 512) || ua,
    roomName: sanitizeText(clientContext.roomName, 128) || null,
    appVersion: sanitizeText(clientContext.appVersion, 64) || null,
  };
}

function formatBugBody({ title, steps, expected, actual, extra }) {
  const parts = [`## ${title}`];
  if (steps) parts.push(`\n**Steps to reproduce:**\n${steps}`);
  if (expected) parts.push(`\n**Expected:**\n${expected}`);
  if (actual) parts.push(`\n**Actual:**\n${actual}`);
  if (extra) parts.push(`\n**Additional context:**\n${extra}`);
  return parts.join('\n').slice(0, MAX_BODY);
}

function formatFeatureBody({ problem, solution, extra }) {
  const parts = [];
  if (problem) parts.push(`**Problem:**\n${problem}`);
  if (solution) parts.push(`\n**Proposed solution:**\n${solution}`);
  if (extra) parts.push(`\n**Additional context:**\n${extra}`);
  return parts.join('\n').slice(0, MAX_BODY);
}

function rowToTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    publicNumber: row.public_number,
    category: row.category,
    status: row.status,
    subject: row.subject,
    severity: row.severity,
    priority: row.priority,
    userId: row.user_id,
    orgId: row.org_id,
    guestEmail: row.guest_email,
    context: row.context_json ? JSON.parse(row.context_json) : null,
    assignedTo: row.assigned_to,
    githubIssueUrl: row.github_issue_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function rowToMessage(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorType: row.author_type,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

async function getTicketById(id) {
  const row = await db.get(`SELECT * FROM v2_support_tickets WHERE id = ?`, [id]);
  return rowToTicket(row);
}

async function getTicketByPublicNumber(num) {
  const row = await db.get(`SELECT * FROM v2_support_tickets WHERE public_number = ?`, [num]);
  return rowToTicket(row);
}

async function listMessages(ticketId) {
  const rows = await db.all(
    `SELECT * FROM v2_support_messages WHERE ticket_id = ? ORDER BY datetime(created_at) ASC`,
    [ticketId]
  );
  return rows.map(rowToMessage);
}

async function resolveSubmitterEmail(ticket) {
  if (ticket.guestEmail) return ticket.guestEmail;
  if (!ticket.userId) return null;
  const user = await db.get(`SELECT email FROM v2_users WHERE id = ?`, [ticket.userId]);
  return user?.email || null;
}

async function createTicket(req, body) {
  const category = sanitizeText(body.category, 64);
  if (!CATEGORIES.has(category)) {
    return { ok: false, error: 'Invalid category' };
  }

  const auth = req.v2Auth;
  let guestEmail = auth ? null : sanitizeText(body.guestEmail, 320).toLowerCase();
  if (!auth && !emailValid(guestEmail)) {
    return { ok: false, error: 'Valid email required for guest submissions' };
  }

  let subject = sanitizeText(body.subject, MAX_SUBJECT);
  let messageBody = sanitizeText(body.body, MAX_BODY);
  let severity = null;
  let priority = null;

  if (category === 'bug_report') {
    const title = sanitizeText(body.title, MAX_SUBJECT);
    if (!title) return { ok: false, error: 'Title required' };
    severity = sanitizeText(body.severity, 32).toLowerCase();
    if (!BUG_SEVERITIES.has(severity)) severity = 'medium';
    subject = title;
    messageBody = formatBugBody({
      title,
      steps: sanitizeText(body.steps, 4000),
      expected: sanitizeText(body.expected, 2000),
      actual: sanitizeText(body.actual, 2000),
      extra: sanitizeText(body.body, 2000),
    });
  } else if (category === 'feature_request') {
    const problem = sanitizeText(body.problem, 4000);
    if (!problem) return { ok: false, error: 'Problem description required' };
    priority = sanitizeText(body.priority, 32).toLowerCase();
    if (!FEATURE_PRIORITIES.has(priority)) priority = 'nice_to_have';
    subject = sanitizeText(body.subject, MAX_SUBJECT) || problem.slice(0, 120);
    messageBody = formatFeatureBody({
      problem,
      solution: sanitizeText(body.solution, 4000),
      extra: sanitizeText(body.body, 2000),
    });
  } else {
    if (!messageBody) return { ok: false, error: 'Message required' };
    if (!subject) subject = messageBody.slice(0, 120);
  }

  const now = new Date().toISOString();
  const id = db.uuid();
  const publicNumber = await nextPublicNumber();
  const context = buildContext(req, body.context || {});

  let orgId = auth?.orgId || null;
  let planSnapshot = null;
  if (orgId) {
    const org = await db.get(
      `SELECT o.name, o.billing_status, s.plan_id FROM v2_organizations o
       LEFT JOIN v2_org_subscriptions s ON s.org_id = o.id WHERE o.id = ?`,
      [orgId]
    );
    if (org) planSnapshot = { orgName: org.name, billingStatus: org.billing_status, planId: org.plan_id };
  }
  if (planSnapshot) context.plan = planSnapshot;

  await db.run(
    `INSERT INTO v2_support_tickets
     (id, public_number, category, status, subject, severity, priority, user_id, org_id, guest_email,
      context_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      publicNumber,
      category,
      'open',
      subject,
      severity,
      priority,
      auth?.userId || null,
      orgId,
      guestEmail,
      JSON.stringify(context),
      now,
      now,
    ]
  );

  const messageId = db.uuid();
  await db.run(
    `INSERT INTO v2_support_messages (id, ticket_id, author_type, author_id, body, created_at)
     VALUES (?,?,?,?,?,?)`,
    [messageId, id, 'user', auth?.userId || guestEmail, messageBody, now]
  );

  const ticket = await getTicketById(id);
  const submitterEmail = auth?.email || guestEmail;
  let aiOn = false;
  try {
    aiOn = require('./supportAgent').aiEnabled();
  } catch {
    aiOn = false;
  }
  if (shouldNotifyOpsOnNewTicket(ticket, { aiEnabled: aiOn })) {
    notifyNewTicket(ticket, { submitterEmail, preview: messageBody }).catch((e) =>
      console.error('[supportTickets] telegram notify failed', e)
    );
  }

  try {
    const { queueTicketAnalysis } = require('./supportAgent');
    queueTicketAnalysis(id);
  } catch (e) {
    console.error('[supportTickets] queue analysis failed', e);
  }

  return {
    ok: true,
    ticket,
    messages: [{ id: messageId, authorType: 'user', body: messageBody, createdAt: now }],
  };
}

function canAccessTicket(ticket, req) {
  if (!ticket) return false;
  if (req.v2Auth && isSuperadminEmail(req.v2Auth.email)) return true;
  if (req.v2Auth && ticket.userId && ticket.userId === req.v2Auth.userId) return true;
  return false;
}

async function listUserTickets(userId) {
  const rows = await db.all(
    `SELECT * FROM v2_support_tickets WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 50`,
    [userId]
  );
  return rows.map(rowToTicket);
}

async function addUserMessage(req, ticketId, bodyText) {
  const ticket = await getTicketById(ticketId);
  if (!canAccessTicket(ticket, req)) return { ok: false, status: 403, error: 'Forbidden' };
  if (ticket.status === 'closed') return { ok: false, status: 400, error: 'Ticket is closed' };
  const body = sanitizeText(bodyText, MAX_BODY);
  if (!body) return { ok: false, status: 400, error: 'Message required' };

  const now = new Date().toISOString();
  const messageId = db.uuid();
  await db.run(
    `INSERT INTO v2_support_messages (id, ticket_id, author_type, author_id, body, created_at)
     VALUES (?,?,?,?,?,?)`,
    [messageId, ticketId, 'user', req.v2Auth?.userId || ticket.guestEmail, body, now]
  );
  await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
    'open',
    now,
    ticketId,
  ]);

  if (shouldNotifyOpsOnUserMessage(ticket)) {
    notifyUserMessage(ticket, body).catch(() => {});
  }

  try {
    const { queueTicketAnalysis } = require('./supportAgent');
    queueTicketAnalysis(ticketId);
  } catch (e) {
    console.error('[supportTickets] queue analysis failed', e);
  }

  return { ok: true, message: { id: messageId, authorType: 'user', body, createdAt: now } };
}

async function adminListTickets({ status, category, limit = 100 } = {}) {
  const params = [];
  const where = [];
  if (status && STATUSES.has(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (category && CATEGORIES.has(category)) {
    where.push('category = ?');
    params.push(category);
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const sql = `SELECT * FROM v2_support_tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY datetime(created_at) DESC LIMIT ${lim}`;
  const rows = await db.all(sql, params);
  return rows.map(rowToTicket);
}

async function adminReply(req, ticketId, bodyText) {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, status: 404, error: 'Not found' };
  const body = sanitizeText(bodyText, MAX_BODY);
  if (!body) return { ok: false, status: 400, error: 'Message required' };

  const now = new Date().toISOString();
  const messageId = db.uuid();
  const staffEmail = req.v2Auth.email;
  await db.run(
    `INSERT INTO v2_support_messages (id, ticket_id, author_type, author_id, body, created_at)
     VALUES (?,?,?,?,?,?)`,
    [messageId, ticketId, 'staff', staffEmail, body, now]
  );
  await db.run(
    `UPDATE v2_support_tickets SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?`,
    ['waiting_user', staffEmail, now, ticketId]
  );

  const to = await resolveSubmitterEmail(ticket);
  if (to) {
    const subject = `Re: Parley support #${ticket.publicNumber} — ${ticket.subject || 'your request'}`;
    await sendEmail({
      to,
      subject,
      text: `${body}\n\n— Parley Support\n\nReply from the app: Help → My requests (ticket #${ticket.publicNumber}).`,
      html: `<p>${body.replace(/\n/g, '<br>')}</p><p>— Parley Support</p><p><small>Ticket #${ticket.publicNumber}</small></p>`,
    });
  }

  return {
    ok: true,
    message: { id: messageId, authorType: 'staff', authorId: staffEmail, body, createdAt: now },
  };
}

async function adminPatchStatus(req, ticketId, status) {
  if (!STATUSES.has(status)) return { ok: false, status: 400, error: 'Invalid status' };
  const ticket = await getTicketById(ticketId);
  if (!ticket) return { ok: false, status: 404, error: 'Not found' };
  const now = new Date().toISOString();
  const closedAt = status === 'closed' || status === 'resolved' ? now : null;
  await db.run(
    `UPDATE v2_support_tickets SET status = ?, updated_at = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?`,
    [status, now, closedAt, ticketId]
  );
  return { ok: true, ticket: await getTicketById(ticketId) };
}

module.exports = {
  CATEGORIES,
  STATUSES,
  createTicket,
  getTicketById,
  getTicketByPublicNumber,
  listMessages,
  listUserTickets,
  addUserMessage,
  canAccessTicket,
  adminListTickets,
  adminReply,
  adminPatchStatus,
  resolveSubmitterEmail,
};
