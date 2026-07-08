import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/button';
import { useTranslation } from '../../lib/i18n/I18nProvider';

export function MarketingCta() {
  const { t } = useTranslation();

  return (
    <section className="border-t border-border/40 bg-muted/20 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t('cta.title')}</h2>
        <p className="mt-3 text-base text-muted-foreground">{t('cta.subtitle')}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="min-w-[200px] gap-2" asChild>
            <Link to="/v2/signup">
              {t('cta.startFree')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="min-w-[200px]" asChild>
            <a href="mailto:hello@lalia.cloud?subject=Sales%20inquiry">{t('cta.contactSales')}</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
