import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Shield, Users } from 'lucide-react';
import { MarketingNav } from '../components/marketing/MarketingNav';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { v2Auth } from '../services/apiV2';

function navLinkClass({ isActive }) {
  return isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground transition-colors';
}

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

  const initial = (me?.user?.email || me?.user?.displayName || '?').slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {isPublicAuth ? (
        <MarketingNav />
      ) : (
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link to={token ? '/v2/app' : '/'} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <LayoutDashboard className="h-5 w-5 text-primary" />
              Conference V2
            </Link>
            {token ? (
              <div className="flex items-center gap-1 sm:gap-3">
                <nav className="hidden items-center gap-4 text-sm sm:flex">
                  <NavLink to="/v2/app" end className={navLinkClass}>
                    Home
                  </NavLink>
                  <NavLink to="/v2/app/meetings" className={navLinkClass}>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      Meetings
                    </span>
                  </NavLink>
                  <NavLink to="/v2/app/settings" className={navLinkClass}>
                    <span className="inline-flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5" />
                      Settings
                    </span>
                  </NavLink>
                  <NavLink to="/v2/app/superadmin" className={`${navLinkClass} text-xs text-muted-foreground`}>
                    Admin
                  </NavLink>
                </nav>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-2 rounded-full border-border px-2 sm:px-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                        {initial}
                      </span>
                      <span className="hidden max-w-[140px] truncate text-xs text-muted-foreground sm:inline">
                        {me?.user?.email || 'Account'}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{me?.user?.displayName || 'Member'}</p>
                        <p className="text-xs leading-none text-muted-foreground">{me?.user?.email}</p>
                        {me?.role && (
                          <p className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Role: {me.role}</p>
                        )}
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="sm:hidden">
                      <Link to="/v2/app">Home</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="sm:hidden">
                      <Link to="/v2/app/meetings">Meetings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="sm:hidden">
                      <Link to="/v2/app/settings">Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="sm:hidden" />
                    <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/v2/login">Sign in</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/v2/signup">Start free</Link>
                </Button>
              </div>
            )}
          </div>
        </header>
      )}
      <main className={`mx-auto max-w-6xl px-4 ${isPublicAuth ? 'py-10 sm:px-6' : 'py-8 sm:px-6'}`}>
        <Outlet />
      </main>
    </div>
  );
}
