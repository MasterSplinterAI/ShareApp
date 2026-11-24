import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { useAdmin } from '../../context/AdminContext';
import { fmtCents, fmtDateTime, fmtUsd } from './formatters';
import { DayBarChart, MixBar } from './shared';

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

function fmtBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '0 MB';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function flagMeta(flag) {
  switch (flag) {
    case 'hard_stopped':
      return { label: 'Hard cap blocked', cls: 'bg-destructive text-destructive-foreground' };
    case 'near_hard_cap':
      return { label: '90%+ of hard cap', cls: 'bg-rose-600 text-white' };
    case 'soft_overage':
      return { label: 'In overage (100%+)', cls: 'bg-amber-600 text-white' };
    case 'negative_margin':
      return { label: 'Cost > plan price', cls: 'bg-orange-600 text-white' };
    case 'running_low':
      return { label: 'High usage (80%+)', cls: 'bg-amber-500/20 text-amber-800 dark:text-amber-300' };
    case 'high_comp_cost':
      return { label: 'High comp spend', cls: 'bg-sky-500/20 text-sky-800 dark:text-sky-300' };
    default:
      return { label: flag || 'Watch', cls: 'bg-muted text-foreground' };
  }
}

const QUICK_NAV = [
  { to: '/v2/app/admin/orgs', label: 'Accounts & Credits' },
  { to: '/v2/app/admin/users', label: 'Users' },
  { to: '/v2/app/admin/meetings', label: 'Meetings' },
  { to: '/v2/app/admin/costs', label: 'Infra Costs' },
  { to: '/v2/app/admin/plans', label: 'Plans' },
  { to: '/v2/app/admin/billing', label: 'Stripe & Billing' },
  { to: '/v2/app/admin/comms', label: 'Alerts & Comms' },
  { to: '/v2/app/admin/marketing', label: 'Marketing CMS' },
  { to: '/v2/app/admin/support', label: 'Support Desk' },
];

