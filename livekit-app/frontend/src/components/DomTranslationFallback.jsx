import { useDomTranslationFallback } from '../lib/i18n/domTranslationSync';
import { useTranslation } from '../lib/i18n/I18nProvider';

/** Enables DOM translation fallback for untranslated workspace UI after login. */
export default function DomTranslationFallback() {
  const { locale, ready } = useTranslation();
  useDomTranslationFallback({ locale, ready, requireAuth: true });
  return null;
}
