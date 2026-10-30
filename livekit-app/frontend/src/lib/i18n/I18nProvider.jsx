import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  readStoredLocale,
  writeStoredLocale,
} from './constants';
import { detectBrowserUiLocale, resolveUiLocale } from './uiLanguages';
import { loadLocalePair } from './loadLocale';
import { createTranslator } from './translate';
import defaultMessages from '../../locales/en.json';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => resolveUiLocale(readStoredLocale() || detectBrowserUiLocale()));
  const [messages, setMessages] = useState(defaultMessages);
  const [fallbackMessages, setFallbackMessages] = useState(defaultMessages);
  const [ready, setReady] = useState(false);

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

  const setLocale = useCallback((next) => {
    const resolved = resolveUiLocale(next);
    writeStoredLocale(resolved);
    try {
      localStorage.setItem('app_language', resolved);
    } catch {
      /* ignore */
    }
    setLocaleState(resolved);
  }, []);

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
