import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin, v2Orgs } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';

const COMP_LABELS = ['personal', 'friend', 'promo', 'internal'];
const AUDIT_STORAGE_PREFIX = 'v2-superadmin-audit-reason';

function orgKey(orgId) {
  return String(orgId ?? '');
}

function loadStoredAuditReason(orgId) {
  try {
    return sessionStorage.getItem(`${AUDIT_STORAGE_PREFIX}:${orgKey(orgId)}`) || '';
  } catch {
    return '';
  }
}

function persistAuditReason(orgId, value) {
  try {
    const key = `${AUDIT_STORAGE_PREFIX}:${orgKey(orgId)}`;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}

function fmtUsd(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}

function fmtCents(c) {
  return fmtUsd(Number(c) / 100);
}

function fmtMins(n) {
  const v = Number(n) || 0;
  return `${Math.round(v).toLocaleString()} participant-min`;
}

export default function V2SuperAdmin() {
  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('orgs');
  const [orgs, setOrgs] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [costs, setCosts] = useState(null);
  const [costsLoadedAt, setCostsLoadedAt] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);
  const [billingEdit, setBillingEdit] = useState({});
  const [auditReason, setAuditReason] = useState({});
  const [auditReasonError, setAuditReasonError] = useState(null);
  const [planEdit, setPlanEdit] = useState({});
  const [compEdit, setCompEdit] = useState({});
  const [compLabel, setCompLabel] = useState({});
  const auditInputRef = useRef(null);

  const reloadOrgs = () =>
    v2Admin.orgs().then((r) => setOrgs(r.orgs || [])).catch(() => toast.error('Failed to load orgs'));

  const reloadCosts = () =>
    v2Admin
      .costsSummary()
      .then((data) => {
        setCosts(data);
        setCostsLoadedAt(new Date());
      })
      .catch(() => toast.error('Failed to load costs'));

  const reloadKpis = () => v2Orgs.adminKpis().then(setKpis).catch(() => {});

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

  useEffect(() => {
    if (!selectedOrg) return;
    const key = orgKey(selectedOrg);
    setAuditReason((prev) => {
      if (prev[key]) return prev;
      const stored = loadStoredAuditReason(key);
      return stored ? { ...prev, [key]: stored } : prev;
    });
  }, [selectedOrg]);

  const readAuditReasonFromDom = (orgId) => {
    const el = document.getElementById(`audit-reason-${orgKey(orgId)}`);
    return (el?.value || '').trim();
  };

  const getAuditReason = (orgId) => {
    const key = orgKey(orgId);
    const fromState = (auditReason[key] || '').trim();
    const fromDom = readAuditReasonFromDom(orgId);
    return fromDom || fromState;
  };

  const focusAuditReason = (orgId) => {
    const key = orgKey(orgId);
    setAuditReasonError(key);
    const el = auditInputRef.current || document.getElementById(`audit-reason-${key}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const requireAuditReason = (orgId) => {
    const reason = getAuditReason(orgId);
    if (reason.length >= 4) {
      setAuditReasonError(null);
      return reason;
    }
    focusAuditReason(orgId);
    toast.error('Enter an audit reason above (at least 4 characters).');
    return null;
  };

  const updateAuditReason = (orgId, value) => {
    const key = orgKey(orgId);
    setAuditReason((prev) => ({ ...prev, [key]: value }));
    persistAuditReason(key, value);
    if (auditReasonError === key) setAuditReasonError(null);
  };

  const saveBilling = async (orgId) => {
    const status = billingEdit[orgKey(orgId)];
    if (!status) return;
    const reason = requireAuditReason(orgId);
    if (!reason) return;
    try {
      await v2Orgs.adminPatchOrg(orgId, { billing_status: status, reason });
      toast.success('Billing status updated');
      reloadOrgs();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    }
  };

  const savePlan = async (orgId) => {
    const key = orgKey(orgId);
    const plan_id = planEdit[key] ?? orgDetail?.subscription?.plan_id;
    const reason = requireAuditReason(orgId);
    if (!plan_id) {
      toast.error('Pick a plan first.');
      return;
    }
    if (!reason) return;
    try {
      await v2Admin.setPlan(orgId, { plan_id, reason });
      toast.success('Plan updated');
      reloadOrgs();
      reloadCosts();
      reloadKpis();
      if (selectedOrg === orgId) v2Admin.orgDetail(orgId).then(setOrgDetail);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const saveComp = async (orgId) => {
    const key = orgKey(orgId);
    const reason = requireAuditReason(orgId);
    if (!reason) return;
    const isComp = compEdit[key] ?? orgDetail?.subscription?.is_comp === 1;
    try {
      await v2Admin.setComp(orgId, {
        is_comp: Boolean(isComp),
        comp_label: compLabel[key] ?? orgDetail?.subscription?.comp_label ?? 'personal',
        reason,
      });
      toast.success('Comp override saved');
      persistAuditReason(key, '');
      setAuditReason((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      reloadOrgs();
      reloadCosts();
      reloadKpis();
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parley admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organizations are the billing unit — select one to see members, usage, and comp/plan controls.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refreshAdminData}>
          Refresh data
        </Button>
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
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Accounts</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kpis?.userCount ?? '—'}</div>
            <div className="text-xs text-muted-foreground">Login identities (nested under orgs)</div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="costs">Costs & margin</TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-4 space-y-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Organizations</CardTitle>
              <CardDescription>
                {orgs.length} workspaces — click a row for usage analytics and comp/plan controls. Participant-min =
                each person-minute in a meeting (2 people × 30 min = 60).
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Comp</th>
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
            <Card key={orgKey(selectedOrg)} className="app-card border-primary/30">
              <CardHeader>
                <CardTitle>{orgDetail.org?.name}</CardTitle>
                <CardDescription>Org ID: {orgKey(selectedOrg)}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                {orgDetail.usageAnalytics && (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4 lg:col-span-2">
                    <div>
                      <h3 className="font-medium">Usage analytics</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Billing meter: participant-minutes (people × minutes in meetings).{' '}
                        {orgDetail.usageAnalytics.periodLabel}. Infra cost is a separate estimate from completed
                        rooms.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">This month</div>
                        <div className="font-semibold tabular-nums">
                          {fmtMins(orgDetail.usageAnalytics.monthToDate?.meetingMinutes)}
                        </div>
                        {orgDetail.subscription?.included_meeting_minutes != null &&
                          orgDetail.subscription?.is_comp !== 1 && (
                            <div className="text-xs text-muted-foreground">
                              of {orgDetail.subscription.included_meeting_minutes.toLocaleString()} included
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
                          {Math.round(orgDetail.usageAnalytics.monthToDate?.translationMinutes || 0).toLocaleString()}{' '}
                          min
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">Infra cost (month)</div>
                        <div className="font-semibold tabular-nums">{fmtUsd(orgDetail.costThisMonthUsd)}</div>
                      </div>
                    </div>
                    {(orgDetail.usageAnalytics.byDay?.length > 0 ||
                      orgDetail.usageAnalytics.byMeeting?.length > 0) && (
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
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                              By meeting (this month)
                            </div>
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
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4 lg:col-span-2">
                  <label htmlFor={`audit-reason-${orgKey(selectedOrg)}`} className="text-sm font-medium">
                    Audit reason <span className="text-destructive">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Required before saving comp, plan, or billing changes. Use at least 4 characters.
                  </p>
                  <Input
                    ref={auditInputRef}
                    id={`audit-reason-${orgKey(selectedOrg)}`}
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. Founder account — unlimited access"
                    value={auditReason[orgKey(selectedOrg)] ?? ''}
                    onChange={(e) => updateAuditReason(selectedOrg, e.target.value)}
                    className={cn(
                      auditReasonError === orgKey(selectedOrg) &&
                        'border-destructive focus-visible:ring-destructive aria-invalid:border-destructive'
                    )}
                    aria-invalid={auditReasonError === orgKey(selectedOrg)}
                  />
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <h3 className="font-medium">Comp / unlimited access</h3>
                  <p className="text-xs text-muted-foreground">
                    Toggle unlimited access for personal, friend, or promo accounts. Bypasses all usage caps.
                    Fill the audit reason above before saving.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(compEdit[orgKey(selectedOrg)] ?? orgDetail.subscription?.is_comp === 1)}
                      onChange={(e) =>
                        setCompEdit((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.checked }))
                      }
                    />
                    Unlimited (comp)
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={compLabel[orgKey(selectedOrg)] ?? orgDetail.subscription?.comp_label ?? 'personal'}
                    onChange={(e) =>
                      setCompLabel((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.value }))
                    }
                  >
                    {COMP_LABELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" onClick={() => saveComp(selectedOrg)}>
                    Save comp override
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <h3 className="font-medium">Plan override</h3>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={planEdit[orgKey(selectedOrg)] ?? orgDetail.subscription?.plan_id ?? 'free'}
                    onChange={(e) =>
                      setPlanEdit((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.value }))
                    }
                  >
                    <option value="free">free</option>
                    <option value="starter">starter</option>
                    <option value="pro">pro</option>
                  </select>
                  <Button type="button" size="sm" onClick={() => savePlan(selectedOrg)}>
                    Set plan
                  </Button>
                  <div className="text-xs text-muted-foreground pt-2">
                    See usage analytics above for month vs all-time breakdown.
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
                  <h3 className="font-medium">Billing status</h3>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="max-w-[160px]"
                      defaultValue={orgDetail.org?.billing_status}
                      onChange={(e) =>
                        setBillingEdit((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.value }))
                      }
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

        <TabsContent value="costs" className="mt-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Costs & margin (month)</CardTitle>
              <CardDescription>
                Estimated infra cost for meetings that ended this calendar month vs plan revenue. Comp orgs
                show $0 revenue. Data refreshes when you open this tab — click Refresh if numbers look stale.
                {costsLoadedAt && (
                  <span className="block mt-1 text-xs">
                    Last loaded {costsLoadedAt.toLocaleTimeString()}
                  </span>
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
                      onClick={() => {
                        if (row.org_id) {
                          setTab('orgs');
                          setSelectedOrg(row.org_id);
                        }
                      }}
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
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
