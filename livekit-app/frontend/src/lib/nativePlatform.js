/**
 * Helpers for Capacitor (iOS / Android) and installed PWA environments.
 * Keeps one React codebase working seamlessly across Web, iOS App Store, and Google Play.
 */

const DEFAULT_PRODUCTION_ORIGIN = 'https://lalia.cloud';

export function isNativeApp() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
      return Boolean(window.Capacitor.isNativePlatform());
    }
    const proto = window.location?.protocol || '';
    if (proto === 'capacitor:' || proto === 'ionic:') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function getNativePlatform() {
  if (!isNativeApp()) return 'web';
  try {
    const p = window.Capacitor?.getPlatform?.();
    if (p === 'ios' || p === 'android') return p;
  } catch {
    /* ignore */
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'web';
}

export function isIosNativeApp() {
  return getNativePlatform() === 'ios';
}

export function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
        window.navigator?.standalone === true
    );
  } catch {
    return false;
  }
}

export function getPublicAppOrigin() {
  const configured = import.meta.env.VITE_PUBLIC_ORIGIN;
  if (configured && typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/$/, '');
  }
  if (isNativeApp()) {
    return DEFAULT_PRODUCTION_ORIGIN;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_PRODUCTION_ORIGIN;
}

export function resolveApiBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }
  if (isNativeApp()) {
    return `${getPublicAppOrigin()}/api`;
  }
  if (typeof window === 'undefined') return '/api';

  const hostname = window.location.hostname || '';
  const isNgrok =
    hostname.includes('ngrok.app') ||
    hostname.includes('ngrok-free.app') ||
    hostname.includes('ngrok.io');
  const isNetworkAccess = hostname !== 'localhost' && hostname !== '127.0.0.1';
  const isHTTPS = window.location.protocol === 'https:';

  if (isNgrok || (isNetworkAccess && isHTTPS)) {
    return '/api';
  }
  if (isNetworkAccess) {
    return `http://${hostname}:3001/api`;
  }
  return '/api';
}

/**
 * Parse a user-entered meeting link or room code into a navigation target.
 * Supports:
 *  - https://lalia.cloud/join/my-room?invite=abc
 *  - lalia://join/my-room?invite=abc
 *  - /join/my-room
 *  - bare room code: my-room
 */
export function parseJoinTarget(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;

  try {
    if (/^(https?:\/\/|lalia:\/\/)/i.test(raw)) {
      const normalized = raw.replace(/^lalia:\/\//i, 'https://lalia.cloud/');
      const url = new URL(normalized);
      const match = url.pathname.match(/\/(join|room)\/([^/?#]+)/i);
      if (match && match[2]) {
        return `/join/${decodeURIComponent(match[2])}${url.search || ''}`;
      }
    }
  } catch {
    /* fall through */
  }

  const pathMatch = raw.match(/\/?(?:join|room)\/([^/?#\s]+)(\?[^\s#]+)?/i);
  if (pathMatch && pathMatch[1]) {
    return `/join/${pathMatch[1]}${pathMatch[2] || ''}`;
  }

  const slug = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!slug) return null;
  return `/join/${encodeURIComponent(slug)}`;
}
