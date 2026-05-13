import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, LogOut, Menu, Shield, Users } from 'lucide-react';
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
import { v2Orgs } from '../../services/apiV2';
import { cn } from '../../lib/utils';

function navLinkClass({ isActive }) {
  return cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
  );
}

function SidebarNav({ onNavigate }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-2 py-4" onClick={onNavigate}>
      <NavLink to="/v2/app" end className={navLinkClass}>
        <LayoutDashboard className="h-4 w-4 shrink-0" />
        Home
      </NavLink>
      <NavLink to="/v2/app/meetings" className={navLinkClass}>
        <Users className="h-4 w-4 shrink-0" />
        Meetings
      </NavLink>
      <NavLink to="/v2/app/settings" className={navLinkClass}>
        <Shield className="h-4 w-4 shrink-0" />
        Settings
      </NavLink>
      <NavLink to="/v2/app/superadmin" className={({ isActive }) => cn(navLinkClass({ isActive }), 'text-xs')}>
        <Shield className="h-4 w-4 shrink-0 opacity-70" />
        Admin
      </NavLink>
    </nav>
  );
}

export default function V2AppShell({ me, onLogout }) {
  const location = useLocation();
  const [org, setOrg] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    v2Orgs
      .me()
      .then(setOrg)
      .catch(() => setOrg(null));
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const initial = (me?.user?.email || me?.user?.displayName || '?').slice(0, 1).toUpperCase();
  const orgName = org?.organization?.name || org?.name || 'Workspace';

  const sidebarBody = (
    <>
      <div className="border-b border-border/60 px-4 py-4">
        <Link to="/v2/app" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          Conference V2
        </Link>
        <p className="mt-2 truncate text-xs text-muted-foreground" title={orgName}>
          {orgName}
        </p>
      </div>
      <SidebarNav onNavigate={() => setMobileOpen(false)} />
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
                <p className="text-sm font-medium leading-none">{me?.user?.displayName || 'Member'}</p>
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
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-card/90 shadow-sm backdrop-blur-sm md:flex">
        {sidebarBody}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-card/80 px-4 backdrop-blur-md md:hidden">
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
            Conference V2
          </Link>
        </header>

        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
