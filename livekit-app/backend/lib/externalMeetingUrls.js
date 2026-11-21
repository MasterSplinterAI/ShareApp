/**
 * Parses and normalizes external meeting URLs (Google Meet, Microsoft Teams, Zoom, and Webex),
 * including extracting embedded links from pasted calendar invite snippets.
 */

const URL_EXTRACT_RE =
  /https?:\/\/[^\s<>"')]+|(?:meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|(?:[a-z0-9-]+\.)?zoom\.us|(?:[a-z0-9-]+\.)?webex\.com)\/[^\s<>"')]+/gi;
const GOOGLE_MEET_CODE_RE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i;
const GOOGLE_MEET_LOOKUP_RE = /^\/lookup\/([a-z0-9_-]{3,80})\/?$/i;
const ZOOM_ID_RE = /^\/(?:j|w|s)\/([a-z0-9_-]{6,32})\/?$/i;
const ZOOM_PERSONAL_RE = /^\/my\/([a-z0-9._-]{2,80})\/?$/i;
const WEBEX_SLUG_RE = /^\/(?:meet|join)\/([a-z0-9._-]{2,100})\/?$/i;

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

  // 3. Zoom (zoom.us/j/<id>, *.zoom.us/j/<id>, /w/<id>, /s/<id>, /my/<slug>)
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) {
    const idMatch = ZOOM_ID_RE.exec(parsed.pathname);
    const personalMatch = ZOOM_PERSONAL_RE.exec(parsed.pathname);
    if (!idMatch && !personalMatch) {
      return {
        ok: false,
        error: 'Enter a valid Zoom meeting link (for example, https://zoom.us/j/1234567890).',
      };
    }

    const clean = new URL(`https://${host}${parsed.pathname}`);
    for (const key of ['pwd', 'tk']) {
      const val = parsed.searchParams.get(key);
      if (val != null) clean.searchParams.set(key, val);
    }

    const externalCode = idMatch ? idMatch[1] : personalMatch[1];
    return {
      ok: true,
      platform: 'zoom',
      platformLabel: 'Zoom',
      normalizedUrl: clean.toString(),
      externalCode,
      defaultTitle: `Zoom Meeting (${externalCode})`,
    };
  }

  // 4. Webex (*.webex.com/meet/<slug>, *.webex.com/join/<slug>, *.webex.com/wbxmjs/joinservice/...)
  if (host === 'webex.com' || host.endsWith('.webex.com')) {
    const pathLower = parsed.pathname.toLowerCase();
    const slugMatch = WEBEX_SLUG_RE.exec(parsed.pathname);
    const isJoinService = pathLower.startsWith('/wbxmjs/joinservice');
    if (!slugMatch && !isJoinService) {
      return {
        ok: false,
        error: 'Enter a valid Webex meeting link (for example, https://company.webex.com/meet/room).',
      };
    }

    const clean = new URL(`https://${host}${parsed.pathname}`);
    for (const key of ['MTID', 'PW', 'p']) {
      const val = parsed.searchParams.get(key);
      if (val != null) clean.searchParams.set(key, val);
    }

    const externalCode = slugMatch
      ? slugMatch[1]
      : parsed.searchParams.get('MTID')?.slice(0, 48) || null;
    return {
      ok: true,
      platform: 'webex',
      platformLabel: 'Webex',
      normalizedUrl: clean.toString(),
      externalCode,
      defaultTitle: externalCode ? `Webex Meeting (${externalCode})` : 'Webex Meeting',
    };
  }

  return null;
}

function parseExternalMeetingUrl(input) {
  const text = String(input || '').trim();
  if (!text) {
    return { ok: false, error: 'Paste a Google Meet, Microsoft Teams, Zoom, or Webex meeting link.' };
  }

  // Allow bare "meet.google.com/abc-defg-hij" or "zoom.us/j/123..." without https://
  const normalizedText =
    /^(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|(?:[a-z0-9-]+\.)?zoom\.us|(?:[a-z0-9-]+\.)?webex\.com)\//i.test(
      text
    )
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
    error: 'Unsupported meeting URL. Paste a Google Meet, Microsoft Teams, Zoom, or Webex link.',
  };
}

function platformDisplayName(source) {
  if (source === 'google_meet') return 'Google Meet';
  if (source === 'ms_teams') return 'Microsoft Teams';
  if (source === 'zoom') return 'Zoom';
  if (source === 'webex') return 'Webex';
  return 'Lalia';
}

module.exports = {
  parseExternalMeetingUrl,
  platformDisplayName,
};
