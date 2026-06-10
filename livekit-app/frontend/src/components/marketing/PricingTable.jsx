import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: '/ org / month',
    blurb: '60 participant-minutes per month — perfect to try Parley.',
    features: ['Live captions & translation', 'Instant & scheduled meetings', 'Guest links', 'Hard stop at 60 min/mo'],
    cta: 'Start free',
    href: '/v2/signup',
    highlight: false,
    planId: 'free',
  },
  {
    name: 'Starter',
    price: '$49',
    period: '/ org / month',
    blurb: 'For small teams meeting across languages weekly.',
    features: ['2,000 participant-minutes', 'Transcript storage', 'Usage dashboard', 'Email support'],
    cta: 'Get Starter',
    href: '/v2/signup?plan=starter',
    highlight: false,
    planId: 'starter',
  },
  {
    name: 'Pro',
    price: '$199',
    period: '/ org / month',
    blurb: 'For teams that need workspace seats and higher volume.',
    features: ['10,000 participant-minutes', 'Team workspace & invites', 'AI transcript insights', 'Priority support'],
    cta: 'Get Pro',
    href: '/v2/signup?plan=pro',
    highlight: true,
    planId: 'pro',
  },
];

export function PricingTable() {
  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border/60 bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Pricing</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Start free, scale as you grow
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Begin with 60 participant-minutes a month. Upgrade when you’re ready—billed per organization.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:mt-16 lg:grid-cols-3">
          {tiers.map((t) => (
            <Card
              key={t.name}
              className={`relative flex flex-col border-border/80 ${t.highlight ? 'border-primary/50 bg-primary/5 shadow-md shadow-primary/10' : 'bg-card/50'}`}
            >
              {t.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge>Popular</Badge>
                </div>
              )}
              <CardHeader className="pt-8">
                <CardTitle className="text-xl">{t.name}</CardTitle>
                <CardDescription className="text-sm">{t.blurb}</CardDescription>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight text-foreground">{t.price}</span>
                  <span className="text-sm text-muted-foreground">{t.period}</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {t.features.map((f) => (
                  <div key={f} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </div>
                ))}
              </CardContent>
              <CardFooter>
                <Button className="w-full" variant={t.highlight ? 'default' : 'outline'} asChild>
                  <Link to={t.href}>{t.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
