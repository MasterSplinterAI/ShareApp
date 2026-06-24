const crypto = require('crypto');

function verifySvixWebhook(rawBody, headers, secret) {
  if (!secret) return { ok: false, reason: 'missing_secret' };

  const msgId = headers['svix-id'];
  const msgTimestamp = headers['svix-timestamp'];
  const msgSignature = headers['svix-signature'];

  if (!msgId || !msgTimestamp || !msgSignature) {
    return { ok: false, reason: 'missing_headers' };
  }

  const ts = parseInt(msgTimestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return { ok: false, reason: 'timestamp_skew' };

  const secretKey = String(secret).startsWith('whsec_') ? secret.slice(6) : secret;
  let secretBytes;
  try {
    secretBytes = Buffer.from(secretKey, 'base64');
  } catch {
    return { ok: false, reason: 'bad_secret' };
  }

  const signedContent = `${msgId}.${msgTimestamp}.${rawBody}`;
  const expectedSig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  for (const sig of String(msgSignature).split(' ')) {
    if (!sig.startsWith('v1,')) continue;
    const provided = sig.slice(3);
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(expectedSig);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: true };
      }
    } catch {
      /* continue */
    }
  }

  return { ok: false, reason: 'sig_mismatch' };
}

module.exports = { verifySvixWebhook };
