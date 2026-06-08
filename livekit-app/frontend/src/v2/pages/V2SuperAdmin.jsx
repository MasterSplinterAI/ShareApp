import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin, v2Orgs } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';

const COMP_LABELS = ['personal', 'friend', 'promo', 'internal'];

function fmtUsd(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}

function fmtCents(c) {
  return fmtUsd(Number(c) / 100);
}

export default function V2SuperAdmin() {
  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('orgs');
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [costs, setCosts] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);
  const [billingEdit, setBillingEdit] = useState({});
  const [reasonByOrg, setReasonByOrg] = useState({});
  const [planEdit, setPlanEdit] = useState({});
  const [planReason, setPlanReason] = useState({});
  const [compEdit, setCompEdit] = useState({});
  const [compLabel, setCompLabel] = useState({});
  const [compReason, setCompReason] = useState({});

  const reloadOrgs = () =>
    v2Admin.orgs().then((r) => setOrgs(r.orgs || [])).catch(() => toast.error('Failed to load orgs'));

  useEffect(() => {
    v2Orgs.adminPing().then(() => setAllowed(true)).catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    v2Orgs.adminKpis().then(setKpis).catch(() => {});
    reloadOrgs();
    v2Admin.users().then((r) => setUsers(r.users || [])).catch(() => {});
    v2Admin.costsSummary().then(setCosts).catch(() => {});
  }, [allowed]);

  useEffect(() => {
    if (!selectedOrg) {
      setOrgDetail(null);
      return;
    }
    v2Admin
      .orgDetail(selectedOrg)
      .then(setOrgDetail)
      .catch(() => toast.error('Failed to load org detail'));
  }, [selectedOrg]);

  const saveBilling = async (orgId) => {
    const status = billingEdit[orgId];
    if (!status) return;
    const reason = (reasonByOrg[orgId] || '').trim();
    if (reason.length < 4) {
      toast.error('Enter an audit reason (at least 4 characters).');
      return;
    }
    try {
      await v2Orgs.adminPatchOrg(orgId, { billing_status: status, reason });
      toast.success('Billing status updated');
      reloadOrgs();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    }
  };

  const savePlan = async (orgId) => {
    const plan_id = planEdit[orgId];
    const reason = (planReason[orgId] || '').trim();
    if (!plan_id || reason.length < 4) {
      toast.error('Plan and reason required');
      return;
    }
    try {
      await v2Admin.setPlan(orgId, { plan_id, reason });
      toast.success('Plan updated');
      reloadOrgs();
      if (selectedOrg === orgId) v2Admin.orgDetail(orgId).then(setOrgDetail);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const saveComp = async (orgId) => {
    const reason = (compReason[orgId] || '').trim();
    if (reason.length < 4) {
      toast.error('Reason required');
      return;
    }
    try {
      await v2Admin.setComp(orgId, {
        is_comp: Boolean(compEdit[orgId]),
        comp_label: compLabel[orgId] || null,
        reason,
      });
      toast.success('Comp override saved');
      reloadOrgs();
      if (selectedOrg === orgId) v2Admin.orgDetail(orgId).then(setOrgDetail);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  if (allowed === null) {
    return <p className="text-sm text-muted-foreground">Checking access…</p>;
  }
  if (!allowed) {
    return (
      <Card className="max-w-xl border-border/80">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
          <CardDescription>
            Platform admin requires your email in server env <code>V2_SUPERADMIN_EMAILS</code>.
          </CardDescription>
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
      <Button variant="link" className="h-auto p-0 text-primary" asChild>
        <Link to="/v2/app">← Workspace</Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parley admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Users, orgs, costs, and comp overrides.</p>
      </div>

      <Card className="app-card border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Instance KPIs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organizations</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kpis?.orgCount ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Est. MRR</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {kpis?.estimatedMrrCents != null ? fmtCents(kpis.estimatedMrrCents) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">MTD infra cost</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtUsd(costs?.totals?.total_cost_usd)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Users</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{users.length}</div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="costs">Costs & margin</TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-4 space-y-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Organizations</CardTitle>
              <CardDescription>{orgs.length} workspaces — click a row to manage comp/plan.</CardDescription>
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Comp</th>
                    <th className="px-4 py-3 font-medium">MTD min</th>
                    <th className="px-4 py-3 font-medium">MTD cost</th>
                    <th className="px-4 py-3 font-medium">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr
                      key={o.id}
                      className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30 ${selectedOrg === o.id ? 'bg-primary/5' : ''}`}
                      onClick={() => setSelectedOrg(o.id)}
                    >
                      <td className="px-4 py-3 font-medium">{o.name}</td>
                      <td className="px-4 py-3">{o.plan_id || '—'}</td>
                      <td className="px-4 py-3">
                        {o.is_comp === 1 ? (
                          <Badge variant="secondary">{o.comp_label || 'comp'}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{Math.round(o.mtd_meeting_minutes || 0)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtUsd(o.mtd_cost_usd)}</td>
                      <td className="px-4 py-3">{o.member_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {selectedOrg && orgDetail && (
            <Card className="app-card border-primary/30">
              <CardHeader>
                <CardTitle>{orgDetail.org?.name}</CardTitle>
                <CardDescription>Org ID: {selectedOrg}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <h3 className="font-medium">Comp / unlimited access</h3>
                  <p className="text-xs text-muted-foreground">
                    Toggle unlimited access for personal, friend, or promo accounts. Bypasses all usage caps.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(compEdit[selectedOrg] ?? orgDetail.subscription?.is_comp === 1)}
                      onChange={(e) => setCompEdit((p) => ({ ...p, [selectedOrg]: e.target.checked }))}
                    />
                    Unlimited (comp)
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={compLabel[selectedOrg] ?? orgDetail.subscription?.comp_label ?? 'personal'}
                    onChange={(e) => setCompLabel((p) => ({ ...p, [selectedOrg]: e.target.value }))}
                  >
                    {COMP_LABELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Input
                    placeholder="Audit reason"
                    value={compReason[selectedOrg] ?? ''}
                    onChange={(e) => setCompReason((p) => ({ ...p, [selectedOrg]: e.target.value }))}
                  />
                  <Button type="button" size="sm" onClick={() => saveComp(selectedOrg)}>
                    Save comp override
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <h3 className="font-medium">Plan override</h3>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={planEdit[selectedOrg] ?? orgDetail.subscription?.plan_id ?? 'free'}
                    onChange={(e) => setPlanEdit((p) => ({ ...p, [selectedOrg]: e.target.value }))}
                  >
                    <option value="free">free</option>
                    <option value="starter">starter</option>
                    <option value="pro">pro</option>
                  </select>
                  <Input
                    placeholder="Audit reason"
                    value={planReason[selectedOrg] ?? ''}
                    onChange={(e) => setPlanReason((p) => ({ ...p, [selectedOrg]: e.target.value }))}
                  />
                  <Button type="button" size="sm" onClick={() => savePlan(selectedOrg)}>
                    Set plan
                  </Button>
                  <div className="text-xs text-muted-foreground pt-2">
                    MTD usage: {Math.round(orgDetail.usageThisMonth?.meetingMinutes || 0)} participant-min · Cost{' '}
                    {fmtUsd(orgDetail.costThisMonthUsd)}
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
                  <h3 className="font-medium">Billing status</h3>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="max-w-[160px]"
                      defaultValue={orgDetail.org?.billing_status}
                      onChange={(e) => setBillingEdit((p) => ({ ...p, [selectedOrg]: e.target.value }))}
                    />
                    <Input
                      placeholder="Audit reason"
                      className="max-w-xs"
                      value={reasonByOrg[selectedOrg] ?? ''}
                      onChange={(e) => setReasonByOrg((p) => ({ ...p, [selectedOrg]: e.target.value }))}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => saveBilling(selectedOrg)}>
                      Save billing status
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Users</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Org</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Comp</th>
                    <th className="px-4 py-3 font-medium">MTD min</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={`${u.id}-${u.org_id || 'none'}`} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.org_name || '—'}</td>
                      <td className="px-4 py-3">{u.role || '—'}</td>
                      <td className="px-4 py-3">{u.plan_id || '—'}</td>
                      <td className="px-4 py-3">{u.is_comp === 1 ? u.comp_label || 'yes' : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{Math.round(u.mtd_meeting_minutes || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Costs & margin (MTD)</CardTitle>
              <CardDescription>Hard USD infra cost vs plan revenue per org.</CardDescription>
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Org</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Revenue/mo</th>
                    <th className="px-4 py-3 font-medium">Cost MTD</th>
                    <th className="px-4 py-3 font-medium">Margin</th>
                    <th className="px-4 py-3 font-medium">Minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {(costs?.byOrg || []).map((row) => (
                    <tr key={row.org_id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium">{row.org_name}</td>
                      <td className="px-4 py-3">
                        {row.plan_id}
                        {row.is_comp === 1 ? ' (comp)' : ''}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{fmtCents(row.revenue_cents)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtUsd(row.cost_usd)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtCents(row.margin_cents)}</td>
                      <td className="px-4 py-3 tabular-nums">{Math.round(row.mtd_minutes || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
