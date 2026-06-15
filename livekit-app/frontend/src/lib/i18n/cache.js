import { I18N_VERSION } from './constants';

const memoryCache = new Map();
const LS_PREFIX = 'parley_i18n_bundle';

function storageKey(locale) {
  return `${LS_PREFIX}_v${I18N_VERSION}_${locale}`;
}

/** In-memory hit — fastest path for repeat renders and same-session locale switches. */
export function getMemoryCached(locale) {
  return memoryCache.get(locale) || null;
}

export function setMemoryCached(locale, messages) {
  memoryCache.set(locale, messages);
}

/** Read persisted bundle; returns null if missing, corrupt, or version mismatch. */
export function getPersistedCached(locale) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(locale));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== I18N_VERSION || !parsed.messages) return null;
    return parsed.messages;
  } catch {
    return null;
  }
}

export function setPersistedCached(locale, messages) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      storageKey(locale),
      JSON.stringify({ version: I18N_VERSION, messages, cachedAt: Date.now() })
    );
  } catch {
    /* ignore quota */
  }
}

/** Warm another locale in the background (hover prefetch). */
export function preloadLocale(loadFn) {
  loadFn().catch(() => {});
}
