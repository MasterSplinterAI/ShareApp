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
  'account hacked',
];

const DEFAULT_HOLD_REPLY =
  "Thanks for your patience — I'm still looking into this. If I can't resolve it here, a teammate will follow up in this same chat.";

const DEFAULT_ESCALATION_REPLY =
  "I've shared this with our team for a closer look. You'll see updates here — we typically respond within one business day.";

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

function userFacingReply(parsed, { proposalType } = {}) {
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
  if (body.draft_reply) return String(body.draft_reply).slice(0, 8000);
  if (proposalType === 'escalation' || parsed.proposal_type === 'escalation') {
    return DEFAULT_ESCALATION_REPLY;
  }
  return DEFAULT_HOLD_REPLY;
}

function decideCustomerSupportAction(parsed, { thread, docHits }) {
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const route = inferRoute(parsed);
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : parsed;
  const draft = body.draft_reply;

  if (containsEscalationSignal(thread) || containsEscalationSignal(body.escalation_reason)) {
    return {
      action: 'proposal',
      proposalType: 'escalation',
      notifyTelegram: true,
      userReply: userFacingReply(parsed, { proposalType: 'escalation' }),
    };
  }

  if (route === 'close') {
    return { action: 'close', draftReply: draft || null, notifyTelegram: false };
  }

  if (route === 'escalate' || parsed.proposal_type === 'escalation') {
    return {
      action: 'proposal',
      proposalType: 'escalation',
      notifyTelegram: true,
      userReply: userFacingReply(parsed, { proposalType: 'escalation' }),
    };
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
    userReply: userFacingReply(parsed, { proposalType: 'support_reply' }),
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

function submitAckMessage(category, publicNumber) {
  if (category === 'customer_support') {
    return 'Thanks for your message — give me a moment while I read it…';
  }
  if (category === 'bug_report') {
    return `Your bug report #${publicNumber} is submitted. I'm reviewing the details now — you'll see updates in this chat.`;
  }
  if (category === 'feature_request') {
    return `Your feature request #${publicNumber} is submitted. Our team will review it — track progress here in this chat.`;
  }
  return `Ticket #${publicNumber} received. We'll update you here.`;
}

module.exports = {
  decideCustomerSupportAction,
  shouldNotifyOpsOnNewTicket,
  shouldNotifyOpsOnUserMessage,
  containsEscalationSignal,
  userFacingReply,
  submitAckMessage,
  DEFAULT_HOLD_REPLY,
};
