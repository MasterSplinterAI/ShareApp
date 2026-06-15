import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const TIER_KEYS = ['free', 'starter', 'pro'];
const TIER_META = {
  free: { price: '$0', href: '/v2/signup', highlight: false },
  starter: { price: '$49', href: '/v2/signup?plan=starter', highlight: false },
  pro: { price: '$199', href: '/v2/signup?plan=pro', highlight: true },
};
const FEATURE_KEYS = {
  free: ['captions', 'meetings', 'guests', 'limit'],
  starter: ['minutes', 'transcripts', 'dashboard', 'support'],
  pro: ['minutes', 'workspace', 'insights', 'support'],
};

export function PricingTable() {
  const { t } = useTranslation();

  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border/60 bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('pricing.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {t('pricing.title')}
          </h2>
          <p className="mt-4 text-base text-muted-foreground">{t('pricing.subtitle')}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:mt-16 lg:grid-cols-3">
          {TIER_KEYS.map((tierKey) => {
            const meta = TIER_META[tierKey];
            const features = FEATURE_KEYS[tierKey];
            return (
              <Card
                key={tierKey}
                className={`relative flex flex-col border-border/80 ${meta.highlight ? 'border-primary/50 bg-primary/5 shadow-md shadow-primary/10' : 'bg-card/50'}`}
              >
                {meta.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge>{t('pricing.popular')}</Badge>
                  </div>
                )}
                <CardHeader className="pt-8">
                  <CardTitle className="text-xl">{t(`pricing.tiers.${tierKey}.name`)}</CardTitle>
                  <CardDescription className="text-sm">{t(`pricing.tiers.${tierKey}.blurb`)}</CardDescription>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight text-foreground">{meta.price}</span>
                    <span className="text-sm text-muted-foreground">{t('pricing.period')}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  {features.map((featureKey) => (
                    <div key={featureKey} className="flex gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{t(`pricing.tiers.${tierKey}.features.${featureKey}`)}</span>
                    </div>
                  ))}
                </CardContent>
                <CardFooter>
                  <Button className="w-full" variant={meta.highlight ? 'default' : 'outline'} asChild>
                    <Link to={meta.href}>{t(`pricing.tiers.${tierKey}.cta`)}</Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
