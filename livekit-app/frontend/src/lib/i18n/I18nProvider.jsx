import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  readStoredLocale,
  writeStoredLocale,
} from './constants';
import { detectBrowserUiLocale, resolveUiLocale } from './uiLanguages';
import { loadLocalePair } from './loadLocale';
import { createTranslator } from './translate';
import defaultMessages from '../../locales/en.json';
import { writeStoredMeetingLanguage } from '../languages';
import {
  fetchPreferredLanguageFromServer,
  syncPreferredLanguageToServer,
} from '../preferredLanguageSync';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() =>
    resolveUiLocale(readStoredLocale() || detectBrowserUiLocale())
  );
  const [messages, setMessages] = useState(defaultMessages);
  const [fallbackMessages, setFallbackMessages] = useState(defaultMessages);
  const [ready, setReady] = useState(false);
  const hydratedRemote = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    loadLocalePair(locale).then(({ messages: m, fallback }) => {
      if (cancelled) return;
      setMessages(m);
      setFallbackMessages(fallback);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    const lang = locale === 'zh-CN' ? 'zh-Hans' : locale === 'zh-TW' ? 'zh-Hant' : locale.split('-')[0];
    document.documentElement.lang = lang;
  }, [locale]);

  const applyLocale = useCallback((next, { persistRemote = true } = {}) => {
    const resolved = resolveUiLocale(next);
    writeStoredLocale(resolved);
    writeStoredMeetingLanguage(resolved);
    try {
      localStorage.setItem('app_language', resolved);
    } catch {
      /* ignore */
    }
    setLocaleState(resolved);
    if (persistRemote) {
      syncPreferredLanguageToServer(resolved);
    }
  }, []);

  const setLocale = useCallback(
    (next) => {
      applyLocale(next, { persistRemote: true });
    },
    [applyLocale]
  );

  // When logged in: prefer server profile, else push local choice up.
  useEffect(() => {
    if (hydratedRemote.current) return;
    hydratedRemote.current = true;
    let cancelled = false;
    (async () => {
      const remote = await fetchPreferredLanguageFromServer();
      if (cancelled) return;
      if (remote) {
        applyLocale(remote, { persistRemote: false });
        return;
      }
      const local = readStoredLocale();
      if (local) {
        syncPreferredLanguageToServer(resolveUiLocale(local));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyLocale]);

  const t = useMemo(() => {
    return createTranslator(messages, fallbackMessages);
  }, [messages, fallbackMessages]);

  const value = useMemo(
    () => ({ locale, setLocale, t, ready }),
    [locale, setLocale, t, ready]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

/** Shorthand hook matching common i18n naming. */
export function useTranslation() {
  const { t, locale, setLocale, ready } = useI18n();
  return { t, locale, setLocale, ready };
}
