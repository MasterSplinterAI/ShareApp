import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, LayoutDashboard, LifeBuoy, LogOut, Menu, Settings, Shield, Sparkles, Video, X } from 'lucide-react';
import { v2Announcements } from '../../services/apiV2';
import HelpPanel from '../../components/HelpPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '../../components/ui/sheet';
import { cn } from '../../lib/utils';
import { workspaceLabel, workspaceKindLabel } from '../lib/workspaceDisplay';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useTranslation } from '../../lib/i18n/I18nProvider';
import { useUpgradeOffer } from '../hooks/useUpgradeOffer';
import { UpgradeSidebarCard } from './UpgradePrompt';

function navLinkClass({ isActive }) {
  return cn(
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive
      ? 'bg-primary/10 font-medium text-primary'
      : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
  );
}

function SidebarNav({ onNavigate, isSuperadmin }) {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-2 py-4" onClick={onNavigate} data-no-translate="true">
      <NavLink to="/v2/app" end className={navLinkClass}>
        <Home className="h-4 w-4 shrink-0" />
        {t('app.home')}
      </NavLink>
      <NavLink to="/v2/app/meetings" className={navLinkClass}>
        <Video className="h-4 w-4 shrink-0" />
        {t('app.meetings')}
      </NavLink>
      <NavLink to="/v2/app/settings" className={navLinkClass}>
        <Settings className="h-4 w-4 shrink-0" />
        {t('app.settings')}
      </NavLink>
      {isSuperadmin && (
        <NavLink to="/v2/app/admin" end className={navLinkClass}>
          <Shield className="h-4 w-4 shrink-0 opacity-70" />
          {t('app.admin')}
        </NavLink>
      )}
    </nav>
  );
}

export default function V2AppShell({ me, onLogout }) {
  const { t } = useTranslation();
  const { offer, checkoutLoading, startCheckout } = useUpgradeOffer(me);
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('v2_dismissed_announcements') || '[]'));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    v2Announcements.active().then((r) => setAnnouncements(r.announcements || [])).catch(() => {});
  }, []);

  const visibleAnnouncements = announcements.filter((a) => !dismissed.has(a.id));

  const dismissAnnouncement = (id) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem('v2_dismissed_announcements', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const levelStyles = {
    info: 'border-primary/30 bg-primary/10 text-foreground',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100',
    critical: 'border-destructive/40 bg-destructive/10 text-destructive',
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const displayName = me?.user?.display_name || me?.user?.displayName || null;
  const initial = (displayName || me?.user?.email || '?').slice(0, 1).toUpperCase();
  const sidebarTitle = workspaceLabel({ org: me?.org, user: me?.user });
  const sidebarSubtitle = workspaceKindLabel(me?.org);
  const planStatus = me?.org?.billing_status || null;

  const sidebarBody = (
    <>
      <div className="border-b border-border/60 px-4 py-4" data-no-translate="true">
        <Link to="/v2/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          Parley
        </Link>
        <div className="mt-2.5 flex flex-col gap-0.5">
          <p className="min-w-0 truncate text-xs font-medium text-foreground" title={sidebarTitle}>
            {sidebarTitle}
          </p>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground">{sidebarSubtitle}</p>
            {planStatus && (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-medium capitalize">
                {planStatus}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <SidebarNav onNavigate={() => setMobileOpen(false)} isSuperadmin={Boolean(me?.isSuperadmin)} />
      <UpgradeSidebarCard offer={offer} checkoutLoading={checkoutLoading} onCheckout={startCheckout} />
      <div className="mt-auto border-t border-border/60 p-3 space-y-2" data-no-translate="true">
        <div className="flex justify-center px-1">
          <LanguageSwitcher className="w-full justify-center" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-auto w-full justify-start gap-2 rounded-lg border-border/60 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initial}
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
                {me?.user?.email || t('app.account')}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName || t('app.member')}</p>
                <p className="text-xs leading-none text-muted-foreground">{me?.user?.email}</p>
                {me?.role && (
                  <p className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('app.role', { role: me.role })}
                  </p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {offer?.show && (
              <DropdownMenuItem asChild>
                <Link to="/v2/app/settings?section=billing" className="text-primary focus:text-primary">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Upgrade plan
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setHelpOpen(true)}>
              <LifeBuoy className="mr-2 h-4 w-4" />
              {t('app.helpSupport')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onLogout();
              }}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t('app.logOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <div className="app-surface flex min-h-screen w-full text-foreground">
      <aside className="app-sidebar hidden w-60 shrink-0 flex-col border-r border-border/70 md:flex">
        {sidebarBody}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-sidebar sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 px-4 backdrop-blur-md md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t('app.openMenu')}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-2rem,18rem)] flex-col p-0">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{sidebarBody}</div>
            </SheetContent>
          </Sheet>
          <Link to="/v2/app" className="min-w-0 flex-1 truncate text-sm font-semibold">
            Parley
          </Link>
          <LanguageSwitcher compact />
        </header>

        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {visibleAnnouncements.length > 0 && (
            <div className="mb-4 space-y-2">
              {visibleAnnouncements.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${levelStyles[a.level] || levelStyles.info}`}
                  role="status"
                >
                  <p className="min-w-0 flex-1">{a.message}</p>
                  <button
                    type="button"
                    onClick={() => dismissAnnouncement(a.id)}
                    className="shrink-0 rounded p-1 opacity-70 hover:opacity-100"
                    aria-label={t('app.dismissAnnouncement')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Outlet />
        </main>
        <HelpPanel open={helpOpen} onOpenChange={setHelpOpen} isLoggedIn userEmail={me?.user?.email} />
      </div>
    </div>
  );
}