export function AdminOverview() {
  const navigate = useNavigate();
  const {
    dashboard,
    kpis,
    revenue,
    costs,
    disputes,
    agentAlerts,
    reloadAgentAlerts,
    reloadDashboard,
    refreshAll,
    setSelectedOrg,
  } = useAdmin();
  const [busyAlertAction, setBusyAlertAction] = useState(false);
  const [busyUsageAck, setBusyUsageAck] = useState(false);

  const openOrgInCrm = (orgId) => {
    if (!orgId) return;
    setSelectedOrg(orgId);
    navigate('/v2/app/admin/orgs');
  };

  const openDisputeCount = revenue?.openDisputes ?? disputes?.length ?? 0;
  const unackedFailovers = agentAlerts?.unacknowledged || [];
  const circuitOpen = Boolean(agentAlerts?.runtime?.circuitOpen);
  const showAgentBanner =
    (agentAlerts?.settings?.bannerEnabled ?? true) && (circuitOpen || unackedFailovers.length > 0);

  const openUsageAlerts = dashboard?.openUsageAlerts || [];
  const growth = dashboard?.growth || {};
  const usage = dashboard?.usage || {};
  const notetakerOps = dashboard?.notetakerOps || {};
  const sparklines = dashboard?.sparklines || {};
  const watchlist = dashboard?.watchlist || [];
  const recentSignups = dashboard?.recentSignups || [];
  const sparkDays = dashboard?.sparklineDays || 14;

  const mrrCents =
    revenue?.estimatedMrrCents != null
      ? Number(revenue.estimatedMrrCents)
      : kpis?.estimatedMrrCents != null
        ? Number(kpis.estimatedMrrCents)
        : 0;
  const mtdInfraUsd = Number(costs?.totals?.total_cost_usd || 0);
  const netMarginUsd = mrrCents / 100 - mtdInfraUsd;

  const mtdTotalPlatformMinutes =
    Number(usage.mtdMeetingMinutes || 0) +
    Number(usage.mtdTranslationMinutes || 0) +
    Number(usage.mtdNotetakerMinutes || 0);
  const allTimeTotalPlatformMinutes =
    Number(usage.allTimeMeetingMinutes || 0) +
    Number(usage.allTimeTranslationMinutes || 0) +
    Number(usage.allTimeNotetakerMinutes || 0);

  const handleAckAlerts = async () => {
    setBusyAlertAction(true);
    try {
      await v2Admin.acknowledgeAgentAlerts();
      toast.success('Agent failover alerts acknowledged');
      await reloadAgentAlerts();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to acknowledge alerts');
    } finally {
      setBusyAlertAction(false);
    }
  };

  const handleResetCircuit = async () => {
    setBusyAlertAction(true);
    try {
      await v2Admin.resetAgentCircuit({ reason: 'admin_overview_reset' });
      toast.success('Failover circuit reset — new rooms will try EC2 primary');
      await reloadAgentAlerts();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to reset circuit');
    } finally {
      setBusyAlertAction(false);
    }
  };

  const handleAckUsageAlerts = async (ids = null) => {
    setBusyUsageAck(true);
    try {
      await v2Admin.acknowledgeUsageAlerts(ids ? { ids } : {});
      toast.success('High-usage alerts acknowledged');
      await reloadDashboard();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to acknowledge usage alerts');
    } finally {
      setBusyUsageAck(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Quick Navigation */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">SaaS Command Center</h1>
            {Number(usage.liveRoomsNow) > 0 && (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                ● {usage.liveRoomsNow} live {usage.liveRoomsNow === 1 ? 'room' : 'rooms'}
              </Badge>
            )}
            {Number(notetakerOps.activeBots) > 0 && (
              <Badge variant="secondary">
                {notetakerOps.activeBots} active notetaker {notetakerOps.activeBots === 1 ? 'bot' : 'bots'}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Growth, platform minutes, account cap alerts, goodwill credits, and unit economics in one place.
            {dashboard?.generatedAt ? ` Updated ${fmtDateTime(dashboard.generatedAt)}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={refreshAll}>
            Refresh metrics
          </Button>
        </div>
      </div>

      {/* Quick-nav pills */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_NAV.map((item) => (
          <Button key={item.to} variant="outline" size="sm" className="h-7 text-xs" asChild>
            <Link to={item.to}>{item.label}</Link>
          </Button>
        ))}
      </div>

      {/* High-Usage / Quota Cap Alert Banner */}
      {openUsageAlerts.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/10 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base text-amber-900 dark:text-amber-200">
                High-Usage &amp; Quota Alerts — {openUsageAlerts.length} unacknowledged
              </CardTitle>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={busyUsageAck}
                onClick={() => handleAckUsageAlerts()}
              >
                Acknowledge all
              </Button>
            </div>
            <CardDescription className="text-xs">
              Triggered automatically when workspaces cross 80%, 100% (overage), 90% of hard ceiling, or hard-stop.
              Outbound notifications follow your Admin Email &amp; Telegram settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="overflow-x-auto rounded-lg border border-border/60 bg-background/85">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium">Summary</th>
                    <th className="px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openUsageAlerts.slice(0, 8).map((a) => (
                    <tr key={a.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {fmtDateTime(a.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={a.severity === 'critical' ? 'destructive' : 'secondary'}>
                          {a.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {a.org_name || a.org_id}
                        {a.owner_email ? (
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {a.owner_email}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{a.summary}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => openOrgInCrm(a.org_id)}
                          >
                            Inspect &amp; Credit →
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={busyUsageAck}
                            onClick={() => handleAckUsageAlerts([a.id])}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LiveKit Agent Failover Banner */}
      {showAgentBanner && (
        <Card className="border-amber-500/50 bg-amber-500/10 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg text-amber-800 dark:text-amber-300">
                {circuitOpen
                  ? 'LiveKit Agent Failover — Cloud Backup Active'
                  : `LiveKit Agent Failover — ${unackedFailovers.length} unacknowledged alert(s)`}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {circuitOpen && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAlertAction}
                    onClick={handleResetCircuit}
                  >
                    Reset circuit now
                  </Button>
                )}
                {unackedFailovers.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    disabled={busyAlertAction}
                    onClick={handleAckAlerts}
                  >
                    Acknowledge alerts
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Rooms automatically switched from self-hosted EC2 (<code>translation-selfhosted-xai</code>) to LiveKit
              Cloud backup (<code>translation-cloud-deepgram-codeswitch</code>).
              {circuitOpen && agentAlerts?.runtime?.circuitOpenUntil
                ? ` Circuit resets automatically at ${fmtDateTime(agentAlerts.runtime.circuitOpenUntil)}.`
                : ''}
            </p>
            {unackedFailovers.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border/60 bg-background/80">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Time</th>
                      <th className="px-3 py-1.5 font-medium">Type</th>
                      <th className="px-3 py-1.5 font-medium">Room</th>
                      <th className="px-3 py-1.5 font-medium">Reason</th>
                      <th className="px-3 py-1.5 font-medium">Transition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unackedFailovers.slice(0, 6).map((ev) => (
                      <tr key={ev.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-1.5 text-muted-foreground">{fmtDateTime(ev.createdAt)}</td>
                        <td className="px-3 py-1.5 font-medium">{ev.eventKind}</td>
                        <td className="px-3 py-1.5 font-mono">{ev.roomName}</td>
                        <td className="px-3 py-1.5">{ev.reason}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {ev.fromPipeline} → {ev.toPipeline}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <Link className="text-primary underline-offset-2 hover:underline" to="/v2/app/admin/comms">
                Configure notification channels &amp; timeouts →
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stripe Disputes Banner */}
      {(openDisputeCount > 0 || (disputes && disputes.length > 0)) && (
        <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-destructive">Stripe disputes — {openDisputeCount} open</CardTitle>
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
                            onClick={() => openOrgInCrm(d.org_id)}
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
          </CardContent>
        </Card>
      )}

      {/* 4 Headline KPI Pillars */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* 1. Signups & Active Accounts */}
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Signups &amp; Accounts
              </span>
              {growth.signupGrowthPct30d != null && (
                <Badge
                  variant="secondary"
                  className={
                    growth.signupGrowthPct30d > 0
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : ''
                  }
                >
                  {growth.signupGrowthPct30d >= 0 ? `+${growth.signupGrowthPct30d}%` : `${growth.signupGrowthPct30d}%`}{' '}
                  30d
                </Badge>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">+{growth.newSignups7d ?? 0}</span>
              <span className="text-xs text-muted-foreground">new users (7d)</span>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Today / 30d</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                +{growth.newSignupsToday ?? 0} / +{growth.newSignups30d ?? 0}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Total users</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {(growth.totalUsers ?? 0).toLocaleString()} ({growth.activeUsers30d ?? 0} active)
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Workspaces</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {growth.totalOrgs ?? kpis?.orgCount ?? 0} ({growth.personalOrgs ?? 0}P · {growth.teamOrgs ?? 0}T)
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Active orgs (7d / 30d)</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {growth.activeOrgs7d ?? 0} / {growth.activeOrgs30d ?? 0}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Platform Minutes */}
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Platform Minutes (MTD)
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                All-time: {allTimeTotalPlatformMinutes.toLocaleString()}m
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{mtdTotalPlatformMinutes.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground">total min this month</span>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Meeting part.-min</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {(usage.mtdMeetingMinutes ?? 0).toLocaleString()}m
                <span className="font-normal text-muted-foreground">
                  {' '}
                  / {(usage.allTimeMeetingMinutes ?? 0).toLocaleString()}m
                </span>
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Translation min</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {(usage.mtdTranslationMinutes ?? 0).toLocaleString()}m
                <span className="font-normal text-muted-foreground">
                  {' '}
                  / {(usage.allTimeTranslationMinutes ?? 0).toLocaleString()}m
                </span>
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Notetaker bot min</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {(usage.mtdNotetakerMinutes ?? 0).toLocaleString()}m
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Meetings (Today / MTD)</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {usage.meetingsToday ?? 0} / {usage.meetingsMtd ?? 0}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. Revenue & Margin */}
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Revenue &amp; Margin
              </span>
              <Badge
                variant="secondary"
                className={
                  netMarginUsd >= 0
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-destructive/15 text-destructive'
                }
              >
                Net {fmtUsd(netMarginUsd)}
              </Badge>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{fmtCents(mrrCents)}</span>
              <span className="text-xs text-muted-foreground">est. MRR</span>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Paid orgs</div>
              <div className="mt-0.5 font-semibold tabular-nums">{revenue?.paidOrgs ?? 0}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">ARPU</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {revenue?.arpuCents != null ? fmtCents(revenue.arpuCents) : '—'}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">MTD infra cost</div>
              <div className="mt-0.5 font-semibold tabular-nums">{fmtUsd(mtdInfraUsd)}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Open disputes</div>
              <div
                className={`mt-0.5 font-semibold tabular-nums ${openDisputeCount > 0 ? 'text-destructive' : ''}`}
              >
                {openDisputeCount}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. Notetaker & Recording Ops */}
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notetaker &amp; Audio S3
              </span>
              {Number(notetakerOps.failedBots7d) > 0 && (
                <Badge variant="destructive">{notetakerOps.failedBots7d} failed (7d)</Badge>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{notetakerOps.completedBotsMtd ?? 0}</span>
              <span className="text-xs text-muted-foreground">bots completed (MTD)</span>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Synced calendars</div>
              <div className="mt-0.5 font-semibold tabular-nums">{notetakerOps.connectedCalendars ?? 0}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Active / Failed (7d)</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {notetakerOps.activeBots ?? 0} / {notetakerOps.failedBots7d ?? 0}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">Native MP3 files</div>
              <div className="mt-0.5 font-semibold tabular-nums">{usage.recordingsCount ?? 0}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="text-muted-foreground">S3 audio stored</div>
              <div className="mt-0.5 font-semibold tabular-nums">{fmtBytes(usage.recordingsTotalBytes)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 14-Day Activity Sparklines + Plan/Billing Mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Signups ({sparkDays}d)</CardTitle>
          </CardHeader>
          <CardContent>
            <DayBarChart rows={sparklines.signupsByDay} days={sparkDays} valueKey="count" unit="signups" />
          </CardContent>
        </Card>
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Participant-Minutes ({sparkDays}d)</CardTitle>
          </CardHeader>
          <CardContent>
            <DayBarChart rows={sparklines.minutesByDay} days={sparkDays} valueKey="minutes" unit="min" />
          </CardContent>
        </Card>
        <Card className="app-card border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Meetings Created ({sparkDays}d)</CardTitle>
          </CardHeader>
          <CardContent>
            <DayBarChart rows={sparklines.meetingsByDay} days={sparkDays} valueKey="count" unit="meetings" />
          </CardContent>
        </Card>
      </div>

      {(kpis?.planMix?.length > 0 || kpis?.billingStatusMix?.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <MixBar title="Plan mix" items={kpis?.planMix} labelKey="plan_id" countKey="org_count" />
          <MixBar title="Billing status mix" items={kpis?.billingStatusMix} labelKey="billing_status" countKey="c" />
        </div>
      )}

      {/* Operational Watchlist & Recent Signups */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Watchlist */}
        <Card className="app-card overflow-hidden border-border/60 shadow-sm xl:col-span-7">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">High-Usage, Cap-Risk &amp; Margin Watchlist</CardTitle>
                <CardDescription className="text-xs">
                  Accounts at ≥80% quota, in overage, hard-stopped, or where MTD infra cost exceeds plan revenue.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                <Link to="/v2/app/admin/orgs">All accounts →</Link>
              </Button>
            </div>
          </CardHeader>
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Quota (MTD)</th>
                  <th className="px-3 py-2.5 font-medium">Infra Cost</th>
                  <th className="px-3 py-2.5 text-right font-medium">Support</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((w) => {
                  const meta = flagMeta(w.primary_flag);
                  const barPct = Math.min(100, Math.max(0, Number(w.quota_pct || 0)));
                  return (
                    <tr key={w.org_id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground">{w.org_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {w.owner_email || w.org_id.slice(0, 8)} · {w.plan_name}
                          {w.is_comp ? ` (${w.comp_label || 'comp'})` : ''}
                        </div>
                        {w.admin_tags?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {w.admin_tags.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {w.is_comp ? (
                          <span>{w.mtd_meeting_minutes.toLocaleString()}m (unlimited)</span>
                        ) : (
                          <div className="min-w-[120px]">
                            <div className="flex justify-between text-[11px]">
                              <span>
                                {w.mtd_meeting_minutes.toLocaleString()} / {w.effective_meeting_limit.toLocaleString()}m
                              </span>
                              <span className="font-semibold">{w.quota_pct}%</span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={
                                  w.quota_pct >= 100
                                    ? 'h-full bg-destructive'
                                    : w.quota_pct >= 80
                                      ? 'h-full bg-amber-500'
                                      : 'h-full bg-primary'
                                }
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            {w.bonus_meeting_minutes > 0 && (
                              <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                                Includes +{w.bonus_meeting_minutes.toLocaleString()}m bonus credit
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{fmtUsd(w.mtd_cost_usd)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => openOrgInCrm(w.org_id)}
                        >
                          Open &amp; Credit →
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {watchlist.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      All workspaces are currently healthy and below 80% of their included minute quotas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent Signups */}
        <Card className="app-card overflow-hidden border-border/60 shadow-sm xl:col-span-5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Recent Signups</CardTitle>
                <CardDescription className="text-xs">
                  Latest 10 users across personal &amp; team workspaces.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                <Link to="/v2/app/admin/users">All users →</Link>
              </Button>
            </div>
          </CardHeader>
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">MTD</th>
                  <th className="px-3 py-2.5 text-right font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {recentSignups.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      {u.org_id ? (
                        <button
                          type="button"
                          className="text-left font-medium text-primary hover:underline"
                          onClick={() => openOrgInCrm(u.org_id)}
                        >
                          {u.display_name || u.email}
                        </button>
                      ) : (
                        <span className="font-medium">{u.display_name || u.email}</span>
                      )}
                      <div className="text-[11px] text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="text-[10px]">
                        {u.plan_id || 'free'}
                        {u.is_comp === 1 ? ' · comp' : ''}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{Math.round(u.mtd_meeting_minutes || 0)}m</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-muted-foreground">
                      {(u.created_at || '').slice(0, 10)}
                    </td>
                  </tr>
                ))}
                {recentSignups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No signups yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default AdminOverview;
