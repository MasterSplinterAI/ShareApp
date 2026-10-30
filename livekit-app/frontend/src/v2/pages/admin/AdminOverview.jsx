import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useAdmin } from '../../context/AdminContext';
import { fmtCents, fmtUsd } from './formatters';
import { MixBar } from './shared';

function fmtMoneyCents(cents, currency = 'usd') {
  const n = Number(cents) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
    }).format(n / 100);
  } catch {
    return `$${(n / 100).toFixed(2)}`;
  }
}

export function AdminOverview() {
  const { kpis, revenue, costs, disputes, setSelectedOrg } = useAdmin();
  const openDisputeCount = revenue?.openDisputes ?? disputes?.length ?? 0;

  return (
    <div className="space-y-4">
      {(openDisputeCount > 0 || (disputes && disputes.length > 0)) && (
        <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-destructive">
              Stripe disputes — {openDisputeCount} open
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Open chargebacks auto-suspend the workspace (meetings blocked) until the dispute is won or an admin
              reactivates the org. Confirm events include <code>charge.dispute.*</code> on your Stripe webhook.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Org</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Evidence due</th>
                  </tr>
                </thead>
                <tbody>
                  {(disputes || []).map((d) => (
                    <tr key={d.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        {d.org_id ? (
                          <button
                            type="button"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                            onClick={() => setSelectedOrg(d.org_id)}
                          >
                            {d.org_name || d.org_id}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">Unmapped customer</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmtMoneyCents(d.amount_cents, d.currency)}</td>
                      <td className="px-3 py-2">{d.status}</td>
                      <td className="px-3 py-2">{d.reason || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {d.evidence_due_by ? new Date(d.evidence_due_by).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ButtonLikeLink />
          </CardContent>
        </Card>
      )}

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
              {revenue?.estimatedMrrCents != null
                ? fmtCents(revenue.estimatedMrrCents)
                : kpis?.estimatedMrrCents != null
                  ? fmtCents(kpis.estimatedMrrCents)
                  : '—'}
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
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open disputes</div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                openDisputeCount > 0 ? 'text-destructive' : ''
              }`}
            >
              {openDisputeCount}
            </div>
            {revenue?.disputeSuspendedOrgs != null && (
              <div className="mt-1 text-xs text-muted-foreground">
                {revenue.disputeSuspendedOrgs} org(s) locked for dispute
              </div>
            )}
          </div>
          {(kpis?.planMix?.length > 0 || kpis?.billingStatusMix?.length > 0) && (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-6">
              <MixBar title="Plan mix" items={kpis?.planMix} labelKey="plan_id" countKey="org_count" />
              <MixBar title="Billing status mix" items={kpis?.billingStatusMix} labelKey="billing_status" countKey="c" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ButtonLikeLink() {
  return (
    <p className="text-xs text-muted-foreground">
      Manage workspaces on the{' '}
      <Link className="text-primary underline-offset-2 hover:underline" to="/v2/app/admin/orgs">
        Orgs
      </Link>{' '}
      tab (reactivate after review).
    </p>
  );
}

export default AdminOverview;
