import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin, v2Orgs } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { fmtCents, fmtUsd } from './admin/formatters';
import { MixBar } from './admin/shared';
import { OrgsTab } from './admin/OrgsTab';
import { UsersTab } from './admin/UsersTab';
import { MeetingsTab } from './admin/MeetingsTab';
import { TrendsTab } from './admin/TrendsTab';
import { CostsTab } from './admin/CostsTab';
import { GuestsTab } from './admin/GuestsTab';
import { AuditTab } from './admin/AuditTab';
import { PlansTab } from './admin/PlansTab';
import { CommsTab } from './admin/CommsTab';

export default function V2SuperAdmin() {
  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('orgs');
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [costs, setCosts] = useState(null);
  const [costsLoadedAt, setCostsLoadedAt] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);

  const reloadOrgs = () =>
    v2Admin.orgs().then((r) => setOrgs(r.orgs || [])).catch(() => toast.error('Failed to load orgs'));

  const reloadUsers = () =>
    v2Admin.users().then((r) => setUsers(r.users || [])).catch(() => toast.error('Failed to load users'));

  const reloadCosts = () =>
    v2Admin
      .costsSummary()
      .then((data) => {
        setCosts(data);
        setCostsLoadedAt(new Date());
      })
      .catch(() => toast.error('Failed to load costs'));

  const reloadKpis = () =>
    Promise.all([v2Orgs.adminKpis().then(setKpis), v2Admin.revenue().then(setRevenue).catch(() => {})]).catch(() => {});

  const refreshAdminData = () => {
    reloadKpis();
    reloadOrgs();
    reloadCosts();
    if (selectedOrg) {
      v2Admin.orgDetail(selectedOrg).then(setOrgDetail).catch(() => {});
    }
  };

  useEffect(() => {
    v2Orgs.adminPing().then(() => setAllowed(true)).catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    reloadKpis();
    reloadOrgs();
    reloadCosts();
  }, [allowed]);

  useEffect(() => {
    if (tab === 'costs' && allowed) reloadCosts();
    if (tab === 'users' && allowed) reloadUsers();
  }, [tab, allowed]);

  useEffect(() => {
    if (!selectedOrg) {
      setOrgDetail(null);
      return;
    }
    setOrgDetail(null);
    v2Admin
      .orgDetail(selectedOrg)
      .then(setOrgDetail)
      .catch(() => toast.error('Failed to load org detail'));
  }, [selectedOrg]);

  if (allowed === null) {
    return <p className="text-sm text-muted-foreground">Checking access…</p>;
  }
  if (!allowed) {
    return (
      <Card className="max-w-xl border-border/80">
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
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/v2/app" className="text-sm font-medium text-primary hover:underline">
        ← Workspace
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Parley admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage organizations, billing, support, and platform communications.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refreshAdminData}>
          Refresh data
        </Button>
      </div>

      <Card className="app-card border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Business overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organizations</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kpis?.orgCount ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paid orgs</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{revenue?.paidOrgs ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Est. MRR</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {revenue?.estimatedMrrCents != null ? fmtCents(revenue.estimatedMrrCents) : kpis?.estimatedMrrCents != null ? fmtCents(kpis.estimatedMrrCents) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ARPU</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {revenue?.arpuCents != null ? fmtCents(revenue.arpuCents) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">MTD infra cost</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtUsd(costs?.totals?.total_cost_usd)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Accounts</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kpis?.userCount ?? '—'}</div>
          </div>
          {(kpis?.planMix?.length > 0 || kpis?.billingStatusMix?.length > 0) && (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-6">
              <MixBar title="Plan mix" items={kpis?.planMix} labelKey="plan_id" countKey="org_count" />
              <MixBar title="Billing status mix" items={kpis?.billingStatusMix} labelKey="billing_status" countKey="c" />
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="costs">Revenue & costs</TabsTrigger>
          <TabsTrigger value="comms">Comms</TabsTrigger>
          <TabsTrigger value="guests">Guests</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-4">
          <OrgsTab
            orgs={orgs}
            selectedOrg={selectedOrg}
            setSelectedOrg={setSelectedOrg}
            orgDetail={orgDetail}
            onReload={() => {
              reloadOrgs();
              reloadKpis();
              reloadCosts();
              if (selectedOrg) v2Admin.orgDetail(selectedOrg).then(setOrgDetail);
            }}
          />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UsersTab
            users={users}
            onReload={reloadUsers}
            onSelectOrg={(orgId) => {
              setTab('orgs');
              setSelectedOrg(orgId);
            }}
          />
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <PlansTab />
        </TabsContent>

        <TabsContent value="meetings" className="mt-4">
          <MeetingsTab orgs={orgs} />
        </TabsContent>

        <TabsContent value="trends" className="mt-4">
          <TrendsTab />
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <CostsTab
            costs={costs}
            costsLoadedAt={costsLoadedAt}
            onSelectOrg={(orgId) => {
              setTab('orgs');
              setSelectedOrg(orgId);
            }}
            setTab={setTab}
          />
        </TabsContent>

        <TabsContent value="comms" className="mt-4">
          <CommsTab selectedOrgId={selectedOrg} />
        </TabsContent>

        <TabsContent value="guests" className="mt-4">
          <GuestsTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
