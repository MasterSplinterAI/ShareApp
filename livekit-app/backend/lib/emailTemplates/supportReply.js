const { renderEmailLayout } = require('./layout');
const { escapeHtml, nl2br } = require('./escape');

function renderSupportReply({ body, ticketNumber, ticketSubject }) {
  const subject = `Re: Parley support #${ticketNumber} — ${ticketSubject || 'your request'}`;
  const text = `${body}\n\n— Parley Support\n\nReply from the app: Help → My requests (ticket #${ticketNumber}).`;
  const html = renderEmailLayout({
    preheader: `Reply to your Parley support request #${ticketNumber}.`,
    title: `Support reply · #${ticketNumber}`,
    introHtml: `<div style="margin:0;">${nl2br(body)}</div>`,
    secondaryHtml: `<p style="margin:0;">— Parley Support</p><p style="margin:8px 0 0;font-size:13px;color:#64748b;">Reply from the app: <strong>Help → My requests</strong> (ticket #${escapeHtml(String(ticketNumber))}).</p>`,
    footerNote: 'This message is about your Parley support request.',
  });
  return { subject, text, html };
}

module.exports = { renderSupportReply };
