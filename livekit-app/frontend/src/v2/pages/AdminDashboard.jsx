import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
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
import { CommsTab } from './admin/CommsTab';
import { SupportTab } from './admin/SupportTab';

function AdminShellLayout() {
  const { me, onLogout } = useOutletContext();
  return (
    <AdminProvider>
      <AdminShell me={me} onLogout={onLogout} />
    </AdminProvider>
  );
}

function AdminOrgsPage() {
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

function AdminUsersPage() {
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

function AdminMeetingsPage() {
  const { orgs } = useAdmin();
  return <MeetingsTab orgs={orgs} />;
}

function AdminCostsPage() {
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

function AdminCommsPage() {
  const { selectedOrg } = useAdmin();
  return <CommsTab selectedOrgId={selectedOrg} />;
}

function AdminSupportPage() {
  const [searchParams] = useSearchParams();
  const initialTicket = searchParams.get('ticket');
  return <SupportTab initialTicketNumber={initialTicket} />;
}

function AdminRouteTree() {
  return (
    <Routes>
      <Route element={<AdminShellLayout />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<AdminOverview />} />
        <Route path="orgs" element={<AdminOrgsPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="plans" element={<PlansTab />} />
        <Route path="meetings" element={<AdminMeetingsPage />} />
        <Route path="trends" element={<TrendsTab />} />
        <Route path="costs" element={<AdminCostsPage />} />
        <Route path="comms" element={<AdminCommsPage />} />
        <Route path="support" element={<AdminSupportPage />} />
        <Route path="guests" element={<GuestsTab />} />
        <Route path="audit" element={<AuditTab />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
    </Routes>
  );
}

export default function AdminDashboard() {
  const { me, onLogout } = useOutletContext();
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

  return <AdminRouteTree />;
}

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
    comms: 'comms',
    support: 'support',
    guests: 'guests',
    audit: 'audit',
  };
  const segment = tabPaths[tab] || 'overview';
  const qs = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
  return <Navigate to={`/v2/app/admin/${segment}${qs}`} replace />;
}
