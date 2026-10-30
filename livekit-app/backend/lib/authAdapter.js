/**
 * Provider-agnostic auth adapter (local email/password).
 * Swap implementation later without changing route handlers.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const WEAK_SECRETS = new Set([
  'change-me-in-production-v2',
  'change-me-in-production',
  'change-me',
  'changeme',
  'secret',
  'password',
  'jwt-secret',
  'jwt_secret',
  'your-secret-here',
  'replace-with-long-random-string',
  'dev-secret',
  'development',
  'test',
  'test-secret',
  'xxxx',
  'xxxxxxxx',
]);

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET_V2 || process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    throw new Error('[auth] JWT_SECRET_V2 is required — set a strong random secret');
  }
  const trimmed = String(secret).trim();
  if (WEAK_SECRETS.has(trimmed) || WEAK_SECRETS.has(trimmed.toLowerCase())) {
    throw new Error('[auth] JWT_SECRET_V2 must not use a placeholder value');
  }
  if (process.env.NODE_ENV === 'production' && trimmed.length < 32) {
    throw new Error('[auth] JWT_SECRET_V2 must be at least 32 characters in production');
  }
  return trimmed;
}

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES = process.env.JWT_EXPIRES_V2 || '7d';

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signSession(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signSession,
  verifyToken,
};
