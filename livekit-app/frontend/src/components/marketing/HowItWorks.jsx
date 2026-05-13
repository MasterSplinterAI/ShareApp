import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';

const steps = [
  { n: '01', title: 'Create your organization', body: 'Sign up, name your workspace, and invite teammates with clear roles.' },
  { n: '02', title: 'Schedule or start a meeting', body: 'Instant or scheduled sessions with policies for host presence and guest links.' },
  { n: '03', title: 'Share the guest link', body: 'Guests join in one click; optional invite tokens keep access tight when you need them.' },
];

export function HowItWorks() {
  return (
    <section className="border-y border-border/40 bg-muted/20 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">How it works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
          Three calm steps from signup to first translated call.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <Card key={s.n} className="border-border/80 bg-background/80">
              <CardHeader>
                <p className="text-xs font-mono text-primary">{s.n}</p>
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
