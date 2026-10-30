/**
 * Short-lived HMAC tokens scoping quality-event posts to a meeting.
 * Format: <meetingId>.<expUnix>.<sigBase64url>
 */
const crypto = require('crypto');

function hmacSecret() {
  const secret = process.env.JWT_SECRET_V2 || process.env.JWT_SECRET || '';
  const trimmed = String(secret).trim();
  if (!trimmed) {
    throw new Error('JWT_SECRET_V2 required to mint quality event tokens');
  }
  return trimmed;
}

function mintMeetingQualityToken(meetingId, { ttlSec = 12 * 3600 } = {}) {
  if (!meetingId) throw new Error('meetingId required');
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSec) || 43200);
  const body = `${String(meetingId)}.${exp}`;
  const sig = crypto.createHmac('sha256', hmacSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyMeetingQualityToken(token, meetingId) {
  if (!token || typeof token !== 'string' || !meetingId) {
    return { ok: false, reason: 'missing' };
  }
  const parts = token.trim().split('.');
  if (parts.length < 3) return { ok: false, reason: 'malformed' };
  const sig = parts.pop();
  const expStr = parts.pop();
  const id = parts.join('.');
  if (id !== String(meetingId)) return { ok: false, reason: 'meeting_mismatch' };
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  const body = `${id}.${exp}`;
  const expected = crypto.createHmac('sha256', hmacSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true, exp };
}

module.exports = {
  mintMeetingQualityToken,
  verifyMeetingQualityToken,
};
