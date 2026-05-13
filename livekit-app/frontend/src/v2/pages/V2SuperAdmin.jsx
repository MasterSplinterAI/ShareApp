import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Orgs } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

export default function V2SuperAdmin() {
  const [allowed, setAllowed] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [billingEdit, setBillingEdit] = useState({});
  const [reasonByOrg, setReasonByOrg] = useState({});

  useEffect(() => {
    v2Orgs
      .adminPing()
      .then(() => setAllowed(true))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    v2Orgs
      .adminKpis()
      .then((r) => setKpis(r))
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load KPIs'));
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    v2Orgs
      .adminOrgs()
      .then((r) => setOrgs(r.orgs || []))
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load orgs'));
  }, [allowed]);

  const saveOrg = async (orgId) => {
    const status = billingEdit[orgId];
    if (!status) return;
    const reason = (reasonByOrg[orgId] || '').trim();
    if (reason.length < 4) {
      toast.error('Enter an audit reason (at least 4 characters).');
      return;
    }
    try {
      await v2Orgs.adminPatchOrg(orgId, { billing_status: status, reason });
      toast.success('Updated');
      setReasonByOrg((prev) => ({ ...prev, [orgId]: '' }));
      const r = await v2Orgs.adminOrgs();
      setOrgs(r.orgs || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
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
          <CardDescription className="space-y-2 text-pretty">
            <p>
              Platform admin APIs are gated by the server env{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">V2_SUPERADMIN_EMAILS</code> (comma-separated, case-insensitive).
            </p>
            <p>
              On <strong>production</strong>, add your login email to that variable in the backend <code className="rounded bg-muted px-1 py-0.5">.env</code>, restart the Node process (e.g. PM2), then reload this page. Being an org owner/admin is not enough—only listed emails can use this screen.
            </p>
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
        <h1 className="text-2xl font-semibold tracking-tight">Platform admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cross-tenant overview (SQLite MVP).</p>
      </div>
      <div className="space-y-4">
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Instance KPIs</CardTitle>
            <CardDescription>Read-only aggregates from the local SQLite store.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organizations</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{kpis?.orgCount ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Est. MRR (active + trialing)</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {kpis?.estimatedMrrCents != null
                  ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
                      Number(kpis.estimatedMrrCents) / 100
                    )
                  : '—'}
              </div>
            </div>
            {kpis?.planMix?.map((row) => (
              <div key={row.plan_id} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan: {row.plan_id}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{row.org_count}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="app-card overflow-hidden border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Organizations</CardTitle>
          <CardDescription>
            {orgs.length} workspace{orgs.length === 1 ? '' : 's'} on this instance.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Billing</th>
                <th className="px-4 py-3 font-medium">Members</th>
                <th className="px-4 py-3 font-medium">Meetings</th>
                <th className="px-4 py-3 font-medium min-w-[200px]">Audit reason</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No organizations yet.
                  </td>
                </tr>
              ) : (
                orgs.map((o) => (
                  <tr key={o.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{o.name}</td>
                    <td className="px-4 py-3">
                      <Input
                        type="text"
                        defaultValue={o.billing_status}
                        onChange={(e) => setBillingEdit((prev) => ({ ...prev, [o.id]: e.target.value }))}
                        className="h-9 max-w-[160px]"
                      />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{o.member_count}</td>
                    <td className="px-4 py-3 text-muted-foreground">{o.meeting_count}</td>
                    <td className="px-4 py-3 align-top">
                      <textarea
                        rows={2}
                        placeholder="Why this change?"
                        value={reasonByOrg[o.id] ?? ''}
                        onChange={(e) => setReasonByOrg((prev) => ({ ...prev, [o.id]: e.target.value }))}
                        className="w-full min-w-[180px] max-w-xs rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => saveOrg(o.id)}>
                        Save billing
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
