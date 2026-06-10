import { Link } from 'react-router-dom';

const linkClass =
  'rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/10 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold text-foreground">Parley</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Live captions, real-time translation, and AI meeting reports—built for global teams.
          </p>
        </div>
        <nav className="text-sm" aria-label="Product">
          <p className="font-medium text-foreground">Product</p>
          <ul className="mt-3 space-y-2">
            <li>
              <a href="/#features" className={linkClass}>
                Features
              </a>
            </li>
            <li>
              <a href="/#ai-reports" className={linkClass}>
                AI reports
              </a>
            </li>
            <li>
              <a href="/#pricing" className={linkClass}>
                Pricing
              </a>
            </li>
            <li>
              <a href="/#faq" className={linkClass}>
                FAQ
              </a>
            </li>
          </ul>
        </nav>
        <nav className="text-sm" aria-label="Company">
          <p className="font-medium text-foreground">Company</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/v2/login" className={linkClass}>
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/terms" className={linkClass}>
                Terms
              </Link>
            </li>
            <li>
              <Link to="/privacy" className={linkClass}>
                Privacy
              </Link>
            </li>
            <li>
              <a href="mailto:hello@parley.app?subject=Sales%20inquiry" className={linkClass}>
                Contact sales
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-1 border-t border-border/40 px-4 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} Parley. All rights reserved.</p>
        <p>
          Support:{' '}
          <a
            href="mailto:hello@parley.app"
            className="rounded-sm font-medium text-foreground transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            hello@parley.app
          </a>
        </p>
      </div>
    </footer>
  );
}
