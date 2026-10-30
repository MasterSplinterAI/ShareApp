/**
 * AES-256-GCM helpers for platform secrets stored in SQLite.
 * Key material is derived from JWT_SECRET_V2 (or JWT_SECRET / SETTINGS_ENCRYPTION_KEY).
 * Ciphertext format: enc:v1:<iv_b64>:<tag_b64>:<ct_b64>
 */
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function resolveKeyMaterial() {
  const raw =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.JWT_SECRET_V2 ||
    process.env.JWT_SECRET ||
    '';
  const trimmed = String(raw).trim();
  if (!trimmed) {
    throw new Error('SETTINGS_ENCRYPTION_KEY or JWT_SECRET_V2 required to encrypt secrets');
  }
  return crypto.createHash('sha256').update(trimmed).digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const text = String(plaintext);
  if (isEncrypted(text)) return text;
  const key = resolveKeyMaterial();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!isEncrypted(text)) return text;
  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [ivB64, tagB64, ctB64] = parts;
  const key = resolveKeyMaterial();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function maskSecret(value, { keepStart = 4, keepEnd = 4 } = {}) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= keepStart + keepEnd) return '••••••••';
  return `${'•'.repeat(8)}${value.slice(-keepEnd)}`;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  maskSecret,
  PREFIX,
};
