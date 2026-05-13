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
    description: 'Multi-tenant workspace with owners, admins, and members—plus optional platform superadmin tools for operations.',
  },
];

export function FeatureGrid() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Built for clarity</h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Everything runs in the browser with a focused host experience and simple guest join links.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2">
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
    </section>
  );
}
