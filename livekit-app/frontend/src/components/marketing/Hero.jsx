import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { MeetingPreview } from './MeetingPreview';

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pb-32 sm:pt-28">
        <p className="mb-5 text-center text-xs font-medium uppercase tracking-[0.2em] text-primary">Live captions &amp; translation</p>
        <h1 className="mx-auto max-w-3xl text-balance text-center text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
          Video meetings everyone can follow—in their own language.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-center text-base leading-relaxed text-muted-foreground sm:mt-7 sm:text-lg">
          Parley adds live captions and real-time translation to every meeting, so global teams stay aligned. Share a guest link—no account needed—and keep an optional transcript when you want a record.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:mt-12 sm:flex-row sm:gap-4">
          <Button size="lg" className="min-w-[200px] gap-2" asChild>
            <Link to="/v2/signup">
              Start free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="min-w-[200px]" asChild>
            <a href="/#pricing">See pricing</a>
          </Button>
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground sm:mt-6">
          No credit card required · Guests join in one click · Runs in your browser
        </p>
        <MeetingPreview />
      </div>
    </section>
  );
}
