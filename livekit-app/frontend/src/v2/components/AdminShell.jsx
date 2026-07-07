import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  DollarSign,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  Menu,
  ScrollText,
  Shield,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
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
import { useAdmin } from '../context/AdminContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [{ to: '/v2/app/admin/overview', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Customers',
    items: [
      { to: '/v2/app/admin/orgs', label: 'Organizations', icon: Building2 },
      { to: '/v2/app/admin/users', label: 'Users', icon: Users },
      { to: '/v2/app/admin/guests', label: 'Guests', icon: UserPlus },
    ],
  },
  {
    label: 'Product',
    items: [
      { to: '/v2/app/admin/meetings', label: 'Meetings', icon: Video },
      { to: '/v2/app/admin/plans', label: 'Plans', icon: ScrollText },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/v2/app/admin/billing', label: 'Billing & Stripe', icon: DollarSign },
      { to: '/v2/app/admin/costs', label: 'Revenue & costs', icon: BarChart3 },
      { to: '/v2/app/admin/trends', label: 'Trends', icon: TrendingUp },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/v2/app/admin/support', label: 'Support', icon: Ticket },
      { to: '/v2/app/admin/comms', label: 'Comms', icon: Mail },
      { to: '/v2/app/admin/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

function adminNavClass({ isActive }) {
  return cn(
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive
      ? 'bg-primary/10 font-medium text-primary'
      : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
  );
}

function AdminSidebarNav({ onNavigate }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-4" onClick={onNavigate}>
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className={adminNavClass}>
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function AdminShell({ me, onLogout }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { refreshAll } = useAdmin();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const displayName = me?.user?.display_name || me?.user?.displayName || null;
  const initial = (displayName || me?.user?.email || '?').slice(0, 1).toUpperCase();

  const sidebarBody = (
    <>
      <div className="border-b border-border/60 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <Shield className="h-5 w-5 text-primary" />
          Lalia Admin
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Platform operations dashboard</p>
        <Button variant="ghost" size="sm" className="mt-3 h-8 gap-1.5 px-2 text-xs" asChild>
          <Link to="/v2/app">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to workspace
          </Link>
        </Button>
      </div>
      <AdminSidebarNav onNavigate={() => setMobileOpen(false)} />
      <div className="mt-auto border-t border-border/60 p-3 space-y-2">
        <div className="flex justify-center px-1">
          <LanguageSwitcher className="w-full justify-center" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-auto w-full justify-start gap-2 rounded-lg border-border/60 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                {initial}
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">{me?.user?.email || 'Admin'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName || 'Platform admin'}</p>
                <p className="text-xs leading-none text-muted-foreground">{me?.user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/v2/app">
                <LifeBuoy className="mr-2 h-4 w-4" />
                Workspace home
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onLogout?.()}
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
      <aside className="app-sidebar hidden w-64 shrink-0 flex-col border-r border-border/70 md:flex">
        {sidebarBody}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-sidebar sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 px-4 backdrop-blur-md md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Open admin menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-2rem,18rem)] flex-col p-0">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{sidebarBody}</div>
            </SheetContent>
          </Sheet>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">Lalia Admin</span>
          <LanguageSwitcher compact />
          <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={refreshAll}>
            Refresh
          </Button>
        </header>

        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 hidden items-start justify-between gap-3 md:flex">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform admin</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage organizations, billing, support, and communications.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={refreshAll}>
              Refresh data
            </Button>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
