/**
 * Transactional email via Resend (https://resend.com).
 * Falls back to console logging when RESEND_API_KEY is not configured so
 * dev/staging flows (e.g. password reset) remain testable without a key.
 * Never throws into callers — returns { sent: boolean }.
 */
const axios = require('axios');

const DEFAULT_FROM = 'Parley <no-reply@parley.app>';

async function sendEmail({ to, subject, text, html, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[mailer] RESEND_API_KEY not set — email not sent');
    console.log(
      '[mailer] Would have sent email:',
      JSON.stringify({ to, subject, attachments: (attachments || []).map((a) => a.filename) }, null, 2)
    );
    return { sent: false };
  }
  try {
    const res = await axios.post(
      'https://api.resend.com/emails',
      {
        from: process.env.MAIL_FROM || DEFAULT_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        // Resend attachment shape: [{ filename, content (base64) }]
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
