import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { MarketingNav } from '../components/marketing/MarketingNav';
import { Button } from '../components/ui/button';
import V2AppShell from './components/V2AppShell';
import { v2Auth } from '../services/apiV2';

export default function V2Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('v2_token') : null;
  const isPublicAuth = location.pathname === '/v2/login' || location.pathname === '/v2/signup';
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    v2Auth
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, [token]);

  const logout = () => {
    localStorage.removeItem('v2_token');
    navigate('/v2/login', { replace: true });
  };

  if (isPublicAuth) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <MarketingNav />
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <Outlet />
        </main>
      </div>
    );
  }

  if (token) {
    return <V2AppShell me={me} onLogout={logout} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            Conference V2
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/v2/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/v2/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
