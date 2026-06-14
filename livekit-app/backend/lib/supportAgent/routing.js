const ESCALATION_KEYWORDS = [
  'refund',
  'chargeback',
  'billing dispute',
  'invoice dispute',
  'lawyer',
  'legal action',
  'delete my data',
  'gdpr',
  'subpoena',
  'harassment',
  'speak to a human',
  'talk to a person',
  'real person',
  'human support',
  'account hacked',
];

function minConfidence() {
  const n = parseFloat(process.env.SUPPORT_AI_AUTO_REPLY_MIN_CONF || '0.85', 10);
  return Number.isFinite(n) ? n : 0.85;
}

function inAppReplyEnabled() {
  return process.env.SUPPORT_AI_IN_APP_REPLY !== 'false';
}

function containsEscalationSignal(text) {
  const lower = String(text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function inferRoute(parsed) {
  if (parsed.route) return parsed.route;
  if (parsed.proposal_type === 'escalation') return 'escalate';
  if (parsed.proposal_type === 'bug_fix' || parsed.proposal_type === 'feature') return 'propose_reply';
  return 'propose_reply';
}

function decideCustomerSupportAction(parsed, { thread, docHits }) {
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const route = inferRoute(parsed);
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
  const draft = body.draft_reply;

  if (containsEscalationSignal(thread) || containsEscalationSignal(body.escalation_reason)) {
    return { action: 'proposal', proposalType: 'escalation', notifyTelegram: true };
  }

  if (route === 'close') {
    return { action: 'close', draftReply: draft || null, notifyTelegram: false };
  }

  if (route === 'escalate' || parsed.proposal_type === 'escalation') {
    return { action: 'proposal', proposalType: 'escalation', notifyTelegram: true };
  }

  if (
    inAppReplyEnabled() &&
    route === 'reply_in_app' &&
    draft &&
    confidence >= minConfidence() &&
    (docHits.length > 0 || confidence >= 0.92)
  ) {
    return { action: 'reply_in_app', draftReply: draft, notifyTelegram: false };
  }

  return {
    action: 'proposal',
    proposalType: 'support_reply',
    notifyTelegram: true,
  };
}

function shouldNotifyOpsOnNewTicket(ticket, { aiEnabled }) {
  if (ticket.category === 'customer_support') return false;
  if (aiEnabled) return false;
  return true;
}

function shouldNotifyOpsOnUserMessage(ticket) {
  if (ticket.category === 'customer_support') {
    return ticket.status === 'escalated' || ticket.status === 'pending_review';
  }
  return ticket.status === 'escalated' || ticket.status === 'pending_review';
}

module.exports = {
  decideCustomerSupportAction,
  shouldNotifyOpsOnNewTicket,
  shouldNotifyOpsOnUserMessage,
  containsEscalationSignal,
};
