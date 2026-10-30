import { useDomTranslationFallback } from '../lib/i18n/domTranslationSync';
import { useTranslation } from '../lib/i18n/I18nProvider';

/** Enables DOM translation for extended UI locales site-wide (except in-room pages). */
export default function DomTranslationFallback() {
  const { locale, ready } = useTranslation();
  useDomTranslationFallback({ locale, ready, requireAuth: false });
  return null;
}
