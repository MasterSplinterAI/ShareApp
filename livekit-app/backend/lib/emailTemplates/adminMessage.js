const { renderEmailLayout } = require('./layout');
const { nl2br } = require('./escape');

function renderAdminMessage({ subject, body }) {
  const trimmedSubject = String(subject || '').trim().slice(0, 200);
  const trimmedBody = String(body || '').trim();
  const text = trimmedBody;
  const html = renderEmailLayout({
    preheader: trimmedSubject,
    title: trimmedSubject,
    introHtml: `<div style="margin:0;">${nl2br(trimmedBody)}</div>`,
    footerNote: 'This message was sent by the Lalia team.',
  });
  return { subject: trimmedSubject, text, html };
}

module.exports = { renderAdminMessage };
