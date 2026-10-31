import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Check, ChevronsUpDown, Home, LayoutDashboard, LifeBuoy, LogOut, Menu, Phone, Settings, Shield, Sparkles, Video, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Announcements, v2Auth } from '../../services/apiV2';
import { detectBrowserTimezone } from '../lib/guestInvitePrefsUi';
import LaliaSupportLauncher from './LaliaSupportLauncher';
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
import IncomingCallOverlay from './IncomingCallOverlay';

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
      <NavLink to="/v2/app/calls" className={navLinkClass}>
        <Phone className="h-4 w-4 shrink-0" />
        {t('app.calls')}
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

function mobileTabClass({ isActive }) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  );
}

export default function V2AppShell({ me, onLogout }) {
  const { t } = useTranslation();
  const { offer, checkoutLoading, startCheckout } = useUpgradeOffer(me);
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const openHelpRef = useRef(null);
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

  // Persist browser timezone once so guest invite emails don't fall back to UTC.
  useEffect(() => {
    if (!me?.user?.id) return;
    v2Auth
      .communicationPrefs()
      .then((r) => {
        if (r.prefs?.timezone) return;
        return v2Auth.updateCommunicationPrefs({ timezone: detectBrowserTimezone() });
      })
      .catch(() => {});
  }, [me?.user?.id]);

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
  const workspaces = Array.isArray(me?.workspaces) ? me.workspaces : [];

  const handleSwitchWorkspace = async (targetOrgId) => {
    if (!targetOrgId || targetOrgId === me?.org?.id) return;
    try {
      const res = await v2Auth.switchWorkspace(targetOrgId);
      if (res?.token) {
        localStorage.setItem('v2_token', res.token);
        toast.success(`Switched to ${res.org?.name || 'workspace'}`);
        window.location.href = '/v2/app';
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not switch workspace');
    }
  };

  const sidebarBody = (
    <>
      <div className="border-b border-border/60 px-4 py-4" data-no-translate="true">
        <Link to="/v2/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          Lalia
        </Link>
        {workspaces.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{sidebarTitle}</p>
                  <p className="text-[10px] text-muted-foreground">{sidebarSubtitle}</p>
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Switch workspace
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => {
                const active = ws.id === me?.org?.id;
                return (
                  <DropdownMenuItem
                    key={ws.id}
                    onClick={() => handleSwitchWorkspace(ws.id)}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{ws.name}</p>
                      <p className="text-[10px] capitalize text-muted-foreground">
                        {ws.account_type === 'team' ? 'Team workspace' : 'Personal'} · {ws.role}
                      </p>
                    </div>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
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
        )}
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
            <DropdownMenuItem onClick={() => openHelpRef.current?.()}>
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
      <IncomingCallOverlay currentUser={me?.user} />
      <aside className="app-sidebar hidden w-60 shrink-0 flex-col border-r border-border/70 md:flex">
        {sidebarBody}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-sidebar sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 border-b border-border/70 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t('app.openMenu')}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-2rem,18rem)] flex-col p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{sidebarBody}</div>
            </SheetContent>
          </Sheet>
          <Link to="/v2/app" className="min-w-0 flex-1 truncate text-sm font-semibold">
            Lalia
          </Link>
          <LanguageSwitcher compact />
        </header>

        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 md:pb-6 lg:px-8">
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

        {/* Native-style mobile bottom navigation bar for 1-tap switching */}
        <nav
          className="app-sidebar fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-border/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
          aria-label="Mobile navigation"
          data-no-translate="true"
        >
          <NavLink to="/v2/app" end className={mobileTabClass}>
            <Home className="h-4 w-4" />
            <span>{t('app.home')}</span>
          </NavLink>
          <NavLink to="/v2/app/calls" className={mobileTabClass}>
            <Phone className="h-4 w-4" />
            <span>{t('app.calls')}</span>
          </NavLink>
          <NavLink to="/v2/app/meetings" className={mobileTabClass}>
            <Video className="h-4 w-4" />
            <span>{t('app.meetings')}</span>
          </NavLink>
          <NavLink to="/v2/app/settings" className={mobileTabClass}>
            <Settings className="h-4 w-4" />
            <span>{t('app.settings')}</span>
          </NavLink>
        </nav>

        <LaliaSupportLauncher user={me?.user} openRef={openHelpRef} audience="app" />
      </div>
    </div>
  );
}
