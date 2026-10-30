import {
  DEFAULT_LOCALE,
  LOCALE_LOADERS,
} from './constants';
import { resolveLocaleForMessages, resolveUiLocale } from './uiLanguages';
import {
  getMemoryCached,
  getPersistedCached,
  setMemoryCached,
  setPersistedCached,
} from './cache';

const loadPromises = new Map();

export async function loadLocaleMessages(localeCode) {
  const locale = resolveLocaleForMessages(localeCode);

  const mem = getMemoryCached(locale);
  if (mem) return mem;

  const persisted = getPersistedCached(locale);
  if (persisted) {
    setMemoryCached(locale, persisted);
    return persisted;
  }

  if (loadPromises.has(locale)) {
    return loadPromises.get(locale);
  }

  const promise = (async () => {
    const loader = LOCALE_LOADERS[locale] || LOCALE_LOADERS[DEFAULT_LOCALE];
    const mod = await loader();
    const messages = mod.default || mod;
    setMemoryCached(locale, messages);
    setPersistedCached(locale, messages);
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
  const [messages, fallback] = await Promise.all([
    loadLocaleMessages(messageLocale),
    messageLocale === DEFAULT_LOCALE ? Promise.resolve(null) : loadLocaleMessages(DEFAULT_LOCALE),
  ]);
  return { messages, fallback: messageLocale === DEFAULT_LOCALE ? messages : fallback, uiLocale };
}
