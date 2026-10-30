/**
 * Resend inbound (receiving) API helpers.
 */
const axios = require('axios');
const { getEmailSettings } = require('./v2EmailSettings');

async function resendApiKey() {
  const settings = await getEmailSettings();
  return settings.resendApiKey || process.env.RESEND_API_KEY || null;
}

async function fetchReceivedEmail(emailId) {
  const apiKey = await resendApiKey();
  if (!apiKey) throw new Error('Resend API key not configured');

  const res = await axios.get(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 15000,
  });
  return res.data;
}

async function listReceivedAttachments(emailId) {
  const apiKey = await resendApiKey();
  if (!apiKey) throw new Error('Resend API key not configured');

  const res = await axios.get(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    }
  );
  return res.data?.data || [];
}

async function downloadAttachmentText(downloadUrl) {
  const res = await axios.get(downloadUrl, {
    responseType: 'text',
    timeout: 30000,
    transformResponse: [(d) => d],
  });
  return typeof res.data === 'string' ? res.data : String(res.data || '');
}

module.exports = {
  fetchReceivedEmail,
  listReceivedAttachments,
  downloadAttachmentText,
};
