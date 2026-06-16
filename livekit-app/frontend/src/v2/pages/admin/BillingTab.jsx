import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { fmtCents } from './formatters';

function StatusBadge({ ok, label }) {
  return (
    <Badge variant={ok ? 'default' : 'secondary'} className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
      {label}
    </Badge>
  );
}

export function BillingTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    return v2Admin
      .billingConfig()
      .then(setConfig)
      .catch(() => toast.error('Failed to load billing config'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  if (loading && !config) {
    return <p className="text-sm text-muted-foreground">Loading billing configuration…</p>;
  }

  const modeLabel =
    config?.stripeKeyMode === 'live'
      ? 'Live'
      : config?.stripeKeyMode === 'test'
        ? 'Test'
        : config?.stripeKeyMode === 'unknown'
          ? 'Unknown key format'
          : 'Not configured';

  return (
    <div className="space-y-4">
      <Card className="app-card border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Stripe & payments</CardTitle>
          <CardDescription>
            Billing is controlled by server environment variables. This panel shows live status — keys are never stored
            in the database or editable here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge ok={config?.stripeEnabled} label={config?.stripeEnabled ? 'Payments enabled' : 'Payments disabled'} />
            <Badge variant="outline">{modeLabel} mode</Badge>
            {config?.autoChargeEnabled ? (
              <Badge variant="outline">Overage auto-charge on</Badge>
            ) : (
              <Badge variant="secondary">Overage auto-charge off</Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plans with Stripe price</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {config?.plansConfigured ?? 0}/{config?.plansTotal ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Orgs with customer</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{config?.stats?.orgsWithStripeCustomer ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active subscriptions</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {config?.stats?.orgsWithStripeSubscription ?? 0}
              </div>
            </div>
          </div>

          {config?.webhookUrl ? (
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Webhook URL (Stripe Dashboard)</div>
              <code className="mt-1 block break-all text-xs">{config.webhookUrl}</code>
              <p className="mt-2 text-xs text-muted-foreground">
                Subscribe to checkout.session.completed, customer.subscription.*, and invoice.* events. Set{' '}
                <code>STRIPE_WEBHOOK_SECRET</code> from the signing secret Stripe gives you.
              </p>
            </div>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Set <code>BACKEND_BASE_URL</code> on the server to show the webhook URL here.
            </p>
          )}

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Environment checklist</div>
            <ul className="space-y-1 text-sm">
              {(config?.envChecklist || []).map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <span className={item.ok ? 'text-emerald-600' : 'text-muted-foreground'}>{item.ok ? '✓' : '○'}</span>
                  <code>{item.key}</code>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Refresh status
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to="/v2/app/admin/plans">Edit plan Stripe price IDs →</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link to="/v2/app/admin/costs">Revenue & webhook health →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {config?.plans?.length > 0 && (
        <Card className="app-card overflow-hidden border-border/60">
          <CardHeader>
            <CardTitle className="text-lg">Plan → Stripe mapping</CardTitle>
            <CardDescription>
              Edit price IDs on the Plans tab. Checkout uses these IDs when users upgrade.
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Price</th>
                  <th className="px-3 py-3 font-medium">Stripe price ID</th>
                </tr>
              </thead>
              <tbody>
                {config.plans.map((plan) => (
                  <tr key={plan.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-3 font-medium">{plan.name || plan.id}</td>
                    <td className="px-3 py-3 tabular-nums">{fmtCents(plan.monthly_price_cents)}/mo</td>
                    <td className="px-3 py-3">
                      {plan.stripe_price_id ? (
                        <code className="text-xs">{plan.stripe_price_id}</code>
                      ) : (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="app-card border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Enable live payments (server steps)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              On the backend host, set <code>STRIPE_ENABLED=true</code>, <code>STRIPE_SECRET_KEY=sk_live_…</code>, and{' '}
              <code>STRIPE_WEBHOOK_SECRET=whsec_…</code>, then restart the server.
            </li>
            <li>Create recurring Products/Prices in Stripe Dashboard and paste Price IDs into Admin → Plans.</li>
            <li>
              Add the webhook URL above in Stripe. Enable the Customer portal (Settings → Billing → Customer portal) so
              users can cancel and update cards.
            </li>
            <li>
              Optional: set <code>V2_AUTO_CHARGE_ENABLED=true</code> for overage auto-charging after usage settlement.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

export default BillingTab;
