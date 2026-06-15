const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');
const { getProposalById, patchProposal } = require('./supportProposals');
const { getTicketById, resolveSubmitterEmail } = require('./supportTickets');
const { createSupportIssue } = require('./githubIssues');
const {
  sendTelegramMessage,
  notifyGithubIssueCreated,
  escapeHtml,
} = require('./telegramSupport');

const MAX_BODY = 8000;
const { formatUserFacingReply } = require('./supportReplyFormat');

async function postAgentMessage(ticketId, body, { status = 'waiting_user' } = {}) {
  const formatted = formatUserFacingReply(body);
  const now = new Date().toISOString();
  const messageId = db.uuid();
  await db.run(
    `INSERT INTO v2_support_messages (id, ticket_id, author_type, author_id, body, created_at)
     VALUES (?,?,?,?,?,?)`,
    [messageId, ticketId, 'agent', 'parley-support-ai', formatted.slice(0, MAX_BODY), now]
  );
  await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
    status,
    now,
    ticketId,
  ]);
  return { id: messageId, authorType: 'agent', body: formatted, createdAt: now };
}

async function emailUser(ticket, body) {
  const to = await resolveSubmitterEmail(ticket);
  if (!to) return;
  const subject = `Re: Parley support #${ticket.publicNumber} — ${ticket.subject || 'your request'}`;
  await sendEmail({
    to,
    subject,
    text: `${body}\n\n— Parley Support\n\nReply from the app: Help → My requests (ticket #${ticket.publicNumber}).`,
    html: `<p>${body.replace(/\n/g, '<br>')}</p><p>— Parley Support</p><p><small>Ticket #${ticket.publicNumber}</small></p>`,
  });
}

function normalizeAction(action, proposalType) {
  const a = String(action || '').toLowerCase();
  if (a === 'approve' || a === 'issue' || a === 'approve_backlog') return 'approve';
  if (a === 'send_reply') return 'send_reply';
  if (a === 'reject') return 'reject';
  if (a === 'need_info') return 'need_info';
  if (a === 'take_over' || a === 'assign_me') return 'take_over';
  return a;
}

function buildNeedInfoMessage(proposal, ticket) {
  const body = proposal.body || {};
  if (body.need_info_message) {
    return String(body.need_info_message).slice(0, MAX_BODY);
  }

  const type = proposal.proposalType;
  const category = ticket.category;

  if (type === 'feature' || category === 'feature_request') {
    const problem = body.problem_statement ? String(body.problem_statement).trim().slice(0, 200) : '';
    if (problem) {
      return (
        `Thanks for your feature idea about “${problem}”. To help us prioritize and scope it, could you share who would use this, how you imagine it working in your workflow, and how often you would need it?`
      );
    }
    return (
      'Thanks for your feature idea! To help us prioritize, could you share who would use this, what problem it solves, how you imagine it working, and how important it is to you day to day?'
    );
  }

  if (type === 'bug_fix' || category === 'bug_report') {
    return (
      'Thanks for the report — we want to dig in. Could you share steps to reproduce, what you expected vs what happened, and any screenshots or screen recordings? Browser and device details help too.'
    );
  }

  if (body.draft_reply) {
    return String(body.draft_reply).slice(0, MAX_BODY);
  }

  return 'Could you share a bit more detail so we can help?';
}

