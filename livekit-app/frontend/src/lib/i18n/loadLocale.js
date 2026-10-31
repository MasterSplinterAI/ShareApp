import defaultMessages from '../../locales/en.json';
import {
  DEFAULT_LOCALE,
  LOCALE_LOADERS,
} from './constants';
import { resolveLocaleForMessages, resolveUiLocale } from './uiLanguages';
import {
  getMemoryCached,
  setMemoryCached,
} from './cache';

const loadPromises = new Map();

export async function loadLocaleMessages(localeCode) {
  const locale = resolveLocaleForMessages(localeCode);
  if (locale === DEFAULT_LOCALE) {
    return defaultMessages;
  }

  const mem = getMemoryCached(locale);
  if (mem) return mem;

  if (loadPromises.has(locale)) {
    return loadPromises.get(locale);
  }

  const promise = (async () => {
    const loader = LOCALE_LOADERS[locale] || LOCALE_LOADERS[DEFAULT_LOCALE];
    const mod = await loader();
    const messages = mod.default || mod;
    setMemoryCached(locale, messages);
    return messages;
  })();

  loadPromises.set(locale, promise);
  try {
    return await promise;
  } finally {
    loadPromises.delete(locale);
  }
}

/** Load English fallback in parallel for missing keys. */
export async function loadLocalePair(localeCode) {
  const uiLocale = resolveUiLocale(localeCode);
  const messageLocale = resolveLocaleForMessages(uiLocale);
  const messages = await loadLocaleMessages(messageLocale);
  return { messages, fallback: defaultMessages, uiLocale };
}
