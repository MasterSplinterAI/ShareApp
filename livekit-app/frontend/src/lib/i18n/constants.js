/** Bump when locale JSON changes to invalidate localStorage cache. */
export const I18N_VERSION = 3;

export const LOCALE_STORAGE_KEY = 'parley_locale';

export const DEFAULT_LOCALE = 'en';

/** Pre-translated site locales (JSON bundles). Extended locales use Deepgram catalog + DOM translation. */
export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
];

export const LOCALE_LOADERS = {
  en: () => import('../../locales/en.json'),
  es: () => import('../../locales/es.json'),
  fr: () => import('../../locales/fr.json'),
  de: () => import('../../locales/de.json'),
  pt: () => import('../../locales/pt.json'),
  ja: () => import('../../locales/ja.json'),
  'zh-CN': () => import('../../locales/zh-CN.json'),
};

export function isSupportedLocale(code) {
  return Boolean(code && LOCALE_LOADERS[code]);
}

/** @deprecated Use resolveUiLocale from uiLanguages.js */
export function resolveLocale(code) {
  if (isSupportedLocale(code)) return code;
  if (code?.includes('-')) {
    const base = code.split('-')[0];
    if (isSupportedLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function detectBrowserLocale() {
  // Re-exported via uiLanguages.detectBrowserUiLocale in I18nProvider
  return DEFAULT_LOCALE;
}

export function readStoredLocale() {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore quota / private mode */
  }
}
