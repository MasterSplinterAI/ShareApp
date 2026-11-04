import { Link } from 'react-router-dom';
import { ArrowRight, Globe2, Mail, Phone, Sparkles, Users } from 'lucide-react';
import { Button } from '../ui/button';
import { MeetingPreview } from './MeetingPreview';
import { useTranslation } from '../../lib/i18n/I18nProvider';

export function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.14),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 sm:pb-32 sm:pt-24">
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {t('hero.eyebrow')}
        </p>
        <h1 className="mx-auto max-w-4xl text-balance text-center text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
          {t('hero.title')}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-center text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
          {t('hero.subtitle')}
        </p>

        {/* Three core value pills: 1-on-1 Direct Calling, Group Meetings, AI Insights + Email */}
        <div className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-2 sm:gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Phone className="h-3.5 w-3.5" />
            1-Tap Direct Calling
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary">
            <Users className="h-3.5 w-3.5" />
            Multi-Person Meetings
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-3.5 py-1.5 text-xs font-medium text-foreground">
            <Globe2 className="h-3.5 w-3.5 text-primary" />
            30+ Languages Live Voice &amp; Captions
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/80 px-3.5 py-1.5 text-xs font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI Insights &amp; 1-Click Email
            <Mail className="h-3 w-3 text-muted-foreground" />
          </span>
        </div>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-4">
          <Button size="lg" className="min-w-[230px] gap-2" asChild>
            <Link to="/v2/signup">
              {t('hero.startFree')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="min-w-[230px] gap-2" asChild>
            <Link to="/demo">
              <Sparkles className="h-4 w-4 text-primary" />
              {t('hero.tryTranslation')}
            </Link>
          </Button>
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground sm:mt-6">{t('hero.footnote')}</p>
        <MeetingPreview />
      </div>
    </section>
  );
}
