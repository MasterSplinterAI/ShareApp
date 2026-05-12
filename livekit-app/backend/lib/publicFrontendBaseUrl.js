/**
 * Public browser origin for join/share links (scheme + host + port only).
 * Avoids using a full Referer path (e.g. /v2/app/meetings/...) as the "base".
 */
function publicFrontendBaseUrl(req) {
  const fromString = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    const t = raw.trim();
    if (!t) return '';
    try {
      const u = new URL(t);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  };

  const o = fromString(req.headers.origin);
  if (o) return o;

  const r = fromString(req.headers.referer);
  if (r) return r;

  const envRaw = (
    process.env.FRONTEND_URL ||
    process.env.STAGING_FRONTEND_URL ||
    process.env.PRODUCTION_URL ||
    ''
  ).trim();
  if (envRaw) {
    const withScheme = /^https?:\/\//i.test(envRaw) ? envRaw : `https://${envRaw}`;
    const b = fromString(withScheme);
    if (b) return b;
  }

  return 'http://localhost:5174';
}

module.exports = { publicFrontendBaseUrl };
