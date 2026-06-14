const { executeProposalAction } = require('./proposalExecutor');
const { answerCallbackQuery, escapeHtml } = require('./telegramSupport');

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

async function handleTelegramUpdate(update) {
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

  const result = await executeProposalAction(parsed.proposalId, parsed.action, `telegram:${fromId}`);
  if (!result.ok) {
    await answerCallbackQuery(cb.id, result.error || 'Failed');
    return result;
  }

  let msg = 'Done';
  if (result.result === 'github_issue') msg = 'GitHub issue created';
  else if (result.result === 'reply_sent') msg = 'Reply sent to user';
  else if (result.result === 'rejected') msg = 'Proposal rejected';
  else if (result.result === 'needs_info') msg = 'Asked user for more info';
  else if (result.result === 'escalated') msg = 'Escalated to human';

  await answerCallbackQuery(cb.id, msg);
  return { ok: true, handled: true, ...result };
}

module.exports = {
  handleTelegramUpdate,
  isAllowedTelegramUser,
  parseCallbackData,
};
