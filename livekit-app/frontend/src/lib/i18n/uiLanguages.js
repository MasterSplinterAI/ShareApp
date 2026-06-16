import { DEFAULT_LOCALE } from './constants';
import {
  DEEPGRAM_LANGUAGES,
  filterMeetingLanguages,
  getDeepgramLanguage,
  sortMeetingLanguages,
} from '../deepgramLanguages';

/** Locales with pre-translated JSON bundles. */
export const CORE_UI_LOCALE_CODES = new Set(['en', 'es', 'fr', 'de', 'pt', 'ja', 'zh-CN']);

export function isCoreUiLocale(code) {
  return CORE_UI_LOCALE_CODES.has(code);
}

export function isSupportedLocale(code) {
  return isCoreUiLocale(code);
}

/** @deprecated Use isUiLocale */
export function isCoreLocale(code) {
  return isCoreUiLocale(code);
}

export function isUiLocale(code) {
  if (!code || typeof code !== 'string') return false;
  const normalized = code.trim().replace('_', '-');
  if (getDeepgramLanguage(normalized)) return true;
  const base = normalized.split('-')[0];
  return Boolean(getDeepgramLanguage(base));
}

export function resolveUiLocale(code) {
  if (!code || typeof code !== 'string') return DEFAULT_LOCALE;
  const normalized = code.trim().replace('_', '-');
  if (getDeepgramLanguage(normalized)) return normalized;
  const base = normalized.split('-')[0];
  if (getDeepgramLanguage(base)) return base;
  return DEFAULT_LOCALE;
}

/** Which JSON bundle to load — extended UI locales fall back to English copy + DOM translation. */
export function resolveLocaleForMessages(uiLocale) {
  const resolved = resolveUiLocale(uiLocale);
  return isCoreUiLocale(resolved) ? resolved : DEFAULT_LOCALE;
}

export function getUiLanguages() {
  return sortMeetingLanguages(DEEPGRAM_LANGUAGES);
}

export function getUiLanguageDisplay(code) {
  return getDeepgramLanguage(resolveUiLocale(code)) || getDeepgramLanguage('en');
}

export function detectBrowserUiLocale() {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of languages) {
    if (!lang) continue;
    const normalized = lang.replace('_', '-');
    if (isUiLocale(normalized)) return resolveUiLocale(normalized);
    const base = normalized.split('-')[0];
    if (isUiLocale(base)) return resolveUiLocale(base);
  }
  return DEFAULT_LOCALE;
}

export { filterMeetingLanguages, DEEPGRAM_LANGUAGES };
