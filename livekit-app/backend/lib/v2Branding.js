const path = require('path');
const fs = require('fs');

const WELCOME_MAX = 200;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DEFAULT_ACCENT = '#2563eb';

function brandingDir(orgId) {
  const base = path.join(__dirname, '..', 'uploads', 'v2', orgId, 'branding');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

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

function brandingLogoPath(orgId, fileName) {
  if (!fileName) return null;
  const safe = path.basename(fileName);
  const full = path.join(brandingDir(orgId), safe);
  if (!full.startsWith(brandingDir(orgId))) return null;
  return full;
}

function publicLogoUrl(req, orgId, hasLogo) {
  if (!hasLogo || !orgId) return null;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return `/api/v2/branding/${encodeURIComponent(orgId)}/logo`;
  return `${proto}://${host}/api/v2/branding/${encodeURIComponent(orgId)}/logo`;
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
  const logoUrl = publicLogoUrl(req, org.id, Boolean(org.brand_logo_file));
  const hostName = hostDisplayLabel(org, hostUser);
  return {
    accentColor: accent,
    logoUrl,
    welcomeMessage: welcome,
    hostName,
  };
}

function removeLogoFile(orgId, fileName) {
  if (!fileName) return;
  try {
    const full = brandingLogoPath(orgId, fileName);
    if (full && fs.existsSync(full)) fs.unlinkSync(full);
  } catch {
    /* best effort */
  }
}

module.exports = {
  WELCOME_MAX,
  LOGO_MAX_BYTES,
  LOGO_MIME,
  DEFAULT_ACCENT,
  brandingDir,
  normalizeAccentColor,
  normalizeWelcomeMessage,
  hostDisplayLabel,
  brandingLogoPath,
  publicLogoUrl,
  serializePublicBranding,
  removeLogoFile,
};
