import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth, v2Orgs, v2Billing, v2Usage } from '../../services/apiV2';
import { hasTeamWorkspace } from '../lib/planCapabilities';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

const SECTIONS = [
  { id: 'organization', label: 'Organization' },
  { id: 'members', label: 'Members' },
  { id: 'branding', label: 'Branding' },
  { id: 'billing', label: 'Billing' },
  { id: 'danger', label: 'Danger zone' },
];

export default function V2OrgSettings() {
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState(searchParams.get('section') || 'organization');
  const [role, setRole] = useState('');
  const [members, setMembers] = useState([]);
  const [org, setOrg] = useState(null);
  const [email, setEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [loading, setLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [savingOrgName, setSavingOrgName] = useState(false);
  const [billingSnap, setBillingSnap] = useState(null);
  const [plans, setPlans] = useState([]);
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  const startCheckout = async (planId) => {
    setCheckoutLoading(planId);
    try {
      const { url } = await v2Billing.checkout(planId);
      if (url) window.location.href = url;
    } catch (e) {
      toast.error(e.response?.data?.error || 'Checkout unavailable');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const openPortal = async () => {
    try {
      const { url } = await v2Billing.portal();
      if (url) window.location.href = url;
    } catch (e) {
      toast.error(e.response?.data?.error || 'Billing portal unavailable');
    }
  };

  const load = () => {
    Promise.all([
      v2Auth.me(),
      v2Orgs.listMembers(),
      v2Orgs.me().catch(() => null),
      v2Billing.subscription().catch(() => null),
      v2Billing.plans().catch(() => null),
      v2Usage.summary().catch(() => null),
    ])
      .then(([me, m, o, sub, plansRes, usage]) => {
        setRole(me.role || '');
        setMembers(m.members || []);
        setOrg(o);
        const n = o?.org?.name || '';
        setOrgNameDraft(n);
        setPlans(plansRes?.plans || []);
        setBillingSnap({
          subscription: sub?.subscription,
          plan: sub?.plan,
          stripeEnabled: sub?.stripeEnabled,
          usageSummary: usage?.byType || [],
        });
      })
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Plan-intent funnel: /v2/app/settings?checkout=starter|pro (set after signup
  // from a paid pricing CTA) — jump to billing and start Stripe checkout once
  // the billing snapshot is loaded.
  const checkoutIntentHandled = useRef(false);
  useEffect(() => {
    const intent = (searchParams.get('checkout') || '').toLowerCase();
    if (!intent || checkoutIntentHandled.current || !billingSnap) return;
    checkoutIntentHandled.current = true;
    setSection('billing');
    if (billingSnap.stripeEnabled) {
      startCheckout(intent);
    } else {
      toast(
        'Your account is ready on the free plan. Online billing is being set up — we\u2019ll email you to complete the upgrade.',
        { icon: 'ℹ️', duration: 6000 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingSnap, searchParams]);

  const canManage = ['owner', 'admin'].includes(role);
  const canRenameOrg = canManage;
  const teamWorkspace = hasTeamWorkspace(org?.entitlements);
  const navSections = useMemo(() => SECTIONS.filter((s) => s.id !== 'members' || teamWorkspace), [teamWorkspace]);
  const orgName = org?.org?.name || org?.organization?.name || org?.name || '—';

  const saveOrgName = async (e) => {
    e.preventDefault();
    if (!canRenameOrg) return;
    const trimmed = orgNameDraft.trim();
    if (trimmed.length < 1 || trimmed.length > 128) {
      toast.error('Name must be 1–128 characters');
      return;
    }
    setSavingOrgName(true);
    try {
      await v2Orgs.patchMe({ name: trimmed });
      toast.success('Organization name updated');
      const fresh = await v2Orgs.me();
      setOrg(fresh);
      setOrgNameDraft(fresh?.org?.name || trimmed);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update name');
    } finally {
      setSavingOrgName(false);
    }
  };

  const addMember = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await v2Orgs.addMember({ email: email.trim(), role: memberRole });
      toast.success('Member added');
      setEmail('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Add failed');
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await v2Orgs.removeMember(removeTarget);
      toast.success('Removed');
      setRemoveTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Remove failed');
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <Link to="/v2/app" className="text-sm font-medium text-primary hover:underline">
        ← Workspace
      </Link>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-border/60 pb-4 lg:w-52 lg:flex-col lg:border-b-0 lg:border-r lg:pr-6 lg:pb-0">
          {navSections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn(
                'rounded-md px-3 py-2 text-left text-sm transition-colors',
                section === s.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your role: <span className="text-foreground">{role}</span>
            </p>
          </div>

          {section === 'organization' && (
            <Card className="app-card border-border/60">
              <CardHeader>
                <CardTitle>Organization</CardTitle>
                <CardDescription>Workspace name. Owners and admins can change it; members cannot.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {!canRenameOrg && (
                  <div>
                    <span className="text-muted-foreground">Name</span>
                    <p className="font-medium text-foreground">{orgName}</p>
                  </div>
                )}
                {canRenameOrg && (
                  <form onSubmit={saveOrgName} className="space-y-3 max-w-md">
                    <div className="space-y-2">
                      <Label htmlFor="org-name">Workspace name</Label>
                      <Input
                        id="org-name"
                        value={orgNameDraft}
                        onChange={(e) => setOrgNameDraft(e.target.value)}
                        maxLength={128}
                        autoComplete="organization"
                      />
                    </div>
                    <Button type="submit" disabled={savingOrgName}>
                      {savingOrgName ? 'Saving…' : 'Save'}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {section === 'members' && teamWorkspace && (
            <Card className="app-card border-border/60">
              <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription>Invite colleagues to this organization. They can sign in and create meetings in the shared workspace.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!canManage && <p className="text-sm text-muted-foreground">Only owners and admins can manage members.</p>}
                {canManage && (
                  <form onSubmit={addMember} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="invite-email">Email</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="colleague@company.com"
                      />
                    </div>
                    <div className="space-y-2 sm:w-40">
                      <Label htmlFor="invite-role">Role</Label>
                      <Select value={memberRole} onValueChange={setMemberRole}>
                        <SelectTrigger id="invite-role">
                          <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          {role === 'owner' && <SelectItem value="admin">Admin</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit">Add</Button>
                  </form>
                )}
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-sm"
                    >
                      <div>
                        <div className="font-medium text-foreground">{m.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.display_name || '—'} · {m.role}
                        </div>
                      </div>
                      {canManage && m.role !== 'owner' && (
                        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRemoveTarget(m.id)}>
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {section === 'branding' && (
            <Card className="app-card border-border/60">
              <CardHeader>
                <CardTitle>Branding</CardTitle>
                <CardDescription>Logo and accent colors for guest join pages — coming soon.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">No options to configure yet.</p>
              </CardContent>
            </Card>
          )}

          {section === 'billing' && (
            <Card className="app-card border-border/60">
              <CardHeader>
                <CardTitle>Billing</CardTitle>
                <CardDescription>Plan, usage, and self-serve upgrade (Stripe test mode when enabled).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {billingSnap?.subscription?.is_comp === 1 && (
                  <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-3 text-foreground">
                    Unlimited access ({billingSnap.subscription.comp_label || 'comp'}) — usage caps waived.
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account status</div>
                    <div className="mt-1 font-medium text-foreground">{org?.org?.billing_status || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subscription</div>
                    <div className="mt-1 font-medium text-foreground">
                      {billingSnap?.subscription?.status || '—'}
                      {billingSnap?.plan?.name ? ` · ${billingSnap.plan.name}` : ''}
                    </div>
                  </div>
                </div>
                {billingSnap?.plan && (
                  <div className="rounded-lg border border-border/60 px-3 py-3 text-muted-foreground">
                    <div>Included participant-minutes: {billingSnap.plan.included_meeting_minutes ?? '—'}/mo</div>
                    <div>Included translation minutes: {billingSnap.plan.included_translation_minutes ?? '—'}/mo</div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Usage this month</div>
                  {!billingSnap?.usageSummary?.length ? (
                    <p className="text-muted-foreground">No usage recorded yet this month.</p>
                  ) : (
                    <ul className="space-y-1">
                      {billingSnap.usageSummary.map((row) => (
                        <li key={row.event_type} className="flex justify-between gap-2 border-b border-border/40 py-1 last:border-0">
                          <span className="text-foreground">{row.event_type}</span>
                          <span className="tabular-nums text-muted-foreground">{Number(row.total).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canManage && billingSnap?.subscription?.is_comp !== 1 && (
                  <div className="space-y-3 border-t border-border/60 pt-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upgrade</div>
                    <div className="flex flex-wrap gap-2">
                      {plans
                        .filter((p) => p.id !== 'free' && p.id !== billingSnap?.plan?.id)
                        .map((p) => (
                          <Button
                            key={p.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!billingSnap?.stripeEnabled || checkoutLoading === p.id}
                            onClick={() => startCheckout(p.id)}
                          >
                            {checkoutLoading === p.id ? 'Loading…' : `Upgrade to ${p.name}`}
                          </Button>
                        ))}
                      {billingSnap?.subscription?.stripe_customer_id && billingSnap?.stripeEnabled && (
                        <Button type="button" variant="ghost" size="sm" onClick={openPortal}>
                          Manage billing
                        </Button>
                      )}
                    </div>
                    {!billingSnap?.stripeEnabled && (
                      <p className="text-xs text-muted-foreground">
                        Stripe checkout is disabled on this server. Set STRIPE_ENABLED=true with test API keys to enable.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {section === 'danger' && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>Irreversible organization actions will live here.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">No destructive actions are exposed in this build.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>This revokes their access to this organization.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmRemove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
