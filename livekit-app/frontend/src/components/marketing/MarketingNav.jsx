import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '../ui/button';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const navLinkClass =
  'rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const MOBILE_LINKS = [
  { href: '/#features', key: 'features' },
  { href: '/#ai-reports', key: 'aiReports' },
  { href: '/#pricing', key: 'pricing' },
  { href: '/#faq', key: 'faq' },
];

export function MarketingNav() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() =>
    typeof localStorage !== 'undefined' ? !!localStorage.getItem('v2_token') : false
  );

  useEffect(() => {
    const sync = () => setHasToken(!!localStorage.getItem('v2_token'));
    window.addEventListener('storage', sync);
    const id = setInterval(sync, 2000);
    return () => {
      window.removeEventListener('storage', sync);
      clearInterval(id);
    };
  }, []);

  const authButtons = hasToken ? (
    <Button asChild size="sm">
      <Link to="/v2/app">{t('nav.openWorkspace')}</Link>
    </Button>
  ) : (
    <>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/v2/login">{t('nav.signIn')}</Link>
      </Button>
      <Button size="sm" asChild>
        <Link to="/v2/signup">{t('nav.startFree')}</Link>
      </Button>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          to="/"
          className="rounded-sm text-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Parley
        </Link>

        <nav className="hidden items-center gap-1 sm:flex sm:gap-2" aria-label="Primary">
          <a href="/#features" className={navLinkClass}>
            {t('nav.features')}
          </a>
          <a href="/#ai-reports" className={`hidden ${navLinkClass} md:inline`}>
            {t('nav.aiReports')}
          </a>
          <a href="/#pricing" className={navLinkClass}>
            {t('nav.pricing')}
          </a>
          <a href="/#faq" className={`hidden ${navLinkClass} md:inline`}>
            {t('nav.faq')}
          </a>
          <LanguageSwitcher />
          {authButtons}
        </nav>

        <div className="flex items-center gap-2 sm:hidden">
          <LanguageSwitcher />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('nav.openMenu')}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(100vw-2rem,20rem)]">
              <SheetHeader>
                <SheetTitle>{t('nav.menuTitle')}</SheetTitle>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-4" aria-label="Mobile">
                {MOBILE_LINKS.map((link) => (
                  <a
                    key={link.key}
                    href={link.href}
                    className="text-base font-medium text-foreground"
                    onClick={() => setOpen(false)}
                  >
                    {t(`nav.${link.key}`)}
                  </a>
                ))}
                <div className="mt-4 flex flex-col gap-2 border-t border-border pt-6">
                  {hasToken ? (
                    <Button asChild onClick={() => setOpen(false)}>
                      <Link to="/v2/app">{t('nav.openWorkspace')}</Link>
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" asChild onClick={() => setOpen(false)}>
                        <Link to="/v2/login">{t('nav.signIn')}</Link>
                      </Button>
                      <Button asChild onClick={() => setOpen(false)}>
                        <Link to="/v2/signup">{t('nav.startFree')}</Link>
                      </Button>
                    </>
                  )}
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
