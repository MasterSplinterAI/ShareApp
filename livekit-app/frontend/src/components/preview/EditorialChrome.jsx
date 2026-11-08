import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Eye, Menu } from 'lucide-react';
import { Button } from '../ui/button';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';

/**
 * Editorial preview banner, navigation, and footer in Lalia's Slate & Royal Blue palette.
 */

export function EditorialPreviewBar() {
  const location = useLocation();
  const isHome = location.pathname === '/preview/home';
  const isBlog = location.pathname.startsWith('/preview/blog');

  return (
    <div
      className="border-b border-blue-500/30 bg-slate-950 px-4 py-2 text-xs text-slate-200"
      data-no-translate="true"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-600/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300 ring-1 ring-blue-400/30">
            <Eye className="h-3 w-3" />
            Unlisted Design Preview
          </span>
          <span className="hidden text-slate-400 sm:inline">
            Slate &amp; Royal Blue editorial system (`Manrope` + `DM Sans`) · Live `/` is untouched
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            to="/preview/home"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isHome
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Preview Home
          </Link>
          <Link
            to="/preview/blog"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isBlog
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Preview Journal (3 posts)
          </Link>
          <span className="text-slate-700">|</span>
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:text-white"
          >
            Compare current `/`
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function EditorialNav() {
  const [open, setOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() =>
    typeof localStorage !== 'undefined' ? Boolean(localStorage.getItem('v2_token')) : false
  );

  useEffect(() => {
    const sync = () => setHasToken(Boolean(localStorage.getItem('v2_token')));
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            to="/preview/home"
            className="flex items-center gap-2 text-base font-extrabold tracking-tight text-slate-900 dark:text-white"
            style={{ fontFamily: "'Manrope', sans-serif" }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-extrabold text-white">
              l.
            </span>
            <span>Lalia</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex dark:text-slate-300">
            <a
              href="/preview/home#how-it-works"
              className="transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              How it works
            </a>
            <a
              href="/preview/home#moments"
              className="transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Use cases
            </a>
            <a
              href="/preview/home#pricing"
              className="transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Pricing
            </a>
            <Link
              to="/preview/blog"
              className="transition-colors hover:text-slate-900 dark:hover:text-white"
            >
              Journal
            </Link>
            <Link
              to="/demo"
              className="font-semibold text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400"
            >
              Live demo ↗
            </Link>
          </nav>
        </div>

        <div className="hidden items-center gap-2.5 md:flex">
          <LanguageSwitcher />
          {hasToken ? (
            <Button asChild size="sm" className="bg-blue-600 text-white hover:bg-blue-500">
              <Link to="/v2/app">Open workspace ↗</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/v2/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="gap-1 bg-blue-600 text-white hover:bg-blue-500">
                <Link to="/v2/signup">
                  Start talking for free
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher compact />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(100vw-2rem,20rem)]">
              <SheetHeader>
                <SheetTitle>Lalia</SheetTitle>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-4 text-base font-medium">
                <Link to="/preview/home" onClick={() => setOpen(false)}>
                  Home (Editorial Preview)
                </Link>
                <Link to="/preview/blog" onClick={() => setOpen(false)}>
                  Lalia Journal
                </Link>
                <a href="/preview/home#how-it-works" onClick={() => setOpen(false)}>
                  How it works
                </a>
                <a href="/preview/home#pricing" onClick={() => setOpen(false)}>
                  Pricing
                </a>
                <Link
                  to="/demo"
                  className="text-blue-600 dark:text-blue-400"
                  onClick={() => setOpen(false)}
                >
                  Try the live demo ↗
                </Link>
                <div className="mt-4 flex flex-col gap-2 border-t border-border pt-6">
                  {hasToken ? (
                    <Button asChild onClick={() => setOpen(false)}>
                      <Link to="/v2/app">Open workspace</Link>
                    </Button>
                  ) : (
                    <>
                      <Button variant="outline" asChild onClick={() => setOpen(false)}>
                        <Link to="/v2/login">Sign in</Link>
                      </Button>
                      <Button
                        asChild
                        className="bg-blue-600 text-white hover:bg-blue-500"
                        onClick={() => setOpen(false)}
                      >
                        <Link to="/v2/signup">Start talking for free ↗</Link>
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

export function EditorialConversionBand({
  eyebrow = 'TAKE THE CONVERSATION A LITTLE FURTHER',
  line1 = 'Bring your next call into one room.',
  line2 = 'Speak your language. They’ll hear theirs.',
  deck = 'Start with a ten-minute check-in, a supplier update, or a quick 1-on-1 call. Try the live voice demo in your browser first, or create a free account when you are ready.',
}) {
  return (
    <section className="border-t border-slate-200/80 bg-gradient-to-b from-blue-50/70 via-slate-50 to-slate-50 py-20 sm:py-24 dark:border-slate-800 dark:from-blue-950/30 dark:via-slate-950 dark:to-slate-950">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="rounded-3xl border border-blue-200/90 bg-white p-8 shadow-sm sm:p-12 dark:border-blue-500/30 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
            {eyebrow}
          </p>
          <h2
            className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl dark:text-white"
            style={{ fontFamily: "'Manrope', sans-serif", lineHeight: 1.1 }}
          >
            {line1}
            <span className="mt-1 block text-blue-600 dark:text-blue-400">{line2}</span>
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
            {deck}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="h-12 gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              <Link to="/v2/signup">
                Start talking for free
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 rounded-xl border-slate-300 px-6 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Link to="/demo">Try the live demo</Link>
            </Button>
            <a
              href="/preview/home#pricing"
              className="px-3 py-2 text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white"
            >
              Compare plans →
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Free plan includes 60 participant-minutes a month · No credit card required · Guests join in browser with no install.
          </p>
        </div>
      </div>
    </section>
  );
}

export function EditorialFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200/80 bg-slate-100/60 py-14 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Link
            to="/preview/home"
            className="inline-flex items-center gap-2 text-base font-extrabold tracking-tight text-slate-900 dark:text-white"
            style={{ fontFamily: "'Manrope', sans-serif" }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-extrabold text-white">
              l.
            </span>
            <span>Lalia</span>
          </Link>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            A little less distance. Speak in your own language and be understood in theirs—with live voice translation, bilingual captions, and shared meeting summaries.
          </p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-900 dark:text-white">
            Product &amp; Journal
          </p>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li>
              <Link to="/preview/home" className="hover:text-slate-900 dark:hover:text-white">
                Editorial Home
              </Link>
            </li>
            <li>
              <Link to="/preview/blog" className="hover:text-slate-900 dark:hover:text-white">
                Lalia Journal
              </Link>
            </li>
            <li>
              <Link to="/demo" className="hover:text-slate-900 dark:hover:text-white">
                Try the live voice demo
              </Link>
            </li>
            <li>
              <a href="/preview/home#pricing" className="hover:text-slate-900 dark:hover:text-white">
                Pricing &amp; plans
              </a>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-900 dark:text-white">
            Account &amp; Trust
          </p>
          <ul className="mt-3 space-y-2.5 text-sm">
            <li>
              <Link to="/v2/login" className="hover:text-slate-900 dark:hover:text-white">
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/v2/signup" className="hover:text-slate-900 dark:hover:text-white">
                Start talking for free
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="hover:text-slate-900 dark:hover:text-white">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link to="/terms" className="hover:text-slate-900 dark:hover:text-white">
                Terms of Service
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-2 border-t border-slate-200/80 px-4 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-800">
        <p>© {year} Lalia. Meetings are not recorded; content is never used to train Lalia’s own models.</p>
        <p>
          Questions?{' '}
          <a
            href="mailto:hello@lalia.cloud"
            className="font-medium text-slate-900 hover:underline dark:text-white"
          >
            hello@lalia.cloud
          </a>
        </p>
      </div>
    </footer>
  );
}
