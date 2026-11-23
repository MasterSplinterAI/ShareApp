import { lazy } from 'react';

const RELOAD_STORAGE_KEY = 'lalia_chunk_reload_ts';
const RELOAD_COOLDOWN_MS = 15_000;

export function isActiveMeetingPath(pathname = '') {
  return /^\/(?:room|meeting|join)(?:\/|$)/i.test(String(pathname || ''));
}

export function isChunkLoadError(err) {
  if (!err) return false;
  if (err.name === 'ChunkLoadError') return true;
  const msg = String(err.message || err || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(
    msg
  );
}

function defaultStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function shouldTriggerSafeReload({ getPathname, storage }) {
  const pathname = getPathname ? getPathname() : '';
  if (isActiveMeetingPath(pathname)) {
    return false;
  }
  const now = Date.now();
  try {
    const store = storage !== undefined ? storage : defaultStorage();
    if (store) {
      const prev = Number(store.getItem(RELOAD_STORAGE_KEY) || 0);
      if (Number.isFinite(prev) && prev > 0 && now - prev < RELOAD_COOLDOWN_MS) {
        return false;
      }
      store.setItem(RELOAD_STORAGE_KEY, String(now));
    }
  } catch {
    /* ignore storage restrictions */
  }
  return true;
}

export async function loadWithChunkRetry(
  importer,
  {
    retryDelayMs = 400,
    reload = () => window.location.reload(),
    getPathname = () => (typeof window !== 'undefined' ? window.location.pathname : ''),
    storage,
  } = {}
) {
  try {
    return await importer();
  } catch {
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    try {
      return await importer();
    } catch (secondErr) {
      if (isChunkLoadError(secondErr) && shouldTriggerSafeReload({ getPathname, storage })) {
        reload();
        return new Promise(() => {});
      }
      throw secondErr;
    }
  }
}

export function lazyWithRetry(importer, key = 'chunk', options = {}) {
  return lazy(() => loadWithChunkRetry(importer, { key, ...options }));
}

export function installPreloadErrorHandler({
  target = typeof window !== 'undefined' ? window : null,
  getPathname = () => (typeof window !== 'undefined' ? window.location.pathname : ''),
  reload = () => window.location.reload(),
  storage,
} = {}) {
  if (!target || typeof target.addEventListener !== 'function' || target.__laliaPreloadGuard) {
    return () => {};
  }
  const handler = (event) => {
    if (shouldTriggerSafeReload({ getPathname, storage })) {
      event?.preventDefault?.();
      reload();
    }
  };
  target.addEventListener('vite:preloadError', handler);
  target.__laliaPreloadGuard = true;
  return () => {
    target.removeEventListener?.('vite:preloadError', handler);
    delete target.__laliaPreloadGuard;
  };
}
