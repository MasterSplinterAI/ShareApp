const { renderEmailLayout } = require('./layout');
const { escapeHtml } = require('./escape');

function renderPasswordReset({ resetUrl, initiatedBy }) {
  const initiated = initiatedBy
    ? ` (requested by ${initiatedBy})`
    : '';
  const subject = 'Reset your Parley password';
  const text = `We received a request to reset your Parley password${initiated}.\n\nReset it here (link expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  const html = renderEmailLayout({
    preheader: 'Use this link to choose a new Parley password.',
    title: 'Reset your password',
    introHtml: `<p style="margin:0 0 12px;">We received a request to reset your Parley password${escapeHtml(initiated)}.</p><p style="margin:0;">This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>`,
    ctaUrl: resetUrl,
    ctaLabel: 'Reset password',
    footerNote: 'If you did not request a password reset, no action is needed.',
  });
  return { subject, text, html };
}

module.exports = { renderPasswordReset };
