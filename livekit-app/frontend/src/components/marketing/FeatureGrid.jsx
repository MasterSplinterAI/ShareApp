import { Globe2, Mic, Shield, FileText } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const FEATURE_KEYS = ['translation', 'captions', 'transcripts', 'accounts'];
const ICONS = { translation: Globe2, captions: Mic, transcripts: FileText, accounts: Shield };

export function FeatureGrid() {
  const { t } = useTranslation();

  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('features.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('features.title')}</h2>
          <p className="mt-4 text-base text-muted-foreground">{t('features.subtitle')}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:mt-16 sm:grid-cols-2">
          {FEATURE_KEYS.map((key) => {
            const Icon = ICONS[key];
            return (
              <Card key={key} className="border-border/80 bg-card/50 transition-colors hover:border-border">
                <CardHeader className="space-y-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{t(`features.items.${key}.title`)}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {t(`features.items.${key}.description`)}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