async function sendApprovedDraftReply(ticket, proposal, { reviewer, proposalId, now }) {
  const draft = proposal.body?.draft_reply;
  if (!draft) return { ok: false, status: 400, error: 'No draft_reply in proposal' };
  const body = String(draft).slice(0, MAX_BODY);
  const lastAgent = await db.get(
    `SELECT body FROM v2_support_messages
     WHERE ticket_id = ? AND author_type = 'agent'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [ticket.id]
  );
  const alreadySent =
    lastAgent?.body &&
    !String(lastAgent.body).includes('give me a moment') &&
    String(lastAgent.body).slice(0, 60) === body.slice(0, 60);
  if (!alreadySent) {
    await postAgentMessage(ticket.id, body, { status: 'waiting_user' });
    await emailUser(ticket, body);
  } else {
    await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
      'waiting_user',
      now,
      ticket.id,
    ]);
  }
  await patchProposal(proposalId, {
    status: 'approved',
    reviewedBy: reviewer,
    reviewedAt: now,
    executionStatus: 'done',
  });
  return { ok: true, result: 'reply_sent' };
}

async function executeProposalAction(proposalId, action, reviewerId) {
  const proposal = await getProposalById(proposalId);
  if (!proposal) return { ok: false, status: 404, error: 'Proposal not found' };
  if (proposal.status !== 'pending_review') {
    return { ok: false, status: 409, error: `Proposal already ${proposal.status}` };
  }

  const ticket = await getTicketById(proposal.ticketId);
  if (!ticket) return { ok: false, status: 404, error: 'Ticket not found' };

  const act = normalizeAction(action, proposal.proposalType);
  const now = new Date().toISOString();
  const reviewer = String(reviewerId || 'unknown');

  if (act === 'reject') {
    await patchProposal(proposalId, {
      status: 'rejected',
      reviewedBy: reviewer,
      reviewedAt: now,
      executionStatus: 'done',
    });
    await db.run(`UPDATE v2_support_tickets SET status = ?, updated_at = ? WHERE id = ?`, [
      'open',
      now,
      ticket.id,
    ]);
    return { ok: true, result: 'rejected' };
  }

  if (act === 'take_over') {
    await patchProposal(proposalId, {
      status: 'approved',
      reviewedBy: reviewer,
      reviewedAt: now,
      executionStatus: 'done',
    });
    await db.run(
      `UPDATE v2_support_tickets SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?`,
      ['escalated', reviewer, now, ticket.id]
    );
    return { ok: true, result: 'escalated' };
  }

  if (act === 'need_info') {
    if (proposal.proposalType !== 'bug_fix' && proposal.proposalType !== 'feature') {
      return { ok: false, status: 400, error: `Action need_info not valid for ${proposal.proposalType}` };
    }
    const body = buildNeedInfoMessage(proposal, ticket);
    await postAgentMessage(ticket.id, body, { status: 'waiting_user' });
    await emailUser(ticket, body);
    await patchProposal(proposalId, {
      status: 'needs_info',
      reviewedBy: reviewer,
      reviewedAt: now,
      executionStatus: 'done',
    });
    return { ok: true, result: 'needs_info' };
  }

  if (
    (proposal.proposalType === 'support_reply' || proposal.proposalType === 'escalation') &&
    (act === 'approve' || act === 'send_reply')
  ) {
    if (proposal.proposalType === 'escalation' && act === 'approve') {
      await patchProposal(proposalId, {
        status: 'approved',
        reviewedBy: reviewer,
        reviewedAt: now,
        executionStatus: 'done',
      });
      await db.run(
        `UPDATE v2_support_tickets SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?`,
        ['escalated', reviewer, now, ticket.id]
      );
      return { ok: true, result: 'escalated' };
    }
    return sendApprovedDraftReply(ticket, proposal, { reviewer, proposalId, now });
  }

  if ((proposal.proposalType === 'bug_fix' || proposal.proposalType === 'feature') && act === 'approve') {
    await patchProposal(proposalId, {
      status: 'approved',
      reviewedBy: reviewer,
      reviewedAt: now,
      executionStatus: 'queued',
    });
    const gh = await createSupportIssue(ticket, proposal);
    if (!gh.ok) {
      await patchProposal(proposalId, { executionStatus: 'failed' });
      return { ok: false, status: 502, error: gh.error || 'GitHub issue failed' };
    }
    await patchProposal(proposalId, {
      executionStatus: 'done',
      executionRef: gh.url,
    });
    await db.run(
      `UPDATE v2_support_tickets SET github_issue_url = ?, status = ?, updated_at = ? WHERE id = ?`,
      [gh.url, ticket.category === 'bug_report' ? 'waiting_user' : 'open', now, ticket.id]
    );
    notifyGithubIssueCreated(ticket, gh.url).catch(() => {});
    return { ok: true, result: 'github_issue', url: gh.url };
  }

  return { ok: false, status: 400, error: `Action ${action} not valid for ${proposal.proposalType}` };
}

module.exports = {
  executeProposalAction,
  postAgentMessage,
};
