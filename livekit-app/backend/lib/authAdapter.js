/**
 * Provider-agnostic auth adapter (local email/password).
 * Swap implementation later without changing route handlers.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET_V2 || process.env.JWT_SECRET || 'change-me-in-production-v2';
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
