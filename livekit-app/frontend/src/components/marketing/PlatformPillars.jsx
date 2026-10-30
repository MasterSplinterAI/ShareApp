import { Globe2, FileText, Sparkles, ArrowRightLeft, Mic, Bot, ClipboardList } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const PILLAR_KEYS = [
  { key: 'live', icon: Globe2 },
  { key: 'after', icon: FileText },
  { key: 'insights', icon: Sparkles },
];

const REPLACE_KEYS = [
  { key: 'interpreter', icon: ArrowRightLeft },
  { key: 'captions', icon: Mic },
  { key: 'transcription', icon: Bot },
  { key: 'notes', icon: ClipboardList },
];

export function PlatformPillars() {
  const { t } = useTranslation();

  return (
    <section id="platform" className="scroll-mt-20 border-b border-border/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('platform.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
            {t('platform.title')}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('platform.subtitle')}</p>
        </div>

        <div className="mt-12 grid gap-6 sm:mt-16 md:grid-cols-3">
          {PILLAR_KEYS.map(({ key, icon: Icon }) => (
            <Card key={key} className="border-border/80 bg-card/50">
              <CardHeader className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{t(`platform.pillars.${key}.title`)}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">
                  {t(`platform.pillars.${key}.description`)}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-border/60 bg-muted/25 p-6 sm:mt-16 sm:p-8">
          <p className="text-center text-sm font-medium text-foreground">{t('platform.replaces.title')}</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {REPLACE_KEYS.map(({ key, icon: Icon }) => (
              <li
                key={key}
                className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/80 px-3 py-2.5 text-sm text-muted-foreground"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>{t(`platform.replaces.items.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
