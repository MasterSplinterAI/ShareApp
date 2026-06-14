const axios = require('axios');
const db = require('../../db/v2Database');
const { searchSupportDocs, formatSourcesForPrompt } = require('../supportKnowledge');
const { createProposal, getActivePendingForTicket } = require('../supportProposals');
const { notifyProposalReady } = require('../telegramSupport');

const debounceMs = parseInt(process.env.SUPPORT_AI_DEBOUNCE_MS || '8000', 10);
const pendingTimers = new Map();

function aiEnabled() {
  if (process.env.SUPPORT_AI_ENABLED === 'false') return false;
  if (process.env.OPENAI_API_KEY) return true;
  return Boolean(
    process.env.TRANSLATION_API_KEY &&
      (process.env.TRANSLATION_API_PROVIDER || '').toLowerCase() === 'openai'
  );
}

function resolveApiKey() {
  return process.env.OPENAI_API_KEY || process.env.TRANSLATION_API_KEY || null;
}

function resolveModel() {
  return process.env.SUPPORT_AI_MODEL || 'gpt-4o-mini';
}

async function callSupportLlm(systemPrompt, userContent) {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('No OpenAI API key configured');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: resolveModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    }
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  return JSON.parse(content);
}

function buildSystemPrompt(category) {
  return `You are Parley support triage AI. Output ONLY valid JSON (no markdown fences).

Category is fixed by the user submission: ${category}.

Choose proposal_type:
- customer_support → support_reply (if you can answer from docs) OR escalation (billing, legal, angry user, low confidence)
- bug_report → bug_fix
- feature_request → feature

JSON shape:
{
  "proposal_type": "support_reply|escalation|bug_fix|feature",
  "summary": "one line for ops",
  "confidence": 0.0-1.0,
  "body": { ...fields per type... }
}

For support_reply body: user_intent, draft_reply (customer-facing, friendly), sources (array of doc paths), escalation_reason (null or string)
For escalation body: reason, draft_reply (optional templated message to user), recommended_assignee, urgency (low|medium|high)
For bug_fix body: user_intent, root_cause_hypothesis, affected_components (array), suggested_fix, repro_steps (array), test_plan (array), risks (array), github_issue_title, github_issue_body (markdown)
For feature body: problem_statement, proposed_mvp, similar_tickets (array), effort_estimate (S|M|L), risk (low|medium|high), files_likely_touched (array), backlog_recommendation

Never invent product features not in the knowledge base. If unsure, use escalation.`;
}

async function findSimilarTickets(ticket) {
  const subject = (ticket.subject || '').trim();
  if (!subject || subject.length < 8) return [];
  const rows = await db.all(
    `SELECT id, public_number, subject, status FROM v2_support_tickets
     WHERE id != ? AND status NOT IN ('closed','resolved')
     AND subject LIKE ? LIMIT 5`,
    [ticket.id, `%${subject.slice(0, 40)}%`]
  );
  return rows.map((r) => ({ id: r.id, publicNumber: r.public_number, subject: r.subject, status: r.status }));
}

async function analyzeTicket(ticketId) {
  if (!aiEnabled()) return { ok: false, skipped: true, reason: 'AI disabled' };

  const ticketRow = await db.get(`SELECT * FROM v2_support_tickets WHERE id = ?`, [ticketId]);
  if (!ticketRow) return { ok: false, error: 'Ticket not found' };
  if (['closed', 'resolved'].includes(ticketRow.status)) return { ok: false, skipped: true };

  const existing = await getActivePendingForTicket(ticketId);
  if (existing) return { ok: false, skipped: true, reason: 'Pending proposal exists' };

  const now = new Date().toISOString();
  await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
    'ai_reviewing',
    now,
    ticketId,
  ]);

  const messages = await db.all(
    `SELECT author_type, body FROM v2_support_messages WHERE ticket_id = ? ORDER BY datetime(created_at) ASC`,
    [ticketId]
  );
  const thread = messages.map((m) => `[${m.author_type}] ${m.body}`).join('\n\n');
  const context = ticketRow.context_json ? JSON.parse(ticketRow.context_json) : null;
  const docQuery = [ticketRow.subject, thread.slice(0, 800)].filter(Boolean).join(' ');
  const docHits = searchSupportDocs(docQuery, { limit: 5 });
  const similar = await findSimilarTickets({
    id: ticketRow.id,
    subject: ticketRow.subject,
  });

  const userPayload = [
    `Ticket #${ticketRow.public_number}`,
    `Category: ${ticketRow.category}`,
    ticketRow.severity ? `Severity: ${ticketRow.severity}` : null,
    ticketRow.priority ? `Priority: ${ticketRow.priority}` : null,
    context ? `Context: ${JSON.stringify(context)}` : null,
    similar.length ? `Similar open tickets: ${JSON.stringify(similar)}` : null,
    '',
    'Knowledge base excerpts:',
    formatSourcesForPrompt(docHits),
    '',
    'Conversation:',
    thread,
  ]
    .filter(Boolean)
    .join('\n');

  let parsed;
  try {
    parsed = await callSupportLlm(buildSystemPrompt(ticketRow.category), userPayload);
  } catch (e) {
    console.error('[supportAgent] LLM failed:', e.message);
    await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
      'open',
      new Date().toISOString(),
      ticketId,
    ]);
    return { ok: false, error: e.message };
  }

  const proposalType = parsed.proposal_type || (ticketRow.category === 'bug_report' ? 'bug_fix' : ticketRow.category === 'feature_request' ? 'feature' : 'escalation');
  const summary = String(parsed.summary || 'AI proposal').slice(0, 500);
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
  if (docHits.length && !body.sources) {
    body.sources = docHits.map((h) => h.source);
  }

  const proposal = await createProposal({
    ticketId,
    proposalType,
    summary,
    body,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
  });

  await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
    'pending_review',
    new Date().toISOString(),
    ticketId,
  ]);

  const ticket = {
    id: ticketRow.id,
    publicNumber: ticketRow.public_number,
    category: ticketRow.category,
    subject: ticketRow.subject,
    severity: ticketRow.severity,
    priority: ticketRow.priority,
  };

  notifyProposalReady(ticket, proposal).catch((e) =>
    console.error('[supportAgent] telegram proposal notify failed', e)
  );

  return { ok: true, proposal };
}

function queueTicketAnalysis(ticketId) {
  if (!aiEnabled()) return;
  const existing = pendingTimers.get(ticketId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(ticketId);
    analyzeTicket(ticketId).catch((e) => console.error('[supportAgent] analyze error', e));
  }, debounceMs);
  timer.unref?.();
  pendingTimers.set(ticketId, timer);
}

module.exports = {
  aiEnabled,
  analyzeTicket,
  queueTicketAnalysis,
};
