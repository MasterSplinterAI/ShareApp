import { Link } from 'react-router-dom';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const linkClass =
  'rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function MarketingFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-muted/10 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold text-foreground">Lalia</p>
          <p className="text-xs text-muted-foreground">Multilingual meetings</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{t('footer.tagline')}</p>
        </div>
        <nav className="text-sm" aria-label="Product">
          <p className="font-medium text-foreground">{t('footer.product')}</p>
          <ul className="mt-3 space-y-2">
            <li>
              <a href="/#platform" className={linkClass}>
                {t('footer.platform')}
              </a>
            </li>
            <li>
              <a href="/#features" className={linkClass}>
                {t('footer.features')}
              </a>
            </li>
            <li>
              <a href="/#ai-reports" className={linkClass}>
                {t('footer.aiReports')}
              </a>
            </li>
            <li>
              <a href="/#pricing" className={linkClass}>
                {t('footer.pricing')}
              </a>
            </li>
            <li>
              <a href="/#faq" className={linkClass}>
                {t('footer.faq')}
              </a>
            </li>
          </ul>
        </nav>
        <nav className="text-sm" aria-label="Company">
          <p className="font-medium text-foreground">{t('footer.company')}</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/v2/login" className={linkClass}>
                {t('footer.signIn')}
              </Link>
            </li>
            <li>
              <Link to="/terms" className={linkClass}>
                {t('footer.terms')}
              </Link>
            </li>
            <li>
              <Link to="/privacy" className={linkClass}>
                {t('footer.privacy')}
              </Link>
            </li>
            <li>
              <a href="mailto:hello@lalia.cloud?subject=Sales%20inquiry" className={linkClass}>
                {t('footer.contactSales')}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-1 border-t border-border/40 px-4 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{t('footer.copyright', { year })}</p>
        <p>
          {t('footer.support')}{' '}
          <a
            href="mailto:hello@lalia.cloud"
            className="rounded-sm font-medium text-foreground transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            hello@lalia.cloud
          </a>
        </p>
      </div>
    </footer>
  );
}
