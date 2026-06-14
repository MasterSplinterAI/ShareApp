const axios = require('axios');

function telegramConfigured() {
  return Boolean(process.env.SUPPORT_TELEGRAM_BOT_TOKEN && process.env.SUPPORT_TELEGRAM_CHAT_ID);
}

async function sendTelegramMessage(text, { parseMode = 'HTML', disablePreview = true } = {}) {
  const token = process.env.SUPPORT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SUPPORT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[telegramSupport] Telegram not configured — message skipped');
    return { ok: false, skipped: true };
  }
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: String(text).slice(0, 4096),
        parse_mode: parseMode,
        disable_web_page_preview: disablePreview,
      },
      { timeout: 10000 }
    );
    return { ok: true, messageId: res.data?.result?.message_id };
  } catch (e) {
    console.error('[telegramSupport] send failed:', e.response?.data || e.message);
    return { ok: false, error: e.message };
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
  return `${base}/v2/app/superadmin?tab=support&ticket=${publicNumber}`;
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

async function notifyNewTicket(ticket, { submitterEmail, preview } = {}) {
  const emoji = categoryEmoji(ticket.category);
  const label = categoryLabel(ticket.category);
  const lines = [
    `${emoji} <b>New ticket #${ticket.public_number}</b> — ${label}`,
    ticket.subject ? `<b>Subject:</b> ${escapeHtml(ticket.subject)}` : null,
    submitterEmail ? `<b>From:</b> ${escapeHtml(submitterEmail)}` : ticket.guest_email ? `<b>Guest:</b> ${escapeHtml(ticket.guest_email)}` : null,
    ticket.severity ? `<b>Severity:</b> ${escapeHtml(ticket.severity)}` : null,
    ticket.priority ? `<b>Priority:</b> ${escapeHtml(ticket.priority)}` : null,
    preview ? `\n${escapeHtml(preview.slice(0, 500))}${preview.length > 500 ? '…' : ''}` : null,
    `\n<a href="${adminTicketUrl(ticket.public_number)}">Open in admin</a>`,
  ].filter(Boolean);
  return sendTelegramMessage(lines.join('\n'));
}

async function notifyStaffReply(ticket, preview) {
  return sendTelegramMessage(
    `💬 <b>Reply sent</b> on ticket #${ticket.public_number}\n${escapeHtml(preview.slice(0, 300))}`
  );
}

async function notifyUserMessage(ticket, preview) {
  return sendTelegramMessage(
    `📩 <b>User replied</b> on ticket #${ticket.public_number}\n${escapeHtml(preview.slice(0, 400))}\n<a href="${adminTicketUrl(ticket.public_number)}">Open in admin</a>`
  );
}

module.exports = {
  telegramConfigured,
  sendTelegramMessage,
  notifyNewTicket,
  notifyStaffReply,
  notifyUserMessage,
  adminTicketUrl,
  escapeHtml,
};
