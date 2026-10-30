import { useEffect, useState } from 'react';
import { v2Admin } from '../../../services/apiV2';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { fmtUsd, fmtCents } from './formatters';

/** Stripe webhook ingestion health — rendered inside the Costs tab. */
function BillingHealthPanel() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    v2Admin
      .webhooks(50)
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Billing health (webhooks)</CardTitle>
        <CardDescription>
          {data
            ? `${data.totals.total} events received all-time, ${data.totals.unprocessed} unprocessed. ${data.notes || ''}`
            : 'Loading webhook events…'}
        </CardDescription>
      </CardHeader>
      {data && (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((ev) => (
                <tr key={ev.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">{ev.provider}</td>
                  <td className="px-4 py-3 font-medium">{ev.type}</td>
                  <td className="px-4 py-3">
                    {ev.processed ? (
                      <Badge variant="secondary">processed</Badge>
                    ) : (
                      <Badge variant="destructive">unprocessed</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {(ev.received_at || '').slice(0, 19)}
                  </td>
                </tr>
              ))}
              {data.events.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                    No webhook events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const REVENUE_METRICS = [
  { key: 'estimatedMrrCents', label: 'Estimated MRR', fmt: fmtCents },
  { key: 'arpuCents', label: 'ARPU (paid)', fmt: fmtCents },
  { key: 'paidOrgs', label: 'Paid orgs', fmt: (v) => Number(v || 0).toLocaleString() },
  { key: 'trialOrgs', label: 'Trial orgs', fmt: (v) => Number(v || 0).toLocaleString() },
  { key: 'compOrgs', label: 'Comp orgs', fmt: (v) => Number(v || 0).toLocaleString() },
  { key: 'newSubscriptionsThisMonth', label: 'New subs (month)', fmt: (v) => Number(v || 0).toLocaleString() },
  { key: 'cancellationsThisMonth', label: 'Cancellations (month)', fmt: (v) => Number(v || 0).toLocaleString() },
];

/** Revenue ops: MRR / ARPU / subscription movement vs the month's infra spend. */
function RevenuePanel({ costsTotals }) {
  const [revenue, setRevenue] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    v2Admin.revenue().then(setRevenue).catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const infraCostUsd = Number(costsTotals?.total_cost_usd) || 0;
  const mrrUsd = revenue ? Number(revenue.estimatedMrrCents || 0) / 100 : 0;
  const netUsd = mrrUsd - infraCostUsd;

  return (
    <Card className="app-card border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Revenue ops</CardTitle>
        <CardDescription>
          MRR, ARPU and subscription movement. Net margin compares estimated MRR with this month&apos;s infra spend.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        {REVENUE_METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {revenue ? m.fmt(revenue[m.key]) : '—'}
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net (MRR − infra)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{revenue ? fmtUsd(netUsd) : '—'}</div>
          <div className="text-xs text-muted-foreground">Infra spend {fmtUsd(infraCostUsd)} this month</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CostsTab({ costs, costsLoadedAt, onSelectOrg, setTab }) {
  const handleRowClick = (orgId) => {
    if (!orgId) return;
    setTab?.('orgs');
    onSelectOrg?.(orgId);
  };

  return (
    <div className="space-y-4">
      <RevenuePanel costsTotals={costs?.totals} />
      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Costs &amp; margin (month)</CardTitle>
          <CardDescription>
            Estimated infra cost for meetings that ended this calendar month vs plan revenue. Comp orgs show $0
            revenue. Data refreshes when you open this tab — click Refresh if numbers look stale.
            {costsLoadedAt && (
              <span className="block mt-1 text-xs">Last loaded {costsLoadedAt.toLocaleTimeString()}</span>
            )}
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Org</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Revenue/mo</th>
                <th className="px-4 py-3 font-medium">Infra cost (month)</th>
                <th className="px-4 py-3 font-medium">Margin</th>
                <th className="px-4 py-3 font-medium">Part.-min (month)</th>
              </tr>
            </thead>
            <tbody>
              {(costs?.byOrg || []).map((row) => (
                <tr
                  key={row.org_id || row.org_name || 'unknown'}
                  className="border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/30"
                  onClick={() => handleRowClick(row.org_id)}
                >
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
              {(costs?.byOrg || []).length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                    No cost data for this month yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <BillingHealthPanel />
    </div>
  );
}

export default CostsTab;
