import {
  DEFAULT_LOCALE,
  LOCALE_LOADERS,
  resolveLocale,
} from './constants';
import {
  getMemoryCached,
  getPersistedCached,
  setMemoryCached,
  setPersistedCached,
} from './cache';

const loadPromises = new Map();

export async function loadLocaleMessages(localeCode) {
  const locale = resolveLocale(localeCode);

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
  const locale = resolveLocale(localeCode);
  const [messages, fallback] = await Promise.all([
    loadLocaleMessages(locale),
    locale === DEFAULT_LOCALE ? Promise.resolve(null) : loadLocaleMessages(DEFAULT_LOCALE),
  ]);
  return { messages, fallback: locale === DEFAULT_LOCALE ? messages : fallback };
}
