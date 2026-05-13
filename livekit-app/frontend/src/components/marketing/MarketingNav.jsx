import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';

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
        <Link to="/" className="text-sm font-semibold tracking-tight text-foreground">
          JarMetals Conference
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href="#features" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline">
            Features
          </a>
          <a href="#pricing" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline">
            Pricing
          </a>
          <a href="#faq" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline">
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
