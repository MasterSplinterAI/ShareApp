import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { fmtUsd, fmtMins, fmtDateTime, BILLING_STATUSES } from './formatters';
import { SuspendedBadge } from './shared';
import { AuditReasonField } from './AuditReasonField';
import { useAuditReason, orgKey } from './useAuditReason';

const COMP_LABELS = ['personal', 'friend', 'promo', 'internal'];
const PLAN_OPTIONS = ['free', 'starter', 'pro'];
const PRESET_TAGS = ['vip', 'pilot', 'high-touch', 'churn-risk', 'partner', 'follow-up'];
const MINUTE_PRESETS = [120, 300, 600, 1500];

function matchesOrgQuery(o, q) {
  if (!q) return true;
  const tagText = Array.isArray(o.admin_tags) ? o.admin_tags.join(' ') : '';
  return [o.name, o.owner_email, o.owner_display_name, o.plan_id, o.billing_status, o.stripe_customer_id, tagText].some(
    (v) => (v || '').toLowerCase().includes(q)
  );
}

function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function OrgsTab({ orgs = [], selectedOrg, setSelectedOrg, orgDetail, onReload }) {
  const [planEdit, setPlanEdit] = useState({});
  const [compEdit, setCompEdit] = useState({});
  const [compLabel, setCompLabel] = useState({});
  const [billingEdit, setBillingEdit] = useState({});
  const [limitsEdit, setLimitsEdit] = useState({});
  const [emailForm, setEmailForm] = useState({
    purpose: 'account_notice',
    subject: '',
    body: '',
    reason: '',
  });
  const [creditForm, setCreditForm] = useState({
    meetingMinutes: '300',
    translationMinutes: '0',
    expiryMode: '30',
    stripeDollars: '',
    reason: '',
  });
  const [tagDraft, setTagDraft] = useState([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [notePinned, setNotePinned] = useState(false);

  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const { auditReason, auditReasonError, auditInputRef, updateAuditReason, requireAuditReason } =
    useAuditReason(selectedOrg);

  useEffect(() => {
    setTagDraft(Array.isArray(orgDetail?.adminTags) ? orgDetail.adminTags : []);
    setCustomTagInput('');
  }, [orgDetail?.org?.id, orgDetail?.adminTags]);

  const q = search.trim().toLowerCase();
  const sevenDaysAgoIso = useMemo(() => new Date(Date.now() - 7 * 86400_000).toISOString(), []);

  const filteredOrgs = useMemo(() => {
    const list = orgs.filter((o) => {
      if (typeFilter === 'personal' && o.account_type !== 'personal') return false;
      if (typeFilter === 'team' && o.account_type === 'personal') return false;
      if (typeFilter === 'high_usage' && Number(o.quota_pct || 0) < 80) return false;
      if (typeFilter === 'comp' && o.is_comp !== 1) return false;
      if (typeFilter === 'paid' && (o.is_comp === 1 || !o.plan_id || o.plan_id === 'free')) return false;
      if (typeFilter === 'new_7d' && String(o.created_at || '') < sevenDaysAgoIso) return false;
      if (typeFilter === 'tagged' && (!Array.isArray(o.admin_tags) || o.admin_tags.length === 0)) return false;
      return matchesOrgQuery(o, q);
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'mtd_minutes') {
        return Number(b.mtd_meeting_minutes || 0) - Number(a.mtd_meeting_minutes || 0);
      }
      if (sortBy === 'quota_pct') {
        return Number(b.quota_pct || 0) - Number(a.quota_pct || 0);
      }
      if (sortBy === 'mtd_cost') {
        return Number(b.mtd_cost_usd || 0) - Number(a.mtd_cost_usd || 0);
      }
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [orgs, typeFilter, q, sortBy, sevenDaysAgoIso]);

  const handleExportOrgsCsv = () => {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `lalia-accounts-${today}.csv`,
      [
        'org_id',
        'name',
        'owner_email',
        'account_type',
        'plan_id',
        'is_comp',
        'billing_status',
        'mtd_meeting_minutes',
        'effective_included_meeting_minutes',
        'bonus_meeting_minutes',
        'quota_pct',
        'mtd_cost_usd',
        'tags',
        'created_at',
      ],
      filteredOrgs.map((o) => [
        o.id,
        o.name,
        o.owner_email || '',
        o.account_type || 'team',
        o.plan_id || 'free',
        o.is_comp === 1 ? o.comp_label || 'comp' : '',
        o.billing_status || '',
        Math.round(o.mtd_meeting_minutes || 0),
        o.effective_included_meeting_minutes ?? o.included_meeting_minutes ?? 0,
        o.bonus_meeting_minutes || 0,
        o.quota_pct || 0,
        Number(o.mtd_cost_usd || 0).toFixed(4),
        Array.isArray(o.admin_tags) ? o.admin_tags.join(';') : '',
        o.created_at || '',
      ])
    );
  };

  const key = orgKey(selectedOrg);
  const sub = orgDetail?.subscription;
  const org = orgDetail?.org;
  const ent = orgDetail?.entitlements;
  const credits = orgDetail?.credits || [];
  const notes = orgDetail?.notes || [];
  const pendingOverages = orgDetail?.pendingOverages || [];
  const suspended = Boolean(org?.suspended_at);

  const afterMutation = async () => {
    onReload?.();
  };

  const resolveSupportReason = (inlineReason, fallbackDefault = '') => {
    const candidate = (inlineReason || '').trim() || (auditReason[key] || '').trim() || fallbackDefault;
    if (candidate.length < 4) {
      toast.error('Provide a reason (4+ chars) in the credit/support field or Audit reason box.');
      return null;
    }
    return candidate;
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

  const cancelStripeSubscription = (immediate = false) =>
    runWithReason(
      immediate ? 'Stripe subscription canceled immediately' : 'Stripe subscription set to cancel at period end',
      (reason) =>
        v2Admin.cancelOrgSubscription(selectedOrg, {
          reason,
          cancelAtPeriodEnd: !immediate,
        })
    );

  const saveLimits = (clear = false) => {
    const edit = limitsEdit[key] || {};
    const body = clear
      ? { clearCustom: true }
      : {
          custom_included_meeting_minutes: edit.meeting ?? sub?.custom_included_meeting_minutes ?? '',
          custom_included_translation_minutes: edit.translation ?? sub?.custom_included_translation_minutes ?? '',
        };
    return runWithReason(clear ? 'Custom limits cleared' : 'Custom limits saved', (reason) =>
      v2Admin.patchOrgLimits(selectedOrg, { ...body, reason })
    );
  };

  const suspendOrReactivate = () =>
    runWithReason(suspended ? 'Org reactivated' : 'Org suspended', (reason) =>
      suspended ? v2Admin.reactivateOrg(selectedOrg, { reason }) : v2Admin.suspendOrg(selectedOrg, { reason })
    );

  const handleGrantBonusMinutes = async () => {
    const reason = resolveSupportReason(creditForm.reason);
    if (!reason) return;
    const meetingMinutes = Math.round(Number(creditForm.meetingMinutes) || 0);
    const translationMinutes = Math.round(Number(creditForm.translationMinutes) || 0);
    if (meetingMinutes <= 0 && translationMinutes <= 0) {
      toast.error('Enter positive bonus meeting or translation minutes.');
      return;
    }
    const payload = {
      meetingMinutes,
      translationMinutes,
      reason,
    };
    if (creditForm.expiryMode === 'end_of_month') {
      payload.expiresAt = 'end_of_month';
    } else if (creditForm.expiryMode === 'never') {
      payload.expiresAt = 'never';
    } else {
      payload.expiresInDays = Number(creditForm.expiryMode) || 30;
    }
    setBusy(true);
    try {
      await v2Admin.grantBonusMinutes(selectedOrg, payload);
      toast.success('Bonus minutes granted');
      setCreditForm((p) => ({ ...p, reason: '' }));
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to grant bonus minutes');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeGrant = async (grantId) => {
    const reason = resolveSupportReason(creditForm.reason, 'Revoked unused bonus credit grant');
    if (!reason) return;
    setBusy(true);
    try {
      await v2Admin.revokeCreditGrant(selectedOrg, grantId, { reason });
      toast.success('Bonus minute grant revoked');
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to revoke grant');
    } finally {
      setBusy(false);
    }
  };

  const handleApplyStripeCredit = async () => {
    const reason = resolveSupportReason(creditForm.reason);
    if (!reason) return;
    const dollars = Number(creditForm.stripeDollars);
    if (!Number.isFinite(dollars) || dollars < 0.5) {
      toast.error('Enter at least $0.50 for a Stripe customer credit.');
      return;
    }
    setBusy(true);
    try {
      await v2Admin.applyStripeBalanceCredit(selectedOrg, {
        amountCents: Math.round(dollars * 100),
        reason,
      });
      toast.success(`Applied $${dollars.toFixed(2)} credit to Stripe customer balance`);
      setCreditForm((p) => ({ ...p, stripeDollars: '', reason: '' }));
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to apply Stripe balance credit');
    } finally {
      setBusy(false);
    }
  };

  const handleWaiveOverages = async () => {
    const reason = resolveSupportReason(creditForm.reason);
    if (!reason) return;
    setBusy(true);
    try {
      const r = await v2Admin.waivePendingOverages(selectedOrg, { reason });
      toast.success(`Waived ${r.waivedCount} pending overage item(s)`);
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to waive overages');
    } finally {
      setBusy(false);
    }
  };

  const toggleTag = (tag) => {
    setTagDraft((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const addCustomTag = () => {
    const clean = customTagInput
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);
    if (!clean) return;
    if (!tagDraft.includes(clean)) {
      setTagDraft((prev) => [...prev, clean]);
    }
    setCustomTagInput('');
  };

  const handleSaveTags = async () => {
    const reason = resolveSupportReason('', 'CRM account tag update');
    if (!reason) return;
    setBusy(true);
    try {
      await v2Admin.patchOrgTags(selectedOrg, { tags: tagDraft, reason });
      toast.success('Account tags updated');
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save tags');
    } finally {
      setBusy(false);
    }
  };

  const handleAddNote = async () => {
    if (noteBody.trim().length < 2) {
      toast.error('Write a note first.');
      return;
    }
    setBusy(true);
    try {
      await v2Admin.addOrgNote(selectedOrg, {
        body: noteBody.trim(),
        pinned: notePinned,
      });
      toast.success('Support note saved');
      setNoteBody('');
      setNotePinned(false);
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to add note');
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePinNote = async (note) => {
    setBusy(true);
    try {
      await v2Admin.patchOrgNote(selectedOrg, note.id, { pinned: !note.pinned });
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update note');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    setBusy(true);
    try {
      await v2Admin.deleteOrgNote(selectedOrg, noteId);
      toast.success('Note deleted');
      await afterMutation();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to delete note');
    } finally {
      setBusy(false);
    }
  };

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
        purpose: emailForm.purpose || 'account_notice',
        subject: emailForm.subject.trim(),
        body: emailForm.body.trim(),
        reason: emailForm.reason.trim(),
      });
      toast.success(`Sent to ${r.recipients?.length || 0} owner(s)`);
      setEmailForm({ purpose: 'account_notice', subject: '', body: '', reason: '' });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to send email');
    } finally {
      setBusy(false);
    }
  };

  const stripeBase = orgDetail?.stripeDashboardBase || 'https://dashboard.stripe.com';
  const pendingOverageUsd =
    pendingOverages.reduce((acc, r) => acc + (Number(r.amount_micros) || 0), 0) / 1_000_000;

  return (
    <div className="space-y-4">
      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Accounts &amp; Support CRM</CardTitle>
              <CardDescription>
                {orgs.length} accounts ({orgs.filter((o) => o.account_type === 'personal').length} personal,{' '}
                {orgs.filter((o) => o.account_type !== 'personal').length} team) — click any workspace to grant
                one-time goodwill credits, manage tags/notes, or adjust billing.
              </CardDescription>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={handleExportOrgsCsv}>
              Export CSV ({filteredOrgs.length})
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search accounts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email, name, plan, or #tag…"
              className="max-w-xs"
            />
            <select
              aria-label="Sort accounts"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-xs"
            >
              <option value="newest">Sort: Newest signup</option>
              <option value="mtd_minutes">Sort: Highest MTD minutes</option>
              <option value="quota_pct">Sort: Highest quota %</option>
              <option value="mtd_cost">Sort: Highest infra cost</option>
            </select>
            {[
              { id: 'all', label: 'All' },
              { id: 'personal', label: 'Personal' },
              { id: 'team', label: 'Team' },
              { id: 'high_usage', label: 'High usage (≥80%)' },
              { id: 'paid', label: 'Paid' },
              { id: 'comp', label: 'Comp' },
              { id: 'new_7d', label: 'New (7d)' },
              { id: 'tagged', label: 'Tagged' },
            ].map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={typeFilter === opt.id ? 'default' : 'outline'}
                onClick={() => setTypeFilter(opt.id)}
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
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Owner email</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Comp</th>
                <th className="px-4 py-3 font-medium">Billing</th>
                <th className="px-4 py-3 font-medium" title="Participant-minutes this calendar month vs effective quota">
                  Usage / Quota (MTD)
                </th>
                <th className="px-4 py-3 font-medium" title="Estimated infra cost for meetings ended this month">
                  Infra cost (month)
                </th>
                <th className="px-4 py-3 font-medium">Members</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrgs.map((o) => (
                <tr
                  key={o.id}
                  className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30 ${
                    selectedOrg === o.id ? 'bg-primary/5' : ''
                  }`}
                  onClick={() => setSelectedOrg(o.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{o.name}</span>
                      {o.suspended_at && <SuspendedBadge />}
                      {String(o.suspended_reason || '').startsWith('stripe_dispute:') && (
                        <Badge variant="destructive">Dispute</Badge>
                      )}
                      {Number(o.note_count || 0) > 0 && (
                        <Badge variant="outline" className="text-[10px]" title="Internal support notes">
                          {o.note_count} {o.note_count === 1 ? 'note' : 'notes'}
                        </Badge>
                      )}
                    </div>
                    {Array.isArray(o.admin_tags) && o.admin_tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {o.admin_tags.map((t) => (
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
                  <td className="px-4 py-3 text-muted-foreground">{o.owner_email || '—'}</td>
                  <td className="px-4 py-3">
                    {o.account_type === 'personal' ? (
                      <Badge variant="secondary">Personal</Badge>
                    ) : (
                      <Badge variant="outline">Team</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span>{o.plan_id || '—'}</span>
                    {Number(o.bonus_meeting_minutes || 0) > 0 && (
                      <span className="ml-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        +{o.bonus_meeting_minutes}m
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {o.is_comp === 1 ? <Badge variant="secondary">{o.comp_label || 'comp'}</Badge> : '—'}
                  </td>
                  <td className="px-4 py-3">{o.billing_status || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span>{Math.round(o.mtd_meeting_minutes || 0).toLocaleString()}</span>
                    {o.is_comp !== 1 && o.effective_included_meeting_minutes != null && (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        / {Number(o.effective_included_meeting_minutes).toLocaleString()}m
                      </span>
                    )}
                    {o.is_comp !== 1 && Number(o.quota_pct || 0) >= 80 && (
                      <Badge
                        variant={Number(o.quota_pct) >= 100 ? 'destructive' : 'secondary'}
                        className="ml-1.5 text-[10px]"
                      >
                        {o.quota_pct}%
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{fmtUsd(o.mtd_cost_usd)}</td>
                  <td className="px-4 py-3">{o.member_count}</td>
                </tr>
              ))}
              {filteredOrgs.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={9}>
                    No accounts match this filter.
                  </td>
                </tr>
              )}
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
              {Array.isArray(orgDetail.adminTags) &&
                orgDetail.adminTags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs">
                    #{t}
                  </Badge>
                ))}
            </CardTitle>
            <CardDescription>
              Org ID: {key}
              {org?.account_type
                ? ` · ${org.account_type === 'personal' ? 'Personal account' : 'Team workspace'}`
                : ''}
              {orgDetail?.members?.length
                ? ` · Owner: ${
                    orgDetail.members.find((m) => m.role === 'owner')?.email || orgDetail.members[0].email
                  }`
                : ''}
              {org?.suspended_reason ? ` · Suspended: ${org.suspended_reason}` : ''}
              {String(org?.suspended_reason || '').startsWith('stripe_dispute:')
                ? ' · Chargeback/dispute lock (reactivate only after review)'
                : ''}
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
                    {sub?.is_comp !== 1 && (ent?.includedMeetingMinutes ?? sub?.included_meeting_minutes) != null && (
                      <div className="text-xs text-muted-foreground">
                        of {(ent?.includedMeetingMinutes ?? sub?.included_meeting_minutes).toLocaleString()} effective
                        included
                        {Number(ent?.bonusMeetingMinutes || 0) > 0 && (
                          <span className="ml-1 font-medium text-emerald-600 dark:text-emerald-400">
                            (+{ent.bonusMeetingMinutes.toLocaleString()} bonus)
                          </span>
                        )}
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
                    {Number(ent?.bonusTranslationMinutes || 0) > 0 && (
                      <div className="text-xs text-emerald-600 dark:text-emerald-400">
                        +{ent.bonusTranslationMinutes.toLocaleString()} bonus translation min
                      </div>
                    )}
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

            <div className="lg:col-span-2">
              <AuditReasonField
                auditKey={selectedOrg}
                value={auditReason[key] ?? ''}
                onChange={(v) => updateAuditReason(selectedOrg, v)}
                error={auditReasonError}
                inputRef={auditInputRef}
                label="Audit reason (shared across support & billing actions below)"
              />
            </div>

            {/* One-Time Goodwill & Support Credits */}
            <div className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 lg:col-span-2">
              <div>
                <h3 className="font-medium">Goodwill &amp; Support Credits</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Grant temporary bonus minutes (raises effective quota &amp; hard cap without making the account
                  permanently free), apply a Stripe customer dollar credit to upcoming invoices, or waive unbilled
                  overages.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Bonus Minutes */}
                <div className="space-y-2.5 rounded-md border border-border/60 bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">1. Grant Bonus Minutes</span>
                    <div className="flex flex-wrap gap-1">
                      {MINUTE_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setCreditForm((p) => ({ ...p, meetingMinutes: String(preset) }))}
                        >
                          +{preset}m
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="block text-xs text-muted-foreground">
                      Meeting min
                      <Input
                        type="number"
                        min={0}
                        className="mt-1 h-8 text-xs"
                        value={creditForm.meetingMinutes}
                        onChange={(e) => setCreditForm((p) => ({ ...p, meetingMinutes: e.target.value }))}
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      Translation min
                      <Input
                        type="number"
                        min={0}
                        className="mt-1 h-8 text-xs"
                        value={creditForm.translationMinutes}
                        onChange={(e) => setCreditForm((p) => ({ ...p, translationMinutes: e.target.value }))}
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      Expires
                      <select
                        aria-label="Bonus minutes expiration"
                        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={creditForm.expiryMode}
                        onChange={(e) => setCreditForm((p) => ({ ...p, expiryMode: e.target.value }))}
                      >
                        <option value="30">In 30 days</option>
                        <option value="end_of_month">End of month (UTC)</option>
                        <option value="90">In 90 days</option>
                        <option value="never">Never expires</option>
                      </select>
                    </label>
                  </div>
                  <Input
                    aria-label="Support credit reason"
                    placeholder="Reason for credit (or fill shared Audit reason above)…"
                    className="h-8 text-xs"
                    value={creditForm.reason}
                    onChange={(e) => setCreditForm((p) => ({ ...p, reason: e.target.value }))}
                  />
                  <Button type="button" size="sm" disabled={busy} onClick={handleGrantBonusMinutes}>
                    Grant bonus minutes
                  </Button>
                </div>

                {/* Stripe Balance Credit & Waive Overages */}
                <div className="space-y-3 rounded-md border border-border/60 bg-background p-3">
                  <div className="space-y-2">
                    <span className="text-sm font-medium">2. Stripe Invoice Credit ($)</span>
                    <p className="text-xs text-muted-foreground">
                      Adds credit to the customer&apos;s Stripe balance, automatically reducing their next invoice.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        min={0.5}
                        step="0.50"
                        placeholder="Amount USD (e.g. 15.00)"
                        className="h-8 max-w-[180px] text-xs"
                        value={creditForm.stripeDollars}
                        onChange={(e) => setCreditForm((p) => ({ ...p, stripeDollars: e.target.value }))}
                        disabled={!sub?.stripe_customer_id}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || !sub?.stripe_customer_id}
                        onClick={handleApplyStripeCredit}
                      >
                        Apply Stripe $ credit
                      </Button>
                    </div>
                    {!sub?.stripe_customer_id && (
                      <p className="text-[11px] text-muted-foreground">
                        No Stripe customer ID yet (account hasn&apos;t started paid checkout). Use Bonus Minutes above.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-border/60 pt-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium">Pending Overage Ledger</div>
                        <div className="text-[11px] text-muted-foreground">
                          {pendingOverages.length > 0
                            ? `${pendingOverages.length} unbilled item(s) totaling ${fmtUsd(pendingOverageUsd)}`
                            : 'No unbilled overage charges pending.'}
                        </div>
                      </div>
                      {pendingOverages.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={handleWaiveOverages}
                        >
                          Waive pending overages
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Credit History */}
              {credits.length > 0 && (
                <div className="rounded-md border border-border/60 bg-background p-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    Credit &amp; Adjustment History ({credits.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-border text-muted-foreground">
                        <tr>
                          <th className="py-1.5 pr-3 font-medium">Date</th>
                          <th className="py-1.5 pr-3 font-medium">Type</th>
                          <th className="py-1.5 pr-3 font-medium">Grant</th>
                          <th className="py-1.5 pr-3 font-medium">Status / Expiry</th>
                          <th className="py-1.5 pr-3 font-medium">Reason &amp; By</th>
                          <th className="py-1.5 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {credits.map((g) => (
                          <tr key={g.id} className="border-b border-border/40 last:border-0">
                            <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                              {(g.created_at || '').slice(0, 10)}
                            </td>
                            <td className="py-1.5 pr-3">{g.grant_type}</td>
                            <td className="py-1.5 pr-3 font-medium tabular-nums">
                              {g.grant_type === 'bonus_minutes'
                                ? `+${g.bonus_meeting_minutes || 0}m meet${
                                    g.bonus_translation_minutes ? ` / +${g.bonus_translation_minutes}m trans` : ''
                                  }`
                                : fmtUsd((g.amount_cents || 0) / 100)}
                            </td>
                            <td className="py-1.5 pr-3">
                              {g.revoked_at ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  Revoked
                                </Badge>
                              ) : g.grant_type === 'bonus_minutes' ? (
                                g.is_active ? (
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    Active {g.expires_at ? `(until ${g.expires_at.slice(0, 10)})` : '(no expiry)'}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Expired {g.expires_at ? g.expires_at.slice(0, 10) : ''}
                                  </span>
                                )
                              ) : (
                                <span className="text-muted-foreground">{g.stripe_txn_id || 'Applied'}</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3">
                              <span>{g.reason}</span>
                              <span className="ml-1 text-muted-foreground">({g.created_by})</span>
                            </td>
                            <td className="py-1.5 text-right">
                              {g.grant_type === 'bonus_minutes' && g.is_active && !g.revoked_at && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[11px] text-destructive"
                                  disabled={busy}
                                  onClick={() => handleRevokeGrant(g.id)}
                                >
                                  Revoke
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Support CRM: Tags & Internal Notes */}
            <div className="space-y-4 rounded-lg border border-border/60 p-4 lg:col-span-2">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Account Tags */}
                <div className="space-y-2.5">
                  <h3 className="font-medium">CRM Account Tags</h3>
                  <p className="text-xs text-muted-foreground">
                    Segment accounts for VIP onboarding, pilots, churn follow-up, or partner tracking.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TAGS.map((tag) => {
                      const active = tagDraft.includes(tag);
                      return (
                        <Button
                          key={tag}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          className="h-7 text-xs"
                          onClick={() => toggleTag(tag)}
                        >
                          #{tag}
                        </Button>
                      );
                    })}
                    {tagDraft
                      .filter((t) => !PRESET_TAGS.includes(t))
                      .map((tag) => (
                        <Button
                          key={tag}
                          type="button"
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          onClick={() => toggleTag(tag)}
                        >
                          #{tag} ×
                        </Button>
                      ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Custom account tag"
                      placeholder="Custom tag (e.g. enterprise-q4)"
                      className="h-8 max-w-[210px] text-xs"
                      value={customTagInput}
                      onChange={(e) => setCustomTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomTag();
                        }
                      }}
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={addCustomTag}>
                      Add tag
                    </Button>
                    <Button type="button" size="sm" className="h-8 text-xs" disabled={busy} onClick={handleSaveTags}>
                      Save tags
                    </Button>
                  </div>
                </div>

                {/* Internal Support Notes */}
                <div className="space-y-2.5">
                  <h3 className="font-medium">Internal Support Notes ({notes.length})</h3>
                  <p className="text-xs text-muted-foreground">
                    Visible only to platform superadmins. Pin key context for support handoffs.
                  </p>
                  <textarea
                    aria-label="Internal support note"
                    className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                    placeholder="Add onboarding context, call summary, or billing promise…"
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={notePinned}
                        onChange={(e) => setNotePinned(e.target.checked)}
                      />
                      Pin note to top
                    </label>
                    <Button type="button" size="sm" className="h-8 text-xs" disabled={busy} onClick={handleAddNote}>
                      Save note
                    </Button>
                  </div>
                  {notes.length > 0 && (
                    <ul className="max-h-48 space-y-2 overflow-y-auto pt-1 text-xs">
                      {notes.map((n) => (
                        <li
                          key={n.id}
                          className={`rounded-md border p-2.5 ${
                            n.pinned ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/60 bg-muted/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {n.pinned ? <strong className="text-amber-700 dark:text-amber-400">📌 Pinned · </strong> : null}
                              {n.author_email} · {fmtDateTime(n.created_at)}
                            </span>
                            <span className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                disabled={busy}
                                onClick={() => handleTogglePinNote(n)}
                              >
                                {n.pinned ? 'Unpin' : 'Pin'}
                              </button>
                              <button
                                type="button"
                                className="text-destructive hover:underline"
                                disabled={busy}
                                onClick={() => handleDeleteNote(n.id)}
                              >
                                Delete
                              </button>
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-foreground">{n.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

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

            <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
              <h3 className="font-medium">Account lifecycle</h3>
              <p className="text-xs text-muted-foreground">
                Suspending blocks new meetings and sets billing status to <code>suspended</code>. Reactivating restores
                it to <code>active</code>.
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
                Permanent unlimited access for internal, friend, or partner accounts. For temporary customer support
                top-ups, prefer <strong>Bonus Minutes</strong> above.
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

            {sub?.stripe_subscription_id && sub?.is_comp !== 1 && (
              <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
                <h3 className="font-medium">Stripe subscription</h3>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Subscription ID: </span>
                    <code className="text-xs">{sub.stripe_subscription_id}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Customer ID: </span>
                    <code className="text-xs">{sub.stripe_customer_id || '—'}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    {sub.status || '—'}
                  </div>
                  {sub.current_period_end && (
                    <div>
                      <span className="text-muted-foreground">Period ends: </span>
                      {sub.current_period_end.slice(0, 10)}
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Overage auto-charge: </span>
                    {sub.overage_auto_charge_opt_in === 1 ? (
                      <span className="text-emerald-700 dark:text-emerald-400">
                        Opted in
                        {sub.overage_auto_charge_opt_in_at ? ` (${sub.overage_auto_charge_opt_in_at.slice(0, 10)})` : ''}
                      </span>
                    ) : (
                      <span>Not opted in</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cancel via Stripe API (requires audit reason above). Webhooks sync status back to Lalia.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => cancelStripeSubscription(false)}
                  >
                    Cancel at period end
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => cancelStripeSubscription(true)}
                  >
                    Cancel immediately
                  </Button>
                  {orgDetail?.stripeDashboardBase && sub.stripe_customer_id && (
                    <Button type="button" size="sm" variant="ghost" asChild>
                      <a
                        href={`${orgDetail.stripeDashboardBase}/customers/${sub.stripe_customer_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Stripe →
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-border/60 p-4">
              <h3 className="font-medium">Custom permanent limits</h3>
              <p className="text-xs text-muted-foreground">
                Override base monthly included minutes for enterprise contracts (leave blank for plan defaults).
              </p>
              <div className="space-y-2">
                <label className="block text-xs text-muted-foreground">
                  Meeting minutes
                  <Input
                    type="number"
                    min={0}
                    className="mt-1 h-9"
                    placeholder={
                      sub?.included_meeting_minutes != null ? String(sub.included_meeting_minutes) : 'plan default'
                    }
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
              <p className="text-xs text-muted-foreground">
                Sends a transactional account or service notice to the owner(s) of this organization.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  aria-label="Email notice purpose"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={emailForm.purpose}
                  onChange={(e) => setEmailForm((p) => ({ ...p, purpose: e.target.value }))}
                >
                  <option value="account_notice">Account notice (billing / quota / support)</option>
                  <option value="service_notice">Service notice (incident / maintenance)</option>
                </select>
                <Input
                  aria-label="Email subject"
                  placeholder="Subject"
                  className="sm:col-span-2"
                  value={emailForm.subject}
                  onChange={(e) => setEmailForm((p) => ({ ...p, subject: e.target.value }))}
                />
              </div>
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
