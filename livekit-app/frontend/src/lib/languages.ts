/**
 * Meeting + UI language helpers.
 * Meeting caption languages follow Deepgram Nova-3; UI site locale uses i18n JSON separately.
 */

import {
  DEEPGRAM_LANGUAGES,
  getDeepgramLanguage,
  sortMeetingLanguages,
  type DeepgramLanguage,
} from './deepgramLanguages';

export type Language = DeepgramLanguage;

/** Unified storage key (shared with autopilot translator). */
export const MEETING_LANGUAGE_STORAGE_KEY = 'app_language';

/** @deprecated Use DEEPGRAM_LANGUAGES via getMeetingLanguages() */
export const SUPPORTED_LANGUAGES: Language[] = [...DEEPGRAM_LANGUAGES];

const LEGACY_CODE_MAP: Record<string, string> = {
  zh: 'zh-CN',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  'en-US': 'en',
  'en-GB': 'en',
  'en-AU': 'en',
  'en-IN': 'en',
  'en-NZ': 'en',
  'es-419': 'es',
  'pt-PT': 'pt-PT',
};

export function getLanguage(code: string): Language | undefined {
  return getDeepgramLanguage(normalizeMeetingLanguageCode(code));
}

export function getLanguageName(code: string): string {
  return getLanguage(code)?.name ?? code;
}

export function getNativeLanguageName(code: string): string {
  return getLanguage(code)?.nativeName ?? code;
}

export function isLanguageSupported(code: string): boolean {
  if (!code || typeof code !== 'string' || !code.trim()) return false;
  return Boolean(getDeepgramLanguage(normalizeMeetingLanguageCode(code.trim())));
}

export function getAllLanguageCodes(): string[] {
  return DEEPGRAM_LANGUAGES.map((lang) => lang.code);
}

/** Deepgram code for STT when it differs from picker code. */
export function getDeepgramSttCode(code: string): string {
  const lang = getLanguage(code);
  return lang?.deepgramCode || normalizeMeetingLanguageCode(code).split('-')[0];
}

/** Ordered list for join modal + in-room language switcher. */
export function getMeetingLanguages(): Language[] {
  return sortMeetingLanguages(DEEPGRAM_LANGUAGES);
}

export function readStoredMeetingLanguage(): string {
  if (typeof localStorage === 'undefined') return 'en';
  try {
    return normalizeMeetingLanguageCode(localStorage.getItem(MEETING_LANGUAGE_STORAGE_KEY) || 'en');
  } catch {
    return 'en';
  }
}

export function writeStoredMeetingLanguage(code: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MEETING_LANGUAGE_STORAGE_KEY, normalizeMeetingLanguageCode(code));
  } catch {
    /* ignore */
  }
}

/** Map legacy stored codes to current meeting codes. */
export function normalizeMeetingLanguageCode(code: string | undefined | null): string {
  if (!code || typeof code !== 'string') return 'en';
  const trimmed = code.trim();
  if (LEGACY_CODE_MAP[trimmed]) return LEGACY_CODE_MAP[trimmed];
  if (getDeepgramLanguage(trimmed)) return trimmed;
  const base = trimmed.split('-')[0];
  if (LEGACY_CODE_MAP[base]) return LEGACY_CODE_MAP[base];
  if (getDeepgramLanguage(base)) return base;
  return 'en';
}

/** @deprecated kept for imports — same as getMeetingLanguages() */
export const MEETING_LANGUAGE_CODES = getMeetingLanguages().map((l) => l.code);
