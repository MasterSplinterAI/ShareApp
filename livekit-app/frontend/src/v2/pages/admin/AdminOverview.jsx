import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useAdmin } from '../../context/AdminContext';
import { fmtCents, fmtUsd } from './formatters';
import { MixBar } from './shared';

export function AdminOverview() {
  const { kpis, revenue, costs } = useAdmin();

  return (
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
  );
}
