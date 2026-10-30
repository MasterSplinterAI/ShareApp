const db = require('../db/v2Database');

const PROPOSAL_TYPES = new Set([
  'support_reply',
  'escalation',
  'bug_fix',
  'feature',
  'close_ticket',
]);
const PROPOSAL_STATUSES = new Set([
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'needs_info',
]);

function rowToProposal(row) {
  if (!row) return null;
  let body = {};
  try {
    body = JSON.parse(row.body_json || '{}');
  } catch {
    body = {};
  }
  return {
    id: row.id,
    ticketId: row.ticket_id,
    proposalType: row.proposal_type,
    status: row.status,
    summary: row.summary,
    body,
    confidence: row.confidence,
    telegramMessageId: row.telegram_message_id,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    executionStatus: row.execution_status,
    executionRef: row.execution_ref,
    createdAt: row.created_at,
  };
}

async function getProposalById(id) {
  const row = await db.get(`SELECT * FROM v2_support_proposals WHERE id = ?`, [id]);
  return rowToProposal(row);
}

async function listProposalsForTicket(ticketId) {
  const rows = await db.all(
    `SELECT * FROM v2_support_proposals WHERE ticket_id = ? ORDER BY datetime(created_at) DESC`,
    [ticketId]
  );
  return rows.map(rowToProposal);
}

async function listProposals({ status, limit = 50 } = {}) {
  const params = [];
  const where = [];
  if (status && PROPOSAL_STATUSES.has(status)) {
    where.push('status = ?');
    params.push(status);
  }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const sql = `SELECT * FROM v2_support_proposals ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY datetime(created_at) DESC LIMIT ${lim}`;
  const rows = await db.all(sql, params);
  return rows.map(rowToProposal);
}

async function getActivePendingForTicket(ticketId) {
  const row = await db.get(
    `SELECT * FROM v2_support_proposals
     WHERE ticket_id = ? AND status = 'pending_review'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [ticketId]
  );
  return rowToProposal(row);
}

async function createProposal({
  ticketId,
  proposalType,
  summary,
  body,
  confidence = null,
  status = 'pending_review',
}) {
  if (!PROPOSAL_TYPES.has(proposalType)) {
    throw new Error(`Invalid proposal type: ${proposalType}`);
  }
  const now = new Date().toISOString();
  const id = db.uuid();
  await db.run(
    `INSERT INTO v2_support_proposals
     (id, ticket_id, proposal_type, status, summary, body_json, confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, ticketId, proposalType, status, summary, JSON.stringify(body || {}), confidence, now]
  );
  return getProposalById(id);
}

async function patchProposal(id, fields) {
  const sets = [];
  const params = [];
  const allowed = {
    status: 'status',
    telegramMessageId: 'telegram_message_id',
    reviewedBy: 'reviewed_by',
    reviewedAt: 'reviewed_at',
    executionStatus: 'execution_status',
    executionRef: 'execution_ref',
  };
  for (const [key, col] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return getProposalById(id);
  params.push(id);
  await db.run(`UPDATE v2_support_proposals SET ${sets.join(', ')} WHERE id = ?`, params);
  return getProposalById(id);
}

module.exports = {
  PROPOSAL_TYPES,
  PROPOSAL_STATUSES,
  getProposalById,
  listProposalsForTicket,
  listProposals,
  getActivePendingForTicket,
  createProposal,
  patchProposal,
};
