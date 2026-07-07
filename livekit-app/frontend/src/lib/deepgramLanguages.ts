/**
 * Deepgram Nova-3 language catalog for meeting caption / STT selection.
 * @see https://developers.deepgram.com/docs/models-languages-overview
 *
 * `code` is Lalia's canonical picker code; `deepgramCode` when set is sent to STT.
 */

export interface DeepgramLanguage {
  code: string;
  name: string;
  nativeName: string;
  flag?: string;
  deepgramCode?: string;
  /** Lower = shown in the "Popular" section first. */
  priority?: number;
}

/** Most common meeting languages — shown first when not searching. */
export const MEETING_LANGUAGE_PRIORITY: readonly string[] = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'pt-BR',
  'zh-CN',
  'ja',
  'ko',
  'ar',
  'hi',
  'ru',
  'it',
  'nl',
  'pl',
  'tr',
  'vi',
  'th',
  'id',
  'uk',
  'es-CO',
  'es-MX',
  'tiv',
];

export const DEEPGRAM_LANGUAGES: DeepgramLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', priority: 1 },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', priority: 2 },
  { code: 'es-CO', name: 'Spanish (Colombia)', nativeName: 'Español (Colombia)', flag: '🇨🇴', priority: 21 },
  { code: 'es-MX', name: 'Spanish (Mexico)', nativeName: 'Español (México)', flag: '🇲🇽', priority: 22 },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', priority: 3 },
  { code: 'fr-CA', name: 'French (Canada)', nativeName: 'Français (Canada)', flag: '🇨🇦' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', priority: 4 },
  { code: 'de-CH', name: 'German (Switzerland)', nativeName: 'Deutsch (Schweiz)', flag: '🇨🇭' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', priority: 13 },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹', priority: 5 },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', flag: '🇧🇷', priority: 6 },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', priority: 7 },
  { code: 'zh-CN', name: 'Mandarin Chinese', nativeName: '中文（简体）', flag: '🇨🇳', priority: 8, deepgramCode: 'zh' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '中文（繁體）', flag: '🇹🇼', deepgramCode: 'zh-TW' },
  { code: 'zh-HK', name: 'Chinese (Cantonese)', nativeName: '廣東話', flag: '🇭🇰', deepgramCode: 'zh-HK' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', priority: 9 },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', priority: 10 },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', priority: 11 },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', priority: 12 },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱', priority: 14 },
  { code: 'nl-BE', name: 'Flemish', nativeName: 'Vlaams', flag: '🇧🇪', deepgramCode: 'nl-BE' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱', priority: 15 },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', priority: 16 },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳', priority: 17 },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭', priority: 18 },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩', priority: 19 },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦', priority: 20 },
  { code: 'tiv', name: 'Tiv', nativeName: 'Tiv', flag: '🇳🇬', priority: 23 },
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

const CODE_INDEX = new Map(DEEPGRAM_LANGUAGES.map((lang) => [lang.code, lang]));

export function getDeepgramLanguage(code: string): DeepgramLanguage | undefined {
  return CODE_INDEX.get(code);
}

export function getDeepgramLanguageCodes(): string[] {
  return DEEPGRAM_LANGUAGES.map((lang) => lang.code);
}

export function sortMeetingLanguages(languages: DeepgramLanguage[]): DeepgramLanguage[] {
  const priorityIndex = new Map(MEETING_LANGUAGE_PRIORITY.map((code, index) => [code, index]));
  return [...languages].sort((a, b) => {
    const aPri = priorityIndex.has(a.code) ? priorityIndex.get(a.code)! : Number.MAX_SAFE_INTEGER;
    const bPri = priorityIndex.has(b.code) ? priorityIndex.get(b.code)! : Number.MAX_SAFE_INTEGER;
    if (aPri !== bPri) return aPri - bPri;
    return a.name.localeCompare(b.name);
  });
}

export function filterMeetingLanguages(languages: DeepgramLanguage[], query: string): DeepgramLanguage[] {
  const q = query.trim().toLowerCase();
  if (!q) return languages;
  return languages.filter(
    (lang) =>
      lang.code.toLowerCase().includes(q) ||
      lang.name.toLowerCase().includes(q) ||
      lang.nativeName.toLowerCase().includes(q)
  );
}

export function splitPopularLanguages(
  languages: DeepgramLanguage[],
  query: string
): { popular: DeepgramLanguage[]; other: DeepgramLanguage[] } {
  if (query.trim()) {
    return { popular: [], other: languages };
  }
  const prioritySet = new Set(MEETING_LANGUAGE_PRIORITY);
  const popular: DeepgramLanguage[] = [];
  const other: DeepgramLanguage[] = [];
  for (const lang of languages) {
    if (prioritySet.has(lang.code)) popular.push(lang);
    else other.push(lang);
  }
  return { popular, other };
}
