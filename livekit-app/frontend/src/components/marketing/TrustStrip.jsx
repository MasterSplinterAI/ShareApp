import { Lock, ShieldCheck, Video } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const ITEMS = [
  { key: 'encrypted', icon: Lock },
  { key: 'transcripts', icon: ShieldCheck },
  { key: 'retention', icon: Video },
];

export function TrustStrip() {
  const { t } = useTranslation();

  return (
    <section className="border-b border-border/40 bg-muted/20 py-6" aria-label={t('trust.ariaLabel')}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ul className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-8 sm:gap-y-3">
          {ITEMS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>{t(`trust.items.${key}`)}</span>
            </li>
          ))}
          <li className="hidden h-4 w-px bg-border sm:block" aria-hidden />
          <li className="text-center text-sm text-muted-foreground sm:text-left">{t('trust.poweredBy')}</li>
        </ul>
      </div>
    </section>
  );
}
