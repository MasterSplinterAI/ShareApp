import { es, fr, de, pt, ja, zhCN } from 'date-fns/locale';
import { DEFAULT_LOCALE } from './constants';

const MAP = {
  en: undefined,
  es,
  fr,
  de,
  pt,
  ja,
  'zh-CN': zhCN,
};

export function dateFnsLocale(code) {
  return MAP[code] || MAP[DEFAULT_LOCALE];
}
