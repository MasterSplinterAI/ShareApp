import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { fmtCents } from './formatters';
import { SuspendedBadge } from './shared';

function StatusBadge({ ok, label }) {
  return (
    <Badge variant={ok ? 'default' : 'secondary'} className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
      {label}
    </Badge>
  );
}

function matchesAccountQuery(o, q) {
  if (!q) return true;
  return [o.name, o.owner_email, o.owner_display_name, o.plan_id, o.stripe_customer_id, o.billing_status].some(
    (v) => (v || '').toLowerCase().includes(q)
  );
}

export function BillingTab({ orgs = [], onSelectOrg }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [autoChargeEnabled, setAutoChargeEnabled] = useState(false);
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [auditReason, setAuditReason] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountType, setAccountType] = useState('all');

  const reload = () => {
    setLoading(true);
    return v2Admin
      .billingConfig()
      .then((data) => {
        setConfig(data);
        setStripeEnabled(Boolean(data.settings?.stripeEnabledPreference ?? data.stripeEnabled));
        setAutoChargeEnabled(Boolean(data.settings?.autoChargePreference ?? data.autoChargeEnabled));
        setStripeSecretKey('');
        setStripeWebhookSecret('');
      })
      .catch(() => toast.error('Failed to load billing config'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const aq = accountSearch.trim().toLowerCase();
  const filteredAccounts = useMemo(
    () =>
      orgs.filter((o) => {
        if (accountType === 'personal' && o.account_type !== 'personal') return false;
        if (accountType === 'team' && o.account_type === 'personal') return false;
        return matchesAccountQuery(o, aq);
      }),
    [orgs, accountType, aq]
  );

  const personalCount = orgs.filter((o) => o.account_type === 'personal').length;
  const teamCount = orgs.length - personalCount;

  const saveSettings = async () => {
    if (auditReason.trim().length < 4) {
      toast.error('Audit reason required (4+ characters).');
      return;
    }
    setSaving(true);
    try {
      const body = {
        reason: auditReason.trim(),
        stripeEnabled,
        autoChargeEnabled,
      };
      if (stripeSecretKey.trim()) body.stripeSecretKey = stripeSecretKey.trim();
      if (stripeWebhookSecret.trim()) body.stripeWebhookSecret = stripeWebhookSecret.trim();
      await v2Admin.patchBillingConfig(body);
      toast.success(stripeEnabled ? 'Payments enabled' : 'Billing settings saved');
      setAuditReason('');
      await reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save billing settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <p className="text-sm text-muted-foreground">Loading billing configuration…</p>;
  }

  const settings = config?.settings || {};
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
          <CardTitle className="text-lg">Payment settings</CardTitle>
          <CardDescription>
            Enable Stripe checkout and subscriptions from here. Secrets are stored in the platform database (superadmin
            only). Server <code>.env</code> values still work as fallback when not set below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge ok={config?.stripeEnabled} label={config?.stripeEnabled ? 'Payments enabled' : 'Payments disabled'} />
            <Badge variant="outline">{modeLabel} mode</Badge>
            {settings.source && (
              <Badge variant="secondary">Config source: {settings.source}</Badge>
            )}
          </div>

          <form
            className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveSettings();
            }}
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={stripeEnabled}
                onChange={(e) => setStripeEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium text-foreground">Accept payments (Stripe checkout & portal)</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Requires a valid secret key. Users can upgrade plans and manage billing when enabled.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoChargeEnabled}
                onChange={(e) => setAutoChargeEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <span>
                <span className="font-medium text-foreground">Allow customers to opt in to overage auto-charge</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Platform capability only. Each org owner must separately opt in under Settings → Billing before
                  overages can be charged automatically.
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stripe-secret-key">Stripe secret key</Label>
                <Input
                  id="stripe-secret-key"
                  type="password"
                  autoComplete="off"
                  value={stripeSecretKey}
                  onChange={(e) => setStripeSecretKey(e.target.value)}
                  placeholder={
                    settings.hasStripeSecretKey
                      ? `Saved: ${settings.stripeSecretKeyMasked || '••••'}`
                      : 'sk_test_… or sk_live_…'
                  }
                />
                {settings.usingEnvSecret && (
                  <p className="text-xs text-muted-foreground">Using key from server environment until you save one here.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="stripe-webhook-secret">Webhook signing secret</Label>
                <Input
                  id="stripe-webhook-secret"
                  type="password"
                  autoComplete="off"
                  value={stripeWebhookSecret}
                  onChange={(e) => setStripeWebhookSecret(e.target.value)}
                  placeholder={
                    settings.hasWebhookSecret
                      ? `Saved: ${settings.stripeWebhookSecretMasked || '••••'}`
                      : 'whsec_…'
                  }
                />
                {settings.usingEnvWebhook && (
                  <p className="text-xs text-muted-foreground">Using webhook secret from server environment.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing-audit-reason">Audit reason</Label>
              <Input
                id="billing-audit-reason"
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                placeholder="Why are you changing billing settings? (required)"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : stripeEnabled ? 'Save & enable payments' : 'Save settings'}
              </Button>
              {settings.updatedAt && (
                <span className="self-center text-xs text-muted-foreground">
                  Last updated {new Date(settings.updatedAt).toLocaleString()}
                  {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="app-card border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Status overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                Subscribe to <code>checkout.session.completed</code>, <code>customer.subscription.*</code>,{' '}
                <code>charge.dispute.*</code>, and optionally <code>invoice.*</code> events. Disputes auto-suspend
                mapped orgs until won or an admin reactivates.
              </p>
            </div>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Set <code>BACKEND_BASE_URL</code> on the server to show the webhook URL here.
            </p>
          )}

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
            <CardDescription>Edit price IDs on the Plans tab. Checkout uses these when users upgrade.</CardDescription>
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

      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Customer accounts</CardTitle>
          <CardDescription>
            Personal signups and team workspaces ({personalCount} personal · {teamCount} team). Search by email to find
            individual users — billing still attaches to their personal workspace.
          </CardDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search billing accounts"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="Search by email, name, plan, Stripe customer…"
              className="max-w-md"
            />
            {[
              { id: 'all', label: 'All' },
              { id: 'personal', label: 'Personal' },
              { id: 'team', label: 'Team' },
            ].map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={accountType === opt.id ? 'default' : 'outline'}
                onClick={() => setAccountType(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">Owner email</th>
                <th className="px-3 py-3 font-medium">Account</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Plan</th>
                <th className="px-3 py-3 font-medium">Billing</th>
                <th className="px-3 py-3 font-medium">Stripe customer</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30"
                  onClick={() => onSelectOrg?.(o.id)}
                >
                  <td className="px-3 py-3 font-medium">{o.owner_email || '—'}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {o.name}
                      {o.suspended_at && <SuspendedBadge />}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {o.account_type === 'personal' ? (
                      <Badge variant="secondary">Personal</Badge>
                    ) : (
                      <Badge variant="outline">Team</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {o.plan_id || '—'}
                    {Number(o.cancel_at_period_end) === 1 ? (
                      <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">canceling</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{o.billing_status || '—'}</td>
                  <td className="px-3 py-3">
                    {o.stripe_customer_id ? (
                      <code className="text-xs">{o.stripe_customer_id}</code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredAccounts.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-muted-foreground" colSpan={6}>
                    No accounts match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default BillingTab;
