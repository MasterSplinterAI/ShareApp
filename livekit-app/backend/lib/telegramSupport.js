const axios = require('axios');

function telegramConfigured() {
  return Boolean(process.env.SUPPORT_TELEGRAM_BOT_TOKEN && process.env.SUPPORT_TELEGRAM_CHAT_ID);
}

function ticketPublicNumber(ticket) {
  return ticket.publicNumber ?? ticket.public_number;
}

async function sendTelegramMessage(text, { parseMode = 'HTML', disablePreview = true, replyMarkup = null } = {}) {
  const token = process.env.SUPPORT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SUPPORT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegramSupport] Telegram not configured — message skipped');
    return { ok: false, skipped: true };
  }
  try {
    const payload = {
      chat_id: chatId,
      text: String(text).slice(0, 4096),
      parse_mode: parseMode,
      disable_web_page_preview: disablePreview,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload, {
      timeout: 10000,
    });
    return { ok: true, messageId: res.data?.result?.message_id };
  } catch (e) {
    console.error('[telegramSupport] send failed:', e.response?.data || e.message);
    return { ok: false, error: e.message };
  }
}

async function answerCallbackQuery(callbackQueryId, text) {
  const token = process.env.SUPPORT_TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false };
  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      { callback_query_id: callbackQueryId, text: String(text || '').slice(0, 200), show_alert: false },
      { timeout: 5000 }
    );
    return { ok: true };
  } catch (e) {
    console.error('[telegramSupport] answerCallbackQuery failed:', e.message);
    return { ok: false };
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function adminTicketUrl(publicNumber) {
  const base = (process.env.PUBLIC_FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5174')
    .trim()
    .replace(/\/$/, '');
  return `${base}/v2/app/admin/support?ticket=${publicNumber}`;
}

function categoryEmoji(category) {
  if (category === 'bug_report') return '🐛';
  if (category === 'feature_request') return '💡';
  return '🆘';
}

function categoryLabel(category) {
  if (category === 'bug_report') return 'Bug report';
  if (category === 'feature_request') return 'Feature request';
  return 'Customer support';
}

function proposalTypeLabel(proposalType) {
  if (proposalType === 'bug_fix') return 'Bug triage';
  if (proposalType === 'feature') return 'Feature backlog';
  if (proposalType === 'support_reply') return 'CS reply approval';
  if (proposalType === 'escalation') return 'Escalation';
  return proposalType;
}

function proposalPreviewSnippet(proposal) {
  const b = proposal.body || {};
  if (proposal.proposalType === 'feature') {
    return b.problem_statement || b.proposed_mvp || b.backlog_recommendation || '';
  }
  if (proposal.proposalType === 'bug_fix') {
    return b.github_issue_title || b.root_cause_hypothesis || b.user_intent || '';
  }
  if (proposal.proposalType === 'escalation') {
    return b.draft_reply || b.reason || b.escalation_reason || '';
  }
  return b.draft_reply || b.github_issue_title || b.problem_statement || '';
}

function proposalKeyboard(proposal) {
  const id = proposal.id;
  if (proposal.proposalType === 'bug_fix') {
    return {
      inline_keyboard: [
        [
          { text: '✅ Approve → GitHub issue', callback_data: `prop:${id}:approve` },
          { text: '❌ Reject', callback_data: `prop:${id}:reject` },
        ],
        [{ text: '💬 Ask for repro details', callback_data: `prop:${id}:need_info` }],
      ],
    };
  }
  if (proposal.proposalType === 'feature') {
    return {
      inline_keyboard: [
        [
          { text: '✅ Approve backlog', callback_data: `prop:${id}:approve` },
          { text: '❌ Reject', callback_data: `prop:${id}:reject` },
        ],
        [{ text: '💬 Ask clarifying questions', callback_data: `prop:${id}:need_info` }],
      ],
    };
  }
  if (proposal.proposalType === 'support_reply') {
    return {
      inline_keyboard: [
        [
          { text: '✅ Send reply', callback_data: `prop:${id}:send_reply` },
          { text: '👤 Take over', callback_data: `prop:${id}:take_over` },
        ],
        [{ text: '❌ Reject', callback_data: `prop:${id}:reject` }],
      ],
    };
  }
  if (proposal.proposalType === 'escalation') {
    return {
      inline_keyboard: [
        [
          { text: '✅ Send draft to user', callback_data: `prop:${id}:send_reply` },
          { text: '👤 Take over', callback_data: `prop:${id}:take_over` },
        ],
        [{ text: '❌ Dismiss', callback_data: `prop:${id}:reject` }],
      ],
    };
  }
  return {
    inline_keyboard: [[{ text: '👤 Assign me', callback_data: `prop:${id}:take_over` }]],
  };
}

async function notifyNewTicket(ticket, { submitterEmail, preview } = {}) {
  const num = ticketPublicNumber(ticket);
  const emoji = categoryEmoji(ticket.category);
  const label = categoryLabel(ticket.category);
  const lines = [
    `${emoji} <b>New ticket #${num}</b> — ${label}`,
    ticket.subject ? `<b>Subject:</b> ${escapeHtml(ticket.subject)}` : null,
    submitterEmail
      ? `<b>From:</b> ${escapeHtml(submitterEmail)}`
      : ticket.guestEmail || ticket.guest_email
        ? `<b>Guest:</b> ${escapeHtml(ticket.guestEmail || ticket.guest_email)}`
        : null,
    ticket.severity ? `<b>Severity:</b> ${escapeHtml(ticket.severity)}` : null,
    ticket.priority ? `<b>Priority:</b> ${escapeHtml(ticket.priority)}` : null,
    preview ? `\n${escapeHtml(preview.slice(0, 500))}${preview.length > 500 ? '…' : ''}` : null,
    `\n<a href="${adminTicketUrl(num)}">Open in admin</a>`,
  ].filter(Boolean);
  return sendTelegramMessage(lines.join('\n'));
}

async function notifyStaffReply(ticket, preview) {
  const num = ticketPublicNumber(ticket);
  return sendTelegramMessage(
    `💬 <b>Reply sent</b> on ticket #${num}\n${escapeHtml(preview.slice(0, 300))}`
  );
}

async function notifyUserMessage(ticket, preview) {
  const num = ticketPublicNumber(ticket);
  return sendTelegramMessage(
    `📩 <b>User replied</b> on ticket #${num}\n${escapeHtml(preview.slice(0, 400))}\n<a href="${adminTicketUrl(num)}">Open in admin</a>`
  );
}

async function notifyProposalReady(ticket, proposal) {
  const num = ticketPublicNumber(ticket);
  const conf =
    typeof proposal.confidence === 'number'
      ? `\n<b>Confidence:</b> ${Math.round(proposal.confidence * 100)}%`
      : '';
  const draft = proposalPreviewSnippet(proposal);
  const typeLabel = proposalTypeLabel(proposal.proposalType);
  const catLabel = categoryLabel(ticket.category);
  const lines = [
    `🤖 <b>AI proposal</b> — ticket #${num}`,
    `<b>Category:</b> ${escapeHtml(catLabel)} · <b>Action:</b> ${escapeHtml(typeLabel)}`,
    `<b>Summary:</b> ${escapeHtml(proposal.summary)}${conf}`,
    draft ? `\n${escapeHtml(String(draft).slice(0, 600))}${String(draft).length > 600 ? '…' : ''}` : null,
    `\n<a href="${adminTicketUrl(num)}">Open in admin</a>`,
  ].filter(Boolean);

  const result = await sendTelegramMessage(lines.join('\n'), {
    replyMarkup: proposalKeyboard(proposal),
  });

  if (result.ok && result.messageId) {
    const { patchProposal } = require('./supportProposals');
    await patchProposal(proposal.id, { telegramMessageId: String(result.messageId) });
  }
  return result;
}

async function notifyGithubIssueCreated(ticket, issueUrl) {
  const num = ticketPublicNumber(ticket);
  return sendTelegramMessage(
    `🔗 <b>GitHub issue created</b> for ticket #${num}\n<a href="${escapeHtml(issueUrl)}">${escapeHtml(issueUrl)}</a>`
  );
}

module.exports = {
  telegramConfigured,
  sendTelegramMessage,
  answerCallbackQuery,
  notifyNewTicket,
  notifyStaffReply,
  notifyUserMessage,
  notifyProposalReady,
  notifyGithubIssueCreated,
  adminTicketUrl,
  escapeHtml,
  ticketPublicNumber,
};
