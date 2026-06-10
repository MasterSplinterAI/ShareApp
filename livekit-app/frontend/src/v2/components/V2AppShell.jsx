import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, LayoutDashboard, LogOut, Menu, Settings, Shield, Video } from 'lucide-react';
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
  return (
    <nav className="flex flex-1 flex-col gap-1 px-2 py-4" onClick={onNavigate}>
      <NavLink to="/v2/app" end className={navLinkClass}>
        <Home className="h-4 w-4 shrink-0" />
        Home
      </NavLink>
      <NavLink to="/v2/app/meetings" className={navLinkClass}>
        <Video className="h-4 w-4 shrink-0" />
        Meetings
      </NavLink>
      <NavLink to="/v2/app/settings" className={navLinkClass}>
        <Settings className="h-4 w-4 shrink-0" />
        Settings
      </NavLink>
      {isSuperadmin && (
        <NavLink to="/v2/app/superadmin" className={navLinkClass}>
          <Shield className="h-4 w-4 shrink-0 opacity-70" />
          Admin
        </NavLink>
      )}
    </nav>
  );
}

export default function V2AppShell({ me, onLogout }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const displayName = me?.user?.display_name || me?.user?.displayName || null;
  const initial = (displayName || me?.user?.email || '?').slice(0, 1).toUpperCase();
  const orgName = me?.org?.name || 'Workspace';
  const planStatus = me?.org?.billing_status || null;

  const sidebarBody = (
    <>
      <div className="border-b border-border/60 px-4 py-4">
        <Link to="/v2/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          Parley
        </Link>
        <div className="mt-2.5 flex items-center gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-foreground" title={orgName}>
            {orgName}
          </p>
          {planStatus && (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-medium capitalize">
              {planStatus}
            </Badge>
          )}
        </div>
      </div>
      <SidebarNav onNavigate={() => setMobileOpen(false)} isSuperadmin={Boolean(me?.isSuperadmin)} />
      <div className="mt-auto border-t border-border/60 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-auto w-full justify-start gap-2 rounded-lg border-border/60 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initial}
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">{me?.user?.email || 'Account'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName || 'Member'}</p>
                <p className="text-xs leading-none text-muted-foreground">{me?.user?.email}</p>
                {me?.role && (
                  <p className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Role: {me.role}</p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                onLogout();
              }}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
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
              <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-2rem,18rem)] flex-col p-0">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{sidebarBody}</div>
            </SheetContent>
          </Sheet>
          <Link to="/v2/app" className="truncate text-sm font-semibold">
            Parley
          </Link>
        </header>

        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
