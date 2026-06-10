import { Globe2, Mic, Shield, FileText } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';

const items = [
  {
    icon: Globe2,
    title: 'Real-time translation',
    description: 'Participants choose a language lane; speech is transcribed and translated in the flow of the meeting.',
  },
  {
    icon: Mic,
    title: 'Live captions',
    description: 'Side-by-side captions keep everyone on the same page—even in noisy environments or accessibility-first teams.',
  },
  {
    icon: FileText,
    title: 'Transcripts you control',
    description: 'Per-meeting policy to save finalized lines on the server, with JSON and plain-text download when you need records.',
  },
  {
    icon: Shield,
    title: 'Organizations & roles',
    description: 'Multi-tenant workspaces with owners, admins, and members, plus the controls operators need to stay in charge.',
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Features</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Built for clarity</h2>
          <p className="mt-4 text-base text-muted-foreground">
            Everything runs in your browser—a focused host experience and one-click guest links.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:mt-16 sm:grid-cols-2">
          {items.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="border-border/80 bg-card/50 transition-colors hover:border-border">
              <CardHeader className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
