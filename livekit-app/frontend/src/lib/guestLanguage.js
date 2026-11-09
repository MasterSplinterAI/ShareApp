/**
 * Pure helpers for guest language preselection on shared meeting links,
 * QR codes, and email/direct-call invites.
 * Self-contained ESM so both Vite and `node --test` can import it directly.
 */

export const GUEST_LANGUAGE_CATALOG = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'es-DO', name: 'Spanish (Dominican Republic)', nativeName: 'Español (República Dominicana)', flag: '🇩🇴' },
  { code: 'es-CO', name: 'Spanish (Colombia)', nativeName: 'Español (Colombia)', flag: '🇨🇴' },
  { code: 'es-MX', name: 'Spanish (Mexico)', nativeName: 'Español (México)', flag: '🇲🇽' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'fr-CA', name: 'French (Canada)', nativeName: 'Français (Canada)', flag: '🇨🇦' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'de-CH', name: 'German (Switzerland)', nativeName: 'Deutsch (Schweiz)', flag: '🇨🇭' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', name: 'Mandarin Chinese', nativeName: '中文（简体）', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '中文（繁體）', flag: '🇹🇼' },
  { code: 'zh-HK', name: 'Chinese (Cantonese)', nativeName: '廣東話', flag: '🇭🇰' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'nl-BE', name: 'Flemish', nativeName: 'Vlaams', flag: '🇧🇪' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'tiv', name: 'Tiv', nativeName: 'Tiv', flag: '🇳🇬' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', flag: '🇭🇺' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', flag: '🇧🇬' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog', flag: '🇵🇭' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', flag: '🇪🇸' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', flag: '🇭🇷' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', flag: '🇷🇸' },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski', flag: '🇧🇦' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', flag: '🇸🇮' },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски', flag: '🇲🇰' },
  { code: 'be', name: 'Belarusian', nativeName: 'Беларуская', flag: '🇧🇾' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', flag: '🇱🇹' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', flag: '🇪🇪' },
];

const CATALOG_BY_CODE = new Map(GUEST_LANGUAGE_CATALOG.map((lang) => [lang.code, lang]));
const CASE_INSENSITIVE_INDEX = new Map(
  GUEST_LANGUAGE_CATALOG.map((lang) => [lang.code.toLowerCase(), lang.code])
);

const LEGACY_AND_ALIAS_MAP = {
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-HK',
  'en-us': 'en',
  'en-gb': 'en',
  'en-au': 'en',
  'en-in': 'en',
  'en-nz': 'en',
  'es-419': 'es',
  'es-es': 'es',
  'es-do': 'es-DO',
  'es-co': 'es-CO',
  'es-mx': 'es-MX',
  'fr-fr': 'fr',
  'fr-ca': 'fr-CA',
  'de-de': 'de',
  'de-ch': 'de-CH',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-PT',
  'nl-be': 'nl-BE',
  'ja-jp': 'ja',
  'ko-kr': 'ko',
  'it-it': 'it',
  'ru-ru': 'ru',
  'ar-sa': 'ar',
  'hi-in': 'hi',
};

/**
 * Quick-pick languages surfaced as 1-tap pills when hosts share a link or invite.
 */
export const QUICK_PICK_GUEST_LANGUAGES = [
  { code: '', label: 'Auto', nativeLabel: 'Let guest choose', flag: '🌐' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'French', nativeLabel: 'Français', flag: '🇫🇷' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português', flag: '🇵🇹' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', flag: '🇩🇪' },
  { code: 'zh-CN', label: 'Chinese', nativeLabel: '中文', flag: '🇨🇳' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', flag: '🇯🇵' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', flag: '🇸🇦' },
  { code: 'en', label: 'English', nativeLabel: 'English', flag: '🇺🇸' },
];

/**
 * Resolve a raw language code (from ?lang=, ?l=, or backend join-info) to a
 * supported canonical Lalia meeting language code, or null if not valid/set.
 *
 * @param {string | null | undefined} rawCode
 * @returns {string | null}
 */
export function resolvePreselectedLanguage(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const cleaned = rawCode.trim().replace(/_/g, '-');
  if (!cleaned || cleaned.toLowerCase() === 'auto') return null;

  const lower = cleaned.toLowerCase();
  if (LEGACY_AND_ALIAS_MAP[lower]) {
    return LEGACY_AND_ALIAS_MAP[lower];
  }
  if (CASE_INSENSITIVE_INDEX.has(lower)) {
    return CASE_INSENSITIVE_INDEX.get(lower);
  }

  const base = lower.split('-')[0];
  if (LEGACY_AND_ALIAS_MAP[base]) {
    return LEGACY_AND_ALIAS_MAP[base];
  }
  if (CASE_INSENSITIVE_INDEX.has(base)) {
    return CASE_INSENSITIVE_INDEX.get(base);
  }

  return null;
}

/**
 * Parse `?lang=<code>` (or short alias `?l=<code>`) from a URL search string,
 * full URL, or URLSearchParams instance.
 *
 * @param {string | URLSearchParams | null | undefined} searchOrUrl
 * @returns {string | null}
 */
export function parseGuestLanguageFromSearch(searchOrUrl) {
  if (!searchOrUrl) return null;
  try {
    let params;
    if (searchOrUrl instanceof URLSearchParams) {
      params = searchOrUrl;
    } else {
      const str = String(searchOrUrl).trim();
      if (!str) return null;
      if (/^https?:\/\//i.test(str)) {
        params = new URL(str).searchParams;
      } else {
        const qIndex = str.indexOf('?');
        const rawSearch = qIndex >= 0 ? str.slice(qIndex) : str;
        params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch);
      }
    }
    const raw = params.get('lang') || params.get('l');
    return resolvePreselectedLanguage(raw);
  } catch {
    return null;
  }
}

/**
 * Build a join URL with (or without) the `?lang=<code>` query parameter.
 * Preserves existing query parameters such as `?i=<inviteToken>`.
 *
 * @param {string} baseUrl
 * @param {string | null | undefined} langCode
 * @returns {string}
 */
export function buildJoinUrlWithLanguage(baseUrl, langCode) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';

  const resolvedLang = resolvePreselectedLanguage(langCode);
  const isAbsolute = /^https?:\/\//i.test(trimmed);

  try {
    const parsed = new URL(trimmed, 'https://lalia.cloud');
    parsed.searchParams.delete('l');
    if (resolvedLang) {
      parsed.searchParams.set('lang', resolvedLang);
    } else {
      parsed.searchParams.delete('lang');
    }
    if (isAbsolute) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

/**
 * Format display details for the preselected language banner on the join screen.
 *
 * @param {string | null | undefined} code
 * @returns {{ code: string, name: string, nativeName: string, flag: string, displayLabel: string, noticeText: string } | null}
 */
export function formatPreselectedLanguageNotice(code) {
  const resolved = resolvePreselectedLanguage(code);
  if (!resolved) return null;
  const lang = CATALOG_BY_CODE.get(resolved);
  if (!lang) return null;

  const displayLabel =
    lang.nativeName && lang.nativeName !== lang.name
      ? `${lang.name} (${lang.nativeName})`
      : lang.name;

  return {
    code: lang.code,
    name: lang.name,
    nativeName: lang.nativeName || lang.name,
    flag: lang.flag || '🌐',
    displayLabel,
    noticeText: `Language pre-set to ${displayLabel} — you can change this anytime`,
  };
}
