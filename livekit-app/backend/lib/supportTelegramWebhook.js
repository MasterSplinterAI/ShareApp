const { executeProposalAction } = require('./proposalExecutor');
const { getProposalById, patchProposal } = require('./supportProposals');
const { postStaffReply, getTicketById } = require('./supportTickets');
const {
  answerCallbackQuery,
  escapeHtml,
  sendTelegramMessage,
  notifyStaffReply,
  getDraftSeedForProposal,
} = require('./telegramSupport');
const {
  startDraftSession,
  getDraftSession,
  clearDraftSession,
} = require('./telegramDraftSessions');

function parseAllowedUserIds() {
  const raw = process.env.SUPPORT_TELEGRAM_ALLOWED_USER_IDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedTelegramUser(userId) {
  const allowed = parseAllowedUserIds();
  if (allowed.length === 0) return true;
  return allowed.includes(String(userId));
}

function parseCallbackData(data) {
  if (!data || !data.startsWith('prop:')) return null;
  const parts = data.split(':');
  if (parts.length < 3) return null;
  return { proposalId: parts[1], action: parts.slice(2).join(':') };
}

async function startTelegramDraftReply(proposalId, telegramUserId, callbackQueryId) {
  const proposal = await getProposalById(proposalId);
  if (!proposal) {
    await answerCallbackQuery(callbackQueryId, 'Proposal not found');
    return { ok: false, status: 404, error: 'Proposal not found' };
  }
  if (proposal.status !== 'pending_review') {
    await answerCallbackQuery(callbackQueryId, `Proposal already ${proposal.status}`);
    return { ok: false, status: 409, error: `Proposal already ${proposal.status}` };
  }

  const ticket = await getTicketById(proposal.ticketId);
  if (!ticket) {
    await answerCallbackQuery(callbackQueryId, 'Ticket not found');
    return { ok: false, status: 404, error: 'Ticket not found' };
  }

  startDraftSession(telegramUserId, {
    proposalId: proposal.id,
    ticketId: ticket.id,
    publicNumber: ticket.publicNumber,
  });

  const seed = getDraftSeedForProposal(proposal);
  const conf =
    typeof proposal.confidence === 'number'
      ? `\n<b>AI confidence:</b> ${Math.round(proposal.confidence * 100)}%`
      : '';
  const lines = [
    `✏️ <b>Draft reply</b> — ticket #${ticket.publicNumber}${conf}`,
    'Reply to this chat with the message the user should see in Help.',
    seed
      ? `\n<b>AI starting point:</b>\n${escapeHtml(String(seed).slice(0, 1200))}${String(seed).length > 1200 ? '…' : ''}`
      : '\nWrite your reply from scratch.',
    '\nSend /cancel to abort.',
  ];

  await sendTelegramMessage(lines.join('\n'), {
    replyMarkup: {
      force_reply: true,
      input_field_placeholder: 'Your reply to the user…',
    },
  });

  await answerCallbackQuery(callbackQueryId, 'Reply in chat with your draft');
  return { ok: true, handled: true, result: 'draft_started' };
}

async function submitTelegramDraftReply(telegramUserId, text) {
  const session = getDraftSession(telegramUserId);
  if (!session) return { ok: false, handled: false };

  const body = String(text || '').trim();
  if (!body) {
    await sendTelegramMessage('Reply cannot be empty. Send your message or /cancel.');
    return { ok: false, handled: true, error: 'Empty reply' };
  }

  const proposal = session.proposalId ? await getProposalById(session.proposalId) : null;
  const staffLabel = `telegram:${telegramUserId}`;
  const result = await postStaffReply(session.ticketId, body, staffLabel);
  if (!result.ok) {
    await sendTelegramMessage(`Could not send reply: ${escapeHtml(result.error || 'Failed')}`);
    return result;
  }

  if (proposal?.status === 'pending_review') {
    const now = new Date().toISOString();
    await patchProposal(proposal.id, {
      status: 'approved',
      reviewedBy: staffLabel,
      reviewedAt: now,
      executionStatus: 'done',
    });
  }

  clearDraftSession(telegramUserId);
  await notifyStaffReply(result.ticket, body).catch(() => {});
  await sendTelegramMessage(
    `✅ <b>Reply sent</b> to ticket #${session.publicNumber}\n${escapeHtml(body.slice(0, 500))}${body.length > 500 ? '…' : ''}`
  );
  return { ok: true, handled: true, result: 'draft_sent' };
}

async function cancelTelegramDraft(telegramUserId) {
  const session = getDraftSession(telegramUserId);
  if (!session) {
    await sendTelegramMessage('No draft in progress.');
    return { ok: true, handled: true, result: 'no_draft' };
  }
  clearDraftSession(telegramUserId);
  await sendTelegramMessage(`Draft cancelled for ticket #${session.publicNumber}.`);
  return { ok: true, handled: true, result: 'draft_cancelled' };
}

async function handleTelegramMessage(message) {
  const fromId = message.from?.id;
  if (!fromId || !isAllowedTelegramUser(fromId)) {
    return { ok: false, handled: false, error: 'Unauthorized Telegram user' };
  }

  const text = message.text?.trim();
  if (!text) return { ok: true, handled: false };

  if (text === '/cancel' || text.toLowerCase() === 'cancel') {
    return cancelTelegramDraft(fromId);
  }

  const session = getDraftSession(fromId);
  if (!session) return { ok: true, handled: false };

  return submitTelegramDraftReply(fromId, text);
}

async function handleTelegramUpdate(update) {
  if (update.message) {
    return handleTelegramMessage(update.message);
  }

  const cb = update.callback_query;
  if (!cb) return { ok: true, handled: false };

  const fromId = cb.from?.id;
  if (!isAllowedTelegramUser(fromId)) {
    await answerCallbackQuery(cb.id, 'Not authorized');
    return { ok: false, error: 'Unauthorized Telegram user' };
  }

  const parsed = parseCallbackData(cb.data);
  if (!parsed) {
    await answerCallbackQuery(cb.id, 'Unknown action');
    return { ok: false, error: 'Invalid callback_data' };
  }

  if (parsed.action === 'draft_reply') {
    return startTelegramDraftReply(parsed.proposalId, fromId, cb.id);
  }

  clearDraftSession(fromId);

  const result = await executeProposalAction(parsed.proposalId, parsed.action, `telegram:${fromId}`);
  if (!result.ok) {
    await answerCallbackQuery(cb.id, result.error || 'Failed');
    return result;
  }

  let msg = 'Done';
  if (result.result === 'github_issue') {
    msg = parsed.action === 'approve' ? 'GitHub issue created' : 'Done';
  } else if (result.result === 'reply_sent') msg = 'Reply sent to user';
  else if (result.result === 'rejected') msg = 'Proposal rejected';
  else if (result.result === 'needs_info') msg = 'Clarifying questions sent to user';
  else if (result.result === 'escalated') msg = 'Escalated to human';

  await answerCallbackQuery(cb.id, msg);
  return { ok: true, handled: true, ...result };
}

module.exports = {
  handleTelegramUpdate,
  handleTelegramMessage,
  isAllowedTelegramUser,
  parseCallbackData,
  startTelegramDraftReply,
};
