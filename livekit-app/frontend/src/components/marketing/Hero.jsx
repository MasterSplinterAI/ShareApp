import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { MeetingPreview } from './MeetingPreview';
import { useTranslation } from '../../lib/i18n/I18nProvider';

export function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pb-32 sm:pt-28">
        <p className="mb-5 text-center text-xs font-medium uppercase tracking-[0.2em] text-primary">
          {t('hero.eyebrow')}
        </p>
        <h1 className="mx-auto max-w-3xl text-balance text-center text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
          {t('hero.title')}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-center text-base leading-relaxed text-muted-foreground sm:mt-7 sm:text-lg">
          {t('hero.subtitle')}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:mt-12 sm:flex-row sm:gap-4">
          <Button size="lg" className="min-w-[220px] gap-2" asChild>
            <Link to="/v2/signup">
              {t('hero.startFree')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="min-w-[220px]" asChild>
            <Link to="/demo">{t('hero.tryTranslation')}</Link>
          </Button>
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground sm:mt-6">{t('hero.footnote')}</p>
        <MeetingPreview />
      </div>
    </section>
  );
}
