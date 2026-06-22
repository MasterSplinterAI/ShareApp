const { escapeHtml } = require('./escape');

/**
 * Table-based HTML layout for broad email client support.
 */
function renderEmailLayout({
  preheader = '',
  title,
  introHtml = '',
  detailRows = [],
  ctaUrl,
  ctaLabel,
  secondaryHtml = '',
  footerNote = 'You received this email because of activity on your Parley account or a meeting you were invited to.',
}) {
  const detailsBlock =
    detailRows.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:20px 0 0;border-collapse:collapse;">
          ${detailRows
            .map(
              (row) => `<tr>
                <td style="padding:8px 0;font-size:13px;line-height:1.5;color:#64748b;width:96px;vertical-align:top;">${escapeHtml(row.label)}</td>
                <td style="padding:8px 0;font-size:14px;line-height:1.5;color:#0f172a;vertical-align:top;">${row.valueHtml || escapeHtml(row.value)}</td>
              </tr>`
            )
            .join('')}
        </table>`
      : '';

  const ctaBlock =
    ctaUrl && ctaLabel
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
          <tr>
            <td style="border-radius:10px;background:#2563eb;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">Or copy this link: <a href="${escapeHtml(ctaUrl)}" style="color:#2563eb;">${escapeHtml(ctaUrl)}</a></p>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(title)}</title>
  <style>
    @media (prefers-color-scheme: dark) {
      .email-bg { background:#0f172a !important; }
      .email-card { background:#1e293b !important; border-color:#334155 !important; }
      .email-title, .email-body { color:#f8fafc !important; }
      .email-muted { color:#94a3b8 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="padding:0 0 16px;text-align:center;">
              <span style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">Parley</span>
            </td>
          </tr>
          <tr>
            <td class="email-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px 28px;box-shadow:0 10px 30px rgba(15,23,42,0.06);">
              <h1 class="email-title" style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:#0f172a;">${escapeHtml(title)}</h1>
              ${introHtml ? `<div class="email-body" style="font-size:15px;line-height:1.65;color:#334155;">${introHtml}</div>` : ''}
              ${detailsBlock}
              ${ctaBlock}
              ${secondaryHtml ? `<div style="margin-top:24px;font-size:14px;line-height:1.65;color:#475569;">${secondaryHtml}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td class="email-muted" style="padding:20px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:#64748b;">
              ${escapeHtml(footerNote)}<br />
              <a href="mailto:hello@parley.app" style="color:#2563eb;text-decoration:none;">hello@parley.app</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderEmailLayout };
