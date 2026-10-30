import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const STEP_KEYS = ['one', 'two', 'three'];
const STEP_NUMBERS = { one: '01', two: '02', three: '03' };

export function HowItWorks() {
  const { t } = useTranslation();

  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('howItWorks.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t('howItWorks.title')}
          </h2>
          <p className="mt-4 text-base text-muted-foreground">{t('howItWorks.subtitle')}</p>
        </div>
        <div className="mt-12 grid gap-5 sm:mt-16 sm:gap-6 md:grid-cols-3">
          {STEP_KEYS.map((key) => (
            <Card key={key} className="border-border/80 bg-card/50 transition-colors hover:border-border">
              <CardHeader>
                <p className="font-mono text-xs text-primary">{STEP_NUMBERS[key]}</p>
                <CardTitle className="text-base">{t(`howItWorks.steps.${key}.title`)}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{t(`howItWorks.steps.${key}.body`)}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
