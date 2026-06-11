import { useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { fmtUsd, fmtMins, BILLING_STATUSES } from './formatters';
import { SuspendedBadge } from './shared';
import { AuditReasonField } from './AuditReasonField';
import { useAuditReason, orgKey } from './useAuditReason';

const COMP_LABELS = ['personal', 'friend', 'promo', 'internal'];
const PLAN_OPTIONS = ['free', 'starter', 'pro'];

export function OrgsTab({ orgs = [], selectedOrg, setSelectedOrg, orgDetail, onReload }) {
  const [planEdit, setPlanEdit] = useState({});
  const [compEdit, setCompEdit] = useState({});
  const [compLabel, setCompLabel] = useState({});
  const [billingEdit, setBillingEdit] = useState({});
  const [limitsEdit, setLimitsEdit] = useState({});
  const [emailForm, setEmailForm] = useState({ subject: '', body: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const { auditReason, auditReasonError, auditInputRef, updateAuditReason, requireAuditReason } =
    useAuditReason(selectedOrg);

  const key = orgKey(selectedOrg);
  const sub = orgDetail?.subscription;
  const org = orgDetail?.org;
  const suspended = Boolean(org?.suspended_at);

  const afterMutation = async () => {
    onReload?.();
  };

  const runWithReason = async (label, fn) => {
    const reason = requireAuditReason(selectedOrg);
    if (!reason) return;
    setBusy(true);
    try {
      await fn(reason);
      toast.success(label);
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const saveComp = () =>
    runWithReason('Comp override saved', (reason) =>
      v2Admin.setComp(selectedOrg, {
        is_comp: Boolean(compEdit[key] ?? sub?.is_comp === 1),
        comp_label: compLabel[key] ?? sub?.comp_label ?? 'personal',
        reason,
      })
    );

  const savePlan = () => {
    const plan_id = planEdit[key] ?? sub?.plan_id;
    if (!plan_id) {
      toast.error('Pick a plan first.');
      return;
    }
    return runWithReason('Plan updated', (reason) => v2Admin.setPlan(selectedOrg, { plan_id, reason }));
  };

  const saveBillingStatus = () => {
    const billing_status = billingEdit[key] ?? org?.billing_status;
    if (!BILLING_STATUSES.includes(billing_status)) {
      toast.error('Pick a valid billing status.');
      return;
    }
    return runWithReason('Billing status updated', (reason) =>
      v2Admin.patchBillingStatus(selectedOrg, { billing_status, reason })
    );
  };

  const saveLimits = (clear = false) => {
    const edit = limitsEdit[key] || {};
    const body = clear
      ? { clearCustom: true }
      : {
          custom_included_meeting_minutes:
            edit.meeting ?? sub?.custom_included_meeting_minutes ?? '',
          custom_included_translation_minutes:
            edit.translation ?? sub?.custom_included_translation_minutes ?? '',
        };
    return runWithReason(clear ? 'Custom limits cleared' : 'Custom limits saved', (reason) =>
      v2Admin.patchOrgLimits(selectedOrg, { ...body, reason })
    );
  };

  const suspendOrReactivate = () =>
    runWithReason(suspended ? 'Org reactivated' : 'Org suspended', (reason) =>
      suspended
        ? v2Admin.reactivateOrg(selectedOrg, { reason })
        : v2Admin.suspendOrg(selectedOrg, { reason })
    );

  const sendEmail = async () => {
    if (!emailForm.subject.trim() || !emailForm.body.trim()) {
      toast.error('Subject and body are required.');
      return;
    }
    if (emailForm.reason.trim().length < 4) {
      toast.error('Email audit reason must be at least 4 characters.');
      return;
    }
    setBusy(true);
    try {
      const r = await v2Admin.emailOrg(selectedOrg, {
        subject: emailForm.subject.trim(),
        body: emailForm.body.trim(),
        reason: emailForm.reason.trim(),
      });
      toast.success(`Sent to ${r.recipients?.length || 0} owner(s)`);
      setEmailForm({ subject: '', body: '', reason: '' });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send email');
    } finally {
      setBusy(false);
    }
  };

  const stripeBase = orgDetail?.stripeDashboardBase || 'https://dashboard.stripe.com';

  return (
    <div className="space-y-4">
      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Organizations</CardTitle>
          <CardDescription>
            {orgs.length} workspaces — click a row for usage analytics and lifecycle / billing controls.
            Participant-min = each person-minute in a meeting (2 people × 30 min = 60).
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Comp</th>
                <th className="px-4 py-3 font-medium">Billing</th>
                <th className="px-4 py-3 font-medium" title="Participant-minutes this calendar month">
                  Part.-min (month)
                </th>
                <th className="px-4 py-3 font-medium" title="Estimated infra cost for meetings ended this month">
                  Infra cost (month)
                </th>
                <th className="px-4 py-3 font-medium">Members</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr
                  key={o.id}
                  className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30 ${
                    selectedOrg === o.id ? 'bg-primary/5' : ''
                  }`}
                  onClick={() => setSelectedOrg(o.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {o.name}
                      {o.suspended_at && <SuspendedBadge />}
                    </span>
                  </td>
                  <td className="px-4 py-3">{o.plan_id || '—'}</td>
                  <td className="px-4 py-3">
                    {o.is_comp === 1 ? <Badge variant="secondary">{o.comp_label || 'comp'}</Badge> : '—'}
                  </td>
                  <td className="px-4 py-3">{o.billing_status || '—'}</td>
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
        <Card key={key} className="app-card border-primary/30">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {org?.name}
              {suspended && <SuspendedBadge />}
            </CardTitle>
            <CardDescription>
              Org ID: {key}
              {org?.suspended_reason ? ` · Suspended: ${org.suspended_reason}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            {orgDetail.usageAnalytics && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4 lg:col-span-2">
                <div>
                  <h3 className="font-medium">Usage analytics</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Billing meter: participant-minutes (people × minutes in meetings).{' '}
                    {orgDetail.usageAnalytics.periodLabel}. Infra cost is a separate estimate from completed rooms.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">This month</div>
                    <div className="font-semibold tabular-nums">
                      {fmtMins(orgDetail.usageAnalytics.monthToDate?.meetingMinutes)}
                    </div>
                    {sub?.included_meeting_minutes != null && sub?.is_comp !== 1 && (
                      <div className="text-xs text-muted-foreground">
                        of {sub.included_meeting_minutes.toLocaleString()} included
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">All time</div>
                    <div className="font-semibold tabular-nums">
                      {fmtMins(orgDetail.usageAnalytics.allTime?.meetingMinutes)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">Translation (month)</div>
                    <div className="font-semibold tabular-nums">
                      {Math.round(orgDetail.usageAnalytics.monthToDate?.translationMinutes || 0).toLocaleString()} min
                    </div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                    <div className="text-xs text-muted-foreground">Infra cost (month)</div>
                    <div className="font-semibold tabular-nums">{fmtUsd(orgDetail.costThisMonthUsd)}</div>
                  </div>
                </div>
                {(orgDetail.usageAnalytics.byDay?.length > 0 || orgDetail.usageAnalytics.byMeeting?.length > 0) && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {orgDetail.usageAnalytics.byDay?.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">By day (this month)</div>
                        <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                          {orgDetail.usageAnalytics.byDay.map((row) => (
                            <li key={row.day} className="flex justify-between gap-2 tabular-nums">
                              <span>{row.day}</span>
                              <span>{Math.round(row.meeting_minutes)} min</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {orgDetail.usageAnalytics.byMeeting?.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">By meeting (this month)</div>
                        <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                          {orgDetail.usageAnalytics.byMeeting.map((row) => (
                            <li key={row.meeting_id || row.title} className="flex justify-between gap-2">
                              <span className="truncate">{row.title || row.meeting_id?.slice(0, 8) || '—'}</span>
                              <span className="tabular-nums shrink-0">{Math.round(row.meeting_minutes)} min</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {orgDetail.members?.length > 0 && (
              <div className="rounded-lg border border-border/60 p-4 lg:col-span-2">
                <h3 className="font-medium mb-2">Members</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-2 font-medium">Email</th>
                        <th className="pb-2 font-medium">Role</th>
                        <th className="pb-2 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgDetail.members.map((m) => (
                        <tr key={m.id} className="border-t border-border/40">
                          <td className="py-2">{m.email}</td>
                          <td className="py-2">{m.role}</td>
                          <td className="py-2 text-muted-foreground text-xs">{m.created_at?.slice(0, 10) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="lg:col-span-2">
              <AuditReasonField
                auditKey={selectedOrg}
                value={auditReason[key] ?? ''}
                onChange={(v) => updateAuditReason(selectedOrg, v)}
                error={auditReasonError}
                inputRef={auditInputRef}
                label="Audit reason"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
              <h3 className="font-medium">Account lifecycle</h3>
              <p className="text-xs text-muted-foreground">
                Suspending blocks new meetings and sets billing status to <code>suspended</code>. Reactivating
                restores it to <code>active</code>.
              </p>
              <Button
                type="button"
                size="sm"
                variant={suspended ? 'default' : 'destructive'}
                disabled={busy}
                onClick={suspendOrReactivate}
              >
                {suspended ? 'Reactivate org' : 'Suspend org'}
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-4">
              <h3 className="font-medium">Comp / unlimited access</h3>
              <p className="text-xs text-muted-foreground">
                Toggle unlimited access for personal, friend, or promo accounts. Bypasses all usage caps.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(compEdit[key] ?? sub?.is_comp === 1)}
                  onChange={(e) => setCompEdit((p) => ({ ...p, [key]: e.target.checked }))}
                />
                Unlimited (comp)
              </label>
              <select
                aria-label="Comp label"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={compLabel[key] ?? sub?.comp_label ?? 'personal'}
                onChange={(e) => setCompLabel((p) => ({ ...p, [key]: e.target.value }))}
              >
                {COMP_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" disabled={busy} onClick={saveComp}>
                Save comp override
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-4">
              <h3 className="font-medium">Plan override</h3>
              <select
                aria-label="Plan override"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={planEdit[key] ?? sub?.plan_id ?? 'free'}
                onChange={(e) => setPlanEdit((p) => ({ ...p, [key]: e.target.value }))}
              >
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" disabled={busy} onClick={savePlan}>
                Set plan
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-4">
              <h3 className="font-medium">Billing status</h3>
              <select
                aria-label="Billing status"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={billingEdit[key] ?? org?.billing_status ?? 'trial'}
                onChange={(e) => setBillingEdit((p) => ({ ...p, [key]: e.target.value }))}
              >
                {BILLING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={saveBillingStatus}>
                Save billing status
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-4">
              <h3 className="font-medium">Custom limits</h3>
              <p className="text-xs text-muted-foreground">
                Override included minutes for this org (leave blank to use plan defaults).
              </p>
              <div className="space-y-2">
                <label className="block text-xs text-muted-foreground">
                  Meeting minutes
                  <Input
                    type="number"
                    min={0}
                    className="mt-1 h-9"
                    placeholder={sub?.included_meeting_minutes != null ? String(sub.included_meeting_minutes) : 'plan default'}
                    value={limitsEdit[key]?.meeting ?? sub?.custom_included_meeting_minutes ?? ''}
                    onChange={(e) =>
                      setLimitsEdit((p) => ({ ...p, [key]: { ...p[key], meeting: e.target.value } }))
                    }
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Translation minutes
                  <Input
                    type="number"
                    min={0}
                    className="mt-1 h-9"
                    placeholder="plan default"
                    value={limitsEdit[key]?.translation ?? sub?.custom_included_translation_minutes ?? ''}
                    onChange={(e) =>
                      setLimitsEdit((p) => ({ ...p, [key]: { ...p[key], translation: e.target.value } }))
                    }
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={() => saveLimits(false)}>
                  Save limits
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => saveLimits(true)}>
                  Clear custom
                </Button>
              </div>
            </div>

            {(sub?.stripe_customer_id || sub?.stripe_subscription_id) && (
              <div className="space-y-2 rounded-lg border border-border/60 p-4">
                <h3 className="font-medium">Stripe</h3>
                <div className="flex flex-wrap gap-2">
                  {sub?.stripe_customer_id && (
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a
                        href={`${stripeBase}/customers/${sub.stripe_customer_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Customer ↗
                      </a>
                    </Button>
                  )}
                  {sub?.stripe_subscription_id && (
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a
                        href={`${stripeBase}/subscriptions/${sub.stripe_subscription_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Subscription ↗
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
              <h3 className="font-medium">Email org owners</h3>
              <p className="text-xs text-muted-foreground">Sends to the owner(s) of this organization.</p>
              <Input
                aria-label="Email subject"
                placeholder="Subject"
                value={emailForm.subject}
                onChange={(e) => setEmailForm((p) => ({ ...p, subject: e.target.value }))}
              />
              <textarea
                aria-label="Email body"
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Message body…"
                value={emailForm.body}
                onChange={(e) => setEmailForm((p) => ({ ...p, body: e.target.value }))}
              />
              <Input
                aria-label="Email audit reason"
                placeholder="Audit reason (4+ chars)"
                value={emailForm.reason}
                onChange={(e) => setEmailForm((p) => ({ ...p, reason: e.target.value }))}
              />
              <Button type="button" size="sm" disabled={busy} onClick={sendEmail}>
                Send email
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default OrgsTab;
