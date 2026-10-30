const db = require('../../db/v2Database');
const { searchSupportDocs, formatSourcesForPrompt } = require('../supportKnowledge');
const { createProposal, getActivePendingForTicket } = require('../supportProposals');
const { notifyProposalReady } = require('../telegramSupport');
const { postAgentMessage } = require('../proposalExecutor');
const { decideCustomerSupportAction, userFacingReply } = require('./routing');
const { aiEnabled, callSupportLlm } = require('./llm');
const { formatUserFacingReply, REPLY_STYLE_RULES } = require('../supportReplyFormat');
const { recordKnowledgeGap } = require('../supportKnowledgeGaps');
const { formatUserContextForPrompt, buildUserContextSnapshot } = require('../supportUserContext');

const debounceMs = parseInt(process.env.SUPPORT_AI_DEBOUNCE_MS || '3000', 10);
const pendingTimers = new Map();

function buildSystemPrompt(category) {
  const supportRouting =
    category === 'customer_support'
      ? `
For customer_support you MUST set "route":
- reply_in_app — confident how-to answer from knowledge base; include draft_reply in body
- propose_reply — answer needs human approval (sensitive, uncertain, or complex)
- escalate — billing disputes, legal, abuse, account compromise
- close — user confirmed resolved; optional brief draft_reply

Always include draft_reply with what the user should see in chat, even for escalate/propose_reply.`
      : '';

  return `You are Lalia support triage AI. Output ONLY valid JSON (no markdown fences).

Category is fixed by the user submission: ${category}.
${supportRouting}
${REPLY_STYLE_RULES}

JSON shape:
{
  "route": "reply_in_app|propose_reply|escalate|close",
  "proposal_type": "support_reply|escalation|bug_fix|feature",
  "summary": "one line for ops",
  "confidence": 0.0-1.0,
  "body": { ...fields per type... }
}

For support_reply body: user_intent, draft_reply (customer-facing, friendly), sources (array of doc paths), escalation_reason (null or string)
For escalation body: reason, draft_reply (what to tell the user in chat), recommended_assignee, urgency (low|medium|high)
For bug_fix body: user_intent, root_cause_hypothesis, affected_components (array), suggested_fix, repro_steps (array), test_plan (array), risks (array), github_issue_title, github_issue_body (markdown), user_update (short message for the user's chat thread), need_info_message (optional — friendly question to ask user if more detail is needed; bug-focused, not feature language)
For feature body: problem_statement, proposed_mvp, similar_tickets (array), effort_estimate (S|M|L), risk (low|medium|high), files_likely_touched (array), backlog_recommendation, user_update (short message for the user's chat thread), need_info_message (optional — friendly clarifying questions about problem, users, and workflow; never ask for repro steps)

Never invent product features not in the knowledge base. If unsure, still provide a helpful draft_reply acknowledging the question and use propose_reply or escalate.

Product accuracy: follow knowledge base excerpts exactly for UI navigation. Do not claim users can set invite expiration when creating a meeting — expiration is configured only after creation in Meeting settings → Advanced invites. For transcript security or encryption questions, use product/transcripts-security.md and faq.md — distinguish in transit vs at rest; do not invent encryption algorithms.`;
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

function rowToTicketBrief(ticketRow) {
  return {
    id: ticketRow.id,
    publicNumber: ticketRow.public_number,
    category: ticketRow.category,
    subject: ticketRow.subject,
    severity: ticketRow.severity,
    priority: ticketRow.priority,
  };
}

async function createProposalAndNotify(ticketRow, parsed, docHits, { docQuery = '' } = {}) {
  const proposalType =
    parsed.proposal_type ||
    (ticketRow.category === 'bug_report'
      ? 'bug_fix'
      : ticketRow.category === 'feature_request'
        ? 'feature'
        : 'support_reply');
  const summary = String(parsed.summary || 'AI proposal').slice(0, 500);
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
  if (docHits.length && !body.sources) {
    body.sources = docHits.map((h) => h.source);
  }

  const proposal = await createProposal({
    ticketId: ticketRow.id,
    proposalType,
    summary,
    body,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
  });

  await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
    'pending_review',
    new Date().toISOString(),
    ticketRow.id,
  ]);

  await notifyProposalReady(rowToTicketBrief(ticketRow), proposal).catch((e) =>
    console.error('[supportAgent] telegram proposal notify failed', e)
  );

  const shouldLogGap =
    proposalType === 'escalation' ||
    docHits.length === 0 ||
    parsed.route === 'propose_reply' ||
    parsed.route === 'escalate' ||
    (typeof parsed.confidence === 'number' && parsed.confidence < 0.65);

  if (shouldLogGap) {
    recordKnowledgeGap({
      ticketId: ticketRow.id,
      proposalId: proposal.id,
      proposalType,
      summary: proposal.summary,
      escalationReason: body.escalation_reason || body.reason || null,
      docQuery,
      docHits,
    }).catch((e) => console.error('[supportAgent] knowledge gap log failed', e));
  }

  return proposal;
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
  let userSnapshot = context?.user;
  if (ticketRow.user_id) {
    userSnapshot = await buildUserContextSnapshot({
      userId: ticketRow.user_id,
      orgId: ticketRow.org_id,
      email: userSnapshot?.email || null,
      guestEmail: ticketRow.guest_email,
    });
  } else if (ticketRow.guest_email) {
    userSnapshot = await buildUserContextSnapshot({ guestEmail: ticketRow.guest_email });
  }
  const userContextBlock = formatUserContextForPrompt(userSnapshot);
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
    userContextBlock,
    context?.url ? `Page: ${context.url}` : null,
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
    const { DEFAULT_HOLD_REPLY } = require('./routing');
    await postAgentMessage(ticketId, DEFAULT_HOLD_REPLY, { status: 'waiting_user' });
    await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
      'waiting_user',
      new Date().toISOString(),
      ticketId,
    ]);
    return { ok: false, error: e.message };
  }

  if (ticketRow.category !== 'customer_support') {
    const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
    const userUpdate =
      body.user_update ||
      `Thanks — I've reviewed ticket #${ticketRow.public_number}. Our team is looking at it and you'll see updates in this chat.`;
    await postAgentMessage(ticketId, String(userUpdate).slice(0, 8000), { status: 'pending_review' });
    const proposal = await createProposalAndNotify(ticketRow, parsed, docHits, { docQuery });
    return { ok: true, route: 'proposal', proposal };
  }

  const decision = decideCustomerSupportAction(parsed, { thread, docHits });

  if (decision.action === 'reply_in_app') {
    const message = await postAgentMessage(ticketId, decision.draftReply.slice(0, 8000), {
      status: 'waiting_user',
    });
    return { ok: true, route: 'reply_in_app', message };
  }

  if (decision.action === 'close') {
    if (decision.draftReply) {
      await postAgentMessage(ticketId, decision.draftReply.slice(0, 8000), { status: 'resolved' });
    } else {
      await db.run(
        `UPDATE v2_support_tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
        ['resolved', new Date().toISOString(), new Date().toISOString(), ticketId]
      );
    }
    return { ok: true, route: 'close' };
  }

  const userReply = decision.userReply || userFacingReply(parsed, { proposalType: decision.proposalType });
  await postAgentMessage(ticketId, userReply.slice(0, 8000), { status: 'waiting_user' });

  const proposal = await createProposalAndNotify(
    ticketRow,
    {
      ...parsed,
      proposal_type: decision.proposalType || parsed.proposal_type || 'escalation',
    },
    docHits,
    { docQuery }
  );
  return { ok: true, route: 'proposal', proposal };
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
