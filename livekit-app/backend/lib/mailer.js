/**
 * Transactional email via Resend (https://resend.com).
 * API key and from-address can be set in admin console or via env.
 * Falls back to console logging when not configured.
 * Never throws into callers — returns { sent: boolean }.
 */
const axios = require('axios');
const { getEmailSettings, DEFAULT_FROM } = require('./v2EmailSettings');

async function sendEmail({ to, subject, text, html, attachments, cc }) {
  const settings = await getEmailSettings();
  const apiKey = settings.resendApiKey;
  const from = settings.mailFrom || DEFAULT_FROM;

  if (!settings.emailEnabled || !apiKey) {
    console.warn('[mailer] Email delivery not configured — email not sent');
    console.log(
      '[mailer] Would have sent email:',
      JSON.stringify(
        { to, cc, subject, from, attachments: (attachments || []).map((a) => a.filename) },
        null,
        2
      )
    );
    return { sent: false };
  }
  try {
    const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : [];
    const res = await axios.post(
      'https://api.resend.com/emails',
      {
        from,
        to: Array.isArray(to) ? to : [to],
        ...(ccList.length ? { cc: ccList } : {}),
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        ...(attachments?.length ? { attachments } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return { sent: true, id: res.data?.id };
  } catch (e) {
    console.error('[mailer] Failed to send email:', e.response?.data || e.message);
    return { sent: false, error: e.response?.data?.message || e.message };
  }
}

module.exports = { sendEmail };
