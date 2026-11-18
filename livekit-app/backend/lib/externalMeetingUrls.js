/**
 * Parses and normalizes external meeting URLs (Google Meet & Microsoft Teams),
 * including extracting embedded links from pasted calendar invite snippets.
 */

const URL_EXTRACT_RE = /https?:\/\/[^\s<>"')]+|(?:meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')]+/gi;
const GOOGLE_MEET_CODE_RE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i;
const GOOGLE_MEET_LOOKUP_RE = /^\/lookup\/([a-z0-9_-]{3,80})\/?$/i;

function classifyCandidateUrl(rawCandidate) {
  let parsed;
  try {
    const cleaned = rawCandidate.trim().replace(/[.,;!?]+$/, '');
    const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    parsed = new URL(withProto);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();

  // 1. Google Meet (meet.google.com/xxx-xxxx-xxx or /lookup/...)
  if (host === 'meet.google.com') {
    const codeMatch = GOOGLE_MEET_CODE_RE.exec(parsed.pathname);
    if (codeMatch) {
      const code = codeMatch[1].toLowerCase();
      return {
        ok: true,
        platform: 'google_meet',
        platformLabel: 'Google Meet',
        normalizedUrl: `https://meet.google.com/${code}`,
        externalCode: code,
        defaultTitle: `Google Meet (${code})`,
      };
    }
    const lookupMatch = GOOGLE_MEET_LOOKUP_RE.exec(parsed.pathname);
    if (lookupMatch) {
      const lookup = lookupMatch[1];
      return {
        ok: true,
        platform: 'google_meet',
        platformLabel: 'Google Meet',
        normalizedUrl: `https://meet.google.com/lookup/${lookup}`,
        externalCode: lookup,
        defaultTitle: `Google Meet (${lookup})`,
      };
    }
    return {
      ok: false,
      error: 'Enter a valid Google Meet link (for example, https://meet.google.com/abc-defg-hij).',
    };
  }

  // 2. Microsoft Teams (teams.microsoft.com/l/meetup-join/..., teams.microsoft.com/meet/..., teams.live.com/meet/...)
  if (
    host === 'teams.microsoft.com' ||
    host.endsWith('.teams.microsoft.com') ||
    host === 'teams.live.com'
  ) {
    const pathLower = parsed.pathname.toLowerCase();
    const isMeetupJoin = pathLower.startsWith('/l/meetup-join/');
    const isShortMeet = pathLower.startsWith('/meet/');
    const isLightJoin = pathLower.startsWith('/v2/') || parsed.hash.includes('meetup-join');

    if (!isMeetupJoin && !isShortMeet && !isLightJoin) {
      return {
        ok: false,
        error: 'Enter a valid Microsoft Teams meeting invite link (meetup-join or /meet/ URL).',
      };
    }

    const clean = new URL(`https://${host}${parsed.pathname}`);
    // Preserve essential Teams join parameters while dropping tracking clutter
    for (const key of ['context', 'p', 'anon', 'deeplinkId', 'tenantId']) {
      const val = parsed.searchParams.get(key);
      if (val != null) clean.searchParams.set(key, val);
    }

    let externalCode = null;
    if (isShortMeet) {
      externalCode = parsed.pathname.split('/').filter(Boolean)[1] || null;
    } else if (isMeetupJoin) {
      const seg = decodeURIComponent(parsed.pathname.slice('/l/meetup-join/'.length)).split('/')[0] || '';
      externalCode = seg.slice(0, 48) || null;
    }

    return {
      ok: true,
      platform: 'ms_teams',
      platformLabel: 'Microsoft Teams',
      normalizedUrl: clean.toString(),
      externalCode,
      defaultTitle: externalCode ? `Teams Meeting (${externalCode.slice(0, 18)})` : 'Microsoft Teams Meeting',
    };
  }

  return null;
}

function parseExternalMeetingUrl(input) {
  const text = String(input || '').trim();
  if (!text) {
    return { ok: false, error: 'Paste a Google Meet or Microsoft Teams meeting link.' };
  }

  // Allow bare "meet.google.com/abc-defg-hij" without https://
  const normalizedText = /^(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\//i.test(text)
    ? `https://${text}`
    : text;

  const candidates = normalizedText.match(URL_EXTRACT_RE) || [normalizedText];
  let firstError = null;

  for (const candidate of candidates) {
    const res = classifyCandidateUrl(candidate);
    if (res?.ok) return res;
    if (res && !res.ok && !firstError) firstError = res;
  }

  if (firstError) return firstError;
  return {
    ok: false,
    error: 'Unsupported meeting URL. Paste a Google Meet (meet.google.com/...) or Microsoft Teams link.',
  };
}

function platformDisplayName(source) {
  if (source === 'google_meet') return 'Google Meet';
  if (source === 'ms_teams') return 'Microsoft Teams';
  return 'Lalia';
}

module.exports = {
  parseExternalMeetingUrl,
  platformDisplayName,
};
