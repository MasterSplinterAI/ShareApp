const db = require('../db/v2Database');

function rowToGap(row) {
  if (!row) return null;
  let docHits = [];
  try {
    docHits = JSON.parse(row.doc_hits_json || '[]');
  } catch {
    docHits = [];
  }
  return {
    id: row.id,
    ticketId: row.ticket_id,
    publicNumber: row.public_number,
    userQuestion: row.user_question,
    escalationReason: row.escalation_reason,
    docQuery: row.doc_query,
    docHits,
    proposalId: row.proposal_id,
    proposalType: row.proposal_type,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

async function getLastUserQuestion(ticketId) {
  const row = await db.get(
    `SELECT body FROM v2_support_messages
     WHERE ticket_id = ? AND author_type = 'user'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [ticketId]
  );
  return row?.body || null;
}

async function recordKnowledgeGap({
  ticketId,
  proposalId = null,
  proposalType,
  summary,
  escalationReason = null,
  docQuery = null,
  docHits = [],
}) {
  const ticket = await db.get(
    `SELECT public_number FROM v2_support_tickets WHERE id = ?`,
    [ticketId]
  );
  const userQuestion = (await getLastUserQuestion(ticketId)) || summary || '';
  const now = new Date().toISOString();
  const id = db.uuid();

  await db.run(
    `INSERT INTO v2_support_knowledge_gaps
     (id, ticket_id, public_number, user_question, escalation_reason, doc_query, doc_hits_json,
      proposal_id, proposal_type, summary, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      ticketId,
      ticket?.public_number || null,
      String(userQuestion).slice(0, 4000),
      escalationReason ? String(escalationReason).slice(0, 2000) : null,
      docQuery ? String(docQuery).slice(0, 2000) : null,
      JSON.stringify(docHits.slice(0, 10)),
      proposalId,
      proposalType || null,
      summary ? String(summary).slice(0, 500) : null,
      'open',
      now,
    ]
  );
  return rowToGap(
    await db.get(`SELECT * FROM v2_support_knowledge_gaps WHERE id = ?`, [id])
  );
}

async function listKnowledgeGaps({ status = 'open', limit = 100 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE status = ?';
    params.push(status);
  }
  const rows = await db.all(
    `SELECT * FROM v2_support_knowledge_gaps ${where}
     ORDER BY datetime(created_at) DESC LIMIT ${lim}`,
    params
  );
  return rows.map(rowToGap);
}

async function patchKnowledgeGap(id, status) {
  const now = new Date().toISOString();
  const resolvedAt = status === 'resolved' || status === 'dismissed' ? now : null;
  await db.run(
    `UPDATE v2_support_knowledge_gaps SET status = ?, resolved_at = ? WHERE id = ?`,
    [status, resolvedAt, id]
  );
  return rowToGap(await db.get(`SELECT * FROM v2_support_knowledge_gaps WHERE id = ?`, [id]));
}

async function getKnowledgeGapById(id) {
  return rowToGap(await db.get(`SELECT * FROM v2_support_knowledge_gaps WHERE id = ?`, [id]));
}

module.exports = {
  recordKnowledgeGap,
  listKnowledgeGaps,
  patchKnowledgeGap,
  getKnowledgeGapById,
};
