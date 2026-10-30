const crypto = require('crypto');
const path = require('path');
const { deleteOrgObject } = require('./objectStorage');

const WELCOME_MAX = 200;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DEFAULT_ACCENT = '#2563eb';

function normalizeAccentColor(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(s)) return null;
  return s.toLowerCase();
}

function normalizeWelcomeMessage(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, WELCOME_MAX);
}

function hostDisplayLabel(org, hostUser) {
  if (!org) return null;
  if (org.account_type === 'team') return org.name || null;
  return hostUser?.display_name || org.name || null;
}

const LOGO_EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function brandingRelativePath(fileName) {
  if (!fileName) return null;
  return `branding/${path.basename(fileName)}`;
}

/** Unique object name so a replacement is a different public URL. */
function newLogoFileName(mime) {
  const ext = LOGO_EXT_BY_MIME[mime] || '.png';
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  return `logo-${id}${ext}`;
}

function publicLogoUrl(req, orgId, logoFile) {
  if (!logoFile || !orgId) return null;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  const version = encodeURIComponent(path.basename(String(logoFile)));
  const pathPart = `/api/v2/branding/${encodeURIComponent(orgId)}/logo?v=${version}`;
  if (!host) return pathPart;
  return `${proto}://${host}${pathPart}`;
}

function serializePublicBranding(req, org, hostUser) {
  if (!org) return null;
  const configured = Boolean(
    org.brand_logo_file ||
    org.brand_welcome_message ||
    normalizeAccentColor(org.brand_accent_color)
  );
  if (!configured) return null;
  const accent = normalizeAccentColor(org.brand_accent_color) || DEFAULT_ACCENT;
  const welcome = org.brand_welcome_message || null;
  const logoUrl = publicLogoUrl(req, org.id, org.brand_logo_file);
  const hostName = hostDisplayLabel(org, hostUser);
  return {
    accentColor: accent,
    logoUrl,
    welcomeMessage: welcome,
    hostName,
  };
}

async function removeLogoFile(orgId, fileName) {
  if (!fileName) return;
  try {
    await deleteOrgObject(orgId, brandingRelativePath(fileName));
  } catch {
    /* best effort */
  }
}

module.exports = {
  WELCOME_MAX,
  LOGO_MAX_BYTES,
  LOGO_MIME,
  DEFAULT_ACCENT,
  normalizeAccentColor,
  normalizeWelcomeMessage,
  hostDisplayLabel,
  brandingRelativePath,
  newLogoFileName,
  publicLogoUrl,
  serializePublicBranding,
  removeLogoFile,
};
