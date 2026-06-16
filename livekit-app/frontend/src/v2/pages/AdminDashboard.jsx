import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { v2Orgs } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminProvider, useAdmin } from '../context/AdminContext';
import AdminShell from '../components/AdminShell';
import { AdminOverview } from './admin/AdminOverview';
import { OrgsTab } from './admin/OrgsTab';
import { UsersTab } from './admin/UsersTab';
import { MeetingsTab } from './admin/MeetingsTab';
import { TrendsTab } from './admin/TrendsTab';
import { CostsTab } from './admin/CostsTab';
import { GuestsTab } from './admin/GuestsTab';
import { AuditTab } from './admin/AuditTab';
import { PlansTab } from './admin/PlansTab';
import { BillingTab } from './admin/BillingTab';
import { CommsTab } from './admin/CommsTab';
import { SupportTab } from './admin/SupportTab';

/** Auth gate — renders child admin routes when platform admin access is allowed. */
export function AdminGate() {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    v2Orgs.adminPing().then(() => setAllowed(true)).catch(() => setAllowed(false));
  }, []);

  if (allowed === null) {
    return <p className="px-4 py-8 text-sm text-muted-foreground">Checking access…</p>;
  }
  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle>Restricted</CardTitle>
            <p className="text-sm text-muted-foreground">
              Platform admin requires your email in server env <code>V2_SUPERADMIN_EMAILS</code>.
            </p>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link to="/v2/app">← Workspace</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}

export function AdminShellLayout() {
  const ctx = useOutletContext() || {};
  return (
    <AdminProvider>
      <AdminShell me={ctx.me} onLogout={ctx.onLogout} />
    </AdminProvider>
  );
}

export function AdminOrgsPage() {
  const { orgs, selectedOrg, setSelectedOrg, orgDetail, reloadOrgsTab } = useAdmin();
  return (
    <OrgsTab
      orgs={orgs}
      selectedOrg={selectedOrg}
      setSelectedOrg={setSelectedOrg}
      orgDetail={orgDetail}
      onReload={reloadOrgsTab}
    />
  );
}

export function AdminUsersPage() {
  const navigate = useNavigate();
  const { users, reloadUsers, setSelectedOrg } = useAdmin();
  useEffect(() => {
    reloadUsers();
  }, [reloadUsers]);
  return (
    <UsersTab
      users={users}
      onReload={reloadUsers}
      onSelectOrg={(orgId) => {
        setSelectedOrg(orgId);
        navigate('/v2/app/admin/orgs');
      }}
    />
  );
}

export function AdminMeetingsPage() {
  const { orgs } = useAdmin();
  return <MeetingsTab orgs={orgs} />;
}

export function AdminCostsPage() {
  const navigate = useNavigate();
  const { costs, costsLoadedAt, setSelectedOrg, reloadCosts } = useAdmin();
  useEffect(() => {
    reloadCosts();
  }, [reloadCosts]);
  return (
    <CostsTab
      costs={costs}
      costsLoadedAt={costsLoadedAt}
      onSelectOrg={(orgId) => {
        setSelectedOrg(orgId);
        navigate('/v2/app/admin/orgs');
      }}
      setTab={() => navigate('/v2/app/admin/orgs')}
    />
  );
}

export function AdminCommsPage() {
  const { selectedOrg } = useAdmin();
  return <CommsTab selectedOrgId={selectedOrg} />;
}

export function AdminBillingPage() {
  return <BillingTab />;
}

export function AdminSupportPage() {
  const [searchParams] = useSearchParams();
  const initialTicket = searchParams.get('ticket');
  return <SupportTab initialTicketNumber={initialTicket} />;
}

export { AdminOverview };

/** Redirect legacy /superadmin URLs (with optional tab & ticket query params). */
export function SuperAdminRedirect() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';
  const ticket = searchParams.get('ticket');
  const tabPaths = {
    orgs: 'orgs',
    users: 'users',
    plans: 'plans',
    meetings: 'meetings',
    trends: 'trends',
    costs: 'costs',
    billing: 'billing',
    comms: 'comms',
    support: 'support',
    guests: 'guests',
    audit: 'audit',
  };
  const segment = tabPaths[tab] || 'overview';
  const qs = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
  return <Navigate to={`/v2/app/admin/${segment}${qs}`} replace />;
}
