import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';

const navLinkClass =
  'rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function MarketingNav() {
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

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          to="/"
          className="rounded-sm text-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Parley
        </Link>
        <nav className="flex items-center gap-3 sm:gap-4" aria-label="Primary">
          <a href="/#features" className={`hidden ${navLinkClass} sm:inline`}>
            Features
          </a>
          <a href="/#ai-reports" className={`hidden ${navLinkClass} md:inline`}>
            AI reports
          </a>
          <a href="/#pricing" className={`hidden ${navLinkClass} sm:inline`}>
            Pricing
          </a>
          <a href="/#faq" className={`hidden ${navLinkClass} md:inline`}>
            FAQ
          </a>
          {hasToken ? (
            <Button asChild size="sm">
              <Link to="/v2/app">Open workspace</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/v2/login">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/v2/signup">Start free</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
