import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  readStoredLocale,
  resolveLocale,
  writeStoredLocale,
} from './constants';
import { loadLocalePair } from './loadLocale';
import { createTranslator } from './translate';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => readStoredLocale() || detectBrowserLocale());
  const [messages, setMessages] = useState(null);
  const [fallbackMessages, setFallbackMessages] = useState(null);
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
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-Hans' : locale;
  }, [locale]);

  const setLocale = useCallback((next) => {
    const resolved = resolveLocale(next);
    writeStoredLocale(resolved);
    setLocaleState(resolved);
  }, []);

  const t = useMemo(() => {
    if (!messages) return (key) => key;
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
