import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';

const steps = [
  { n: '01', title: 'Create your organization', body: 'Sign up, name your workspace, and invite teammates with clear roles.' },
  { n: '02', title: 'Schedule or start a meeting', body: 'Instant or scheduled sessions with policies for host presence and guest links.' },
  { n: '03', title: 'Share the guest link', body: 'Guests join in one click; optional invite tokens keep access tight when you need them.' },
];

export function HowItWorks() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">How it works</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            From signup to your first translated call
          </h2>
          <p className="mt-4 text-base text-muted-foreground">Three quick steps—no downloads, no setup.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:mt-16 sm:gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <Card key={s.n} className="border-border/80 bg-card/50 transition-colors hover:border-border">
              <CardHeader>
                <p className="font-mono text-xs text-primary">{s.n}</p>
                <CardTitle className="text-base">{s.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{s.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
