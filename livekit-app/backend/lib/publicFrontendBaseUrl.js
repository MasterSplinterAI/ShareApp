function httpOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** Public browser origin for join and share links, including emailed invitations. */
function publicFrontendBaseUrl(req) {
  const production = process.env.NODE_ENV === 'production';
  if (!production) {
    const requestOrigin = httpOrigin(req?.headers?.origin) || httpOrigin(req?.headers?.referer);
    if (requestOrigin) return requestOrigin;
  }

  // Production links may carry invitation tokens. Use trusted configuration, even
  // when the request comes from a mobile WebView or supplies a different origin.
  for (const value of [process.env.PUBLIC_FRONTEND_BASE_URL, process.env.FRONTEND_URL,
    process.env.PRODUCTION_URL, process.env.STAGING_FRONTEND_URL]) {
    const configured = value?.trim();
    if (!configured) continue;
    const url = /^[a-z][a-z\d+.-]*:\/\//i.test(configured) ? configured : `https://${configured}`;
    const origin = httpOrigin(url);
    if (origin) return origin;
  }

  return production ? 'https://lalia.cloud' : 'http://localhost:5174';
}

module.exports = { publicFrontendBaseUrl };
