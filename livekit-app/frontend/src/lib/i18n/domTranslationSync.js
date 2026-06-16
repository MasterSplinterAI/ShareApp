import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { autopilotTranslator } from '../autopilot-translator';

/** Routes where DOM translation fills gaps (extended locales use English JSON + live translation). */
export function isDomTranslationRoute(pathname) {
  return !isDomTranslationExcludedRoute(pathname);
}

export function isDomTranslationExcludedRoute(pathname) {
  return (
    pathname.startsWith('/room/')
    || pathname.startsWith('/join/')
  );
}

/**
 * Sync autopilot DOM translator with UI locale on workspace routes.
 * Static `t()` strings should live under `data-no-translate` so only English gaps are translated.
 */
export function syncDomTranslation(locale, pathname) {
  const path = pathname || window.location.pathname;

  if (isDomTranslationExcludedRoute(path) || !isDomTranslationRoute(path)) {
    autopilotTranslator.setLanguage('en').catch(() => {});
    return;
  }

  if (!locale || locale === 'en') {
    autopilotTranslator.setLanguage('en').catch(() => {});
    return;
  }

  try {
    localStorage.setItem('app_language', locale);
  } catch {
    /* ignore */
  }

  // setLanguage('en') disconnects the observer — init again when leaving English.
  if (autopilotTranslator.currentLanguageValue === 'en') {
    autopilotTranslator.init(locale, []);
    return;
  }

  if (autopilotTranslator.currentLanguageValue === locale) {
    autopilotTranslator.translatePage().catch(() => {});
    return;
  }

  autopilotTranslator.setLanguage(locale).catch(() => {});
}

/** Re-run DOM translation after React paints new route content. */
export function useDomTranslationFallback({ locale, ready, requireAuth = true }) {
  const location = useLocation();

  useEffect(() => {
    if (!ready) return;

    if (requireAuth) {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('v2_token') : null;
      if (!token) {
        autopilotTranslator.setLanguage('en').catch(() => {});
        return;
      }
    }

    const id = window.requestAnimationFrame(() => {
      syncDomTranslation(locale, location.pathname);
    });
    return () => window.cancelAnimationFrame(id);
  }, [locale, ready, location.pathname, requireAuth]);
}
