/**
 * Guest join / prejoin branding helpers.
 */

export const DEFAULT_BRAND_ACCENT = '#2563eb';

/** Normalize API branding payload for UI. */
export function normalizeMeetingBranding(raw) {
  if (!raw) return null;
  const accent = raw.accentColor || raw.accent_color;
  const logoUrl = raw.logoUrl || raw.logo_url;
  const welcome = raw.welcomeMessage ?? raw.welcome_message ?? '';
  const hostName = raw.hostName || raw.host_name || null;
  if (!logoUrl && !welcome && !hostName && (!accent || accent === DEFAULT_BRAND_ACCENT)) {
    return null;
  }
  return {
    accentColor: accent || DEFAULT_BRAND_ACCENT,
    logoUrl: logoUrl || null,
    welcomeMessage: welcome || '',
    hostName: hostName || null,
  };
}

/** Inline style for CSS variable theming on join surfaces. */
export function brandingStyleVars(branding) {
  const accent = branding?.accentColor || DEFAULT_BRAND_ACCENT;
  return { '--brand-accent': accent };
}

export function brandButtonClassName(extra = '') {
  return `bg-[var(--brand-accent)] hover:opacity-90 text-white ${extra}`.trim();
}
