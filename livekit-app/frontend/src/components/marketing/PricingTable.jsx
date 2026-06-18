import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const TIER_KEYS = ['free', 'starter', 'pro'];
const FEATURE_KEYS = {
  free: ['captions', 'meetings', 'guests', 'limit'],
  starter: ['minutes', 'transcripts', 'dashboard', 'support'],
  pro: ['minutes', 'workspace', 'insights', 'support'],
};

const PRICES = {
  free: { monthly: 0, annual: 0 },
  starter: { monthly: 49, annual: 39 },
  pro: { monthly: 199, annual: 159 },
};

function formatPrice(dollars) {
  if (dollars === 0) return '$0';
  return `$${dollars % 1 === 0 ? dollars : dollars.toFixed(2)}`;
}

function signupHref(tierKey, billingPeriod) {
  if (tierKey === 'free') return '/v2/signup';
  const base = `/v2/signup?plan=${tierKey}`;
  return billingPeriod === 'annual' ? `${base}&billing=annual` : base;
}

export function PricingTable() {
  const { t } = useTranslation();
  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const isAnnual = billingPeriod === 'annual';

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

        <div className="mt-10 flex flex-col items-center gap-2 sm:mt-12">
          <div
            className="inline-flex rounded-lg border border-border bg-background p-1"
            role="group"
            aria-label={t('pricing.billingToggleLabel')}
          >
            <button
              type="button"
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                !isAnnual ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setBillingPeriod('monthly')}
            >
              {t('pricing.monthly')}
            </button>
            <button
              type="button"
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                isAnnual ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setBillingPeriod('annual')}
            >
              {t('pricing.annual')}
              <span className="ml-1.5 text-xs opacity-90">({t('pricing.annualSave')})</span>
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t('pricing.participantMinutesFootnote')}</p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-4">
          {TIER_KEYS.map((tierKey) => {
            const prices = PRICES[tierKey];
            const displayPrice = isAnnual ? prices.annual : prices.monthly;
            const highlight = tierKey === 'pro';
            const features = FEATURE_KEYS[tierKey];
            return (
              <Card
                key={tierKey}
                className={`relative flex flex-col border-border/80 ${highlight ? 'border-primary/50 bg-primary/5 shadow-md shadow-primary/10' : 'bg-card/50'}`}
              >
                {highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge>{t('pricing.popular')}</Badge>
                  </div>
                )}
                <CardHeader className="pt-8">
                  <CardTitle className="text-xl">{t(`pricing.tiers.${tierKey}.name`)}</CardTitle>
                  <CardDescription className="text-sm">{t(`pricing.tiers.${tierKey}.blurb`)}</CardDescription>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight text-foreground">
                      {formatPrice(displayPrice)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {tierKey === 'free'
                        ? t('pricing.period')
                        : isAnnual
                          ? t('pricing.periodAnnual')
                          : t('pricing.period')}
                    </span>
                  </div>
                  {isAnnual && tierKey !== 'free' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('pricing.billedAnnually', { total: formatPrice(displayPrice * 12) })}
                    </p>
                  )}
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
                  <Button className="w-full" variant={highlight ? 'default' : 'outline'} asChild>
                    <Link to={signupHref(tierKey, billingPeriod)}>{t(`pricing.tiers.${tierKey}.cta`)}</Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}

          <Card className="flex flex-col border-border/80 bg-card/50">
            <CardHeader className="pt-8">
              <CardTitle className="text-xl">{t('pricing.tiers.enterprise.name')}</CardTitle>
              <CardDescription className="text-sm">{t('pricing.tiers.enterprise.blurb')}</CardDescription>
              <div className="mt-4">
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {t('pricing.tiers.enterprise.priceLabel')}
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
              {['volume', 'security', 'support', 'terms'].map((featureKey) => (
                <div key={featureKey} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{t(`pricing.tiers.enterprise.features.${featureKey}`)}</span>
                </div>
              ))}
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button className="w-full" variant="outline" asChild>
                <a href="mailto:hello@parley.app?subject=Enterprise%20demo%20request">{t('pricing.tiers.enterprise.ctaDemo')}</a>
              </Button>
              <Button className="w-full" variant="ghost" asChild>
                <a href="mailto:hello@parley.app?subject=Enterprise%20pricing">{t('pricing.tiers.enterprise.ctaSales')}</a>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
