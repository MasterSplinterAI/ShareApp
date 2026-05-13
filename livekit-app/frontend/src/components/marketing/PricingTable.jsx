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
    blurb: 'Try the workspace with core meetings.',
    features: ['Up to 3 members', 'Instant & scheduled meetings', 'Live captions', 'Community support'],
    cta: 'Start free',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/ org / month',
    blurb: 'For teams that meet weekly across regions.',
    features: ['Up to 25 members', 'Transcript storage & download', 'Usage visibility', 'Email support'],
    cta: 'Start free',
    highlight: true,
  },
  {
    name: 'Business',
    price: '$99',
    period: '/ org / month',
    blurb: 'Placeholder tier for larger rollouts.',
    features: ['Up to 100 members', 'Admin & audit roadmap', 'SSO (planned)', 'Dedicated success'],
    cta: 'Start free',
    highlight: false,
  },
];

export function PricingTable() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Pricing</h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Placeholder numbers for positioning and UX—billing is wired separately when you are ready to charge.
        </p>
      </div>
      <div className="mt-4 flex justify-center">
        <Badge variant="secondary" className="text-xs font-normal">
          Placeholder pricing
        </Badge>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
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
                <Link to="/v2/signup">{t.cta}</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
