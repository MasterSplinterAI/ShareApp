import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth, v2Orgs, v2Billing, v2Usage } from '../../services/apiV2';
import { hasTeamWorkspace } from '../lib/planCapabilities';
import { isTeamWorkspace, workspaceLabel } from '../lib/workspaceDisplay';
import { getRecommendedUpgrade, formatPlanPrice } from '../lib/upgradeOffers';
import { cn } from '../../lib/utils';
import { Loader2, ImagePlus, Trash2 } from 'lucide-react';
import { DEFAULT_BRAND_ACCENT, brandingStyleVars, brandButtonClassName } from '../../lib/meetingBranding';
import MeetingBrandHeader from '../../components/MeetingBrandHeader';
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

const BASE_SECTIONS = [
  { id: 'profile', label: 'Account' },
  { id: 'members', label: 'Members' },
  { id: 'branding', label: 'Branding' },
  { id: 'billing', label: 'Billing' },
  { id: 'danger', label: 'Danger zone' },
];

/** Turn raw usage event keys (e.g. "meeting_minutes") into readable labels. */
function humanizeUsageLabel(eventType) {
  if (!eventType) return '—';
  const spaced = String(eventType).replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function V2OrgSettings() {
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState(searchParams.get('section') || 'profile');
  const [role, setRole] = useState('');
  const [members, setMembers] = useState([]);
  const [org, setOrg] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [memberRole, setMemberRole] = useState('member');
  const [loading, setLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [savingOrgName, setSavingOrgName] = useState(false);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [marketingEmailPref, setMarketingEmailPref] = useState(false);
  const [savingCommPrefs, setSavingCommPrefs] = useState(false);
  const [enablingTeam, setEnablingTeam] = useState(false);
  const [brandingAccent, setBrandingAccent] = useState(DEFAULT_BRAND_ACCENT);
  const [brandingWelcome, setBrandingWelcome] = useState('');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [billingSnap, setBillingSnap] = useState(null);
  const [plans, setPlans] = useState([]);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [portalLoading, setPortalLoading] = useState(null);
  const [overageAutoChargeOptIn, setOverageAutoChargeOptIn] = useState(false);
  const [savingOverageAutoCharge, setSavingOverageAutoCharge] = useState(false);

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

  const openPortal = async (flow) => {
    setPortalLoading(flow || 'manage');
    try {
      const body = flow === 'cancel' ? { flow: 'cancel' } : {};
      const { url } = await v2Billing.portal(body);
      if (url) window.location.href = url;
    } catch (e) {
      toast.error(e.response?.data?.error || 'Billing portal unavailable');
    } finally {
      setPortalLoading(null);
    }
  };

  const saveOverageAutoCharge = async (nextOptIn) => {
    setSavingOverageAutoCharge(true);
    try {
      const { overageAutoCharge } = await v2Billing.updateOverageAutoCharge({ optIn: nextOptIn });
      setOverageAutoChargeOptIn(Boolean(overageAutoCharge?.orgOptIn));
      setBillingSnap((prev) => (prev ? { ...prev, overageAutoCharge } : prev));
      toast.success(nextOptIn ? 'Overage auto-charge enabled' : 'Overage auto-charge disabled');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update overage billing preference');
      setOverageAutoChargeOptIn(Boolean(billingSnap?.overageAutoCharge?.orgOptIn));
    } finally {
      setSavingOverageAutoCharge(false);
    }
  };

  const load = (opts = {}) => {
    const reconcileBilling = opts.reconcileBilling || searchParams.get('billing') === 'success';
    Promise.all([
      v2Auth.me(),
      v2Orgs.listMembers(),
      v2Orgs.me().catch(() => null),
      v2Billing.subscription({ reconcile: reconcileBilling }).catch(() => null),
      v2Billing.plans().catch(() => null),
      v2Usage.summary().catch(() => null),
      v2Auth.communicationPrefs().catch(() => null),
    ])
      .then(([me, m, o, sub, plansRes, usage, commPrefs]) => {
        setRole(me.role || '');
        setProfile(me);
        setMembers(m.members || []);
        setOrg(o);
        const n = o?.org?.name || '';
        setOrgNameDraft(n);
        setDisplayNameDraft(me?.user?.display_name || '');
        setTeamNameDraft('');
        setPlans(plansRes?.plans || []);
        setBillingSnap({
          subscription: sub?.subscription,
          plan: sub?.plan,
          stripeEnabled: sub?.stripeEnabled,
          overageAutoCharge: sub?.overageAutoCharge,
          usageSummary: usage?.byType || [],
        });
        setOverageAutoChargeOptIn(Boolean(sub?.overageAutoCharge?.orgOptIn));
        const b = o?.branding;
        if (b) {
          setBrandingAccent(b.accentColor || DEFAULT_BRAND_ACCENT);
          setBrandingWelcome(b.welcomeMessage || '');
          setBrandingLogoUrl(b.logoUrl || '');
        }
        if (commPrefs?.prefs) {
          setMarketingEmailPref(Boolean(commPrefs.prefs.marketingEmail));
        }
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
  }, [billingSnap, searchParams]);

  const canManage = ['owner', 'admin'].includes(role);
  const canRenameOrg = canManage;
  const teamWorkspace = hasTeamWorkspace(org?.entitlements, billingSnap?.plan);
  const teamAccount = isTeamWorkspace(org?.org || profile?.org);
  const upgradeOffer = useMemo(
    () =>
      getRecommendedUpgrade({
        subscription: billingSnap
          ? { plan: billingSnap.plan, subscription: billingSnap.subscription, stripeEnabled: billingSnap.stripeEnabled }
          : null,
        plans,
        usage: org?.usageThisMonth,
        role,
      }),
    [billingSnap, plans, role, org?.usageThisMonth],
  );
  const navSections = useMemo(() => {
    const label = teamAccount ? 'Organization' : 'Account';
    return BASE_SECTIONS.map((s) => {
      if (s.id === 'profile') return { ...s, label };
      if (s.id === 'billing' && upgradeOffer?.show) return { ...s, label: 'Billing · Upgrade' };
      return s;
    }).filter((s) => s.id !== 'members' || teamWorkspace);
  }, [teamWorkspace, teamAccount, upgradeOffer?.show]);
  const orgName = org?.org?.name || org?.organization?.name || org?.name || '—';
  const userEmail = profile?.user?.email || '—';

  const saveDisplayName = async (e) => {
    e.preventDefault();
    const trimmed = displayNameDraft.trim();
    if (trimmed.length < 1 || trimmed.length > 128) {
      toast.error('Name must be 1–128 characters');
      return;
    }
    setSavingDisplayName(true);
    try {
      const fresh = await v2Auth.patchMe({ displayName: trimmed });
      setProfile(fresh);
      setDisplayNameDraft(fresh?.user?.display_name || trimmed);
      if (!teamAccount) {
        const o = await v2Orgs.me();
        setOrg(o);
      }
      toast.success('Name updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update name');
    } finally {
      setSavingDisplayName(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    setSavingPassword(true);
    try {
      await v2Auth.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not change password');
    } finally {
      setSavingPassword(false);
    }
  };

  const saveCommPrefs = async (e) => {
    e.preventDefault();
    setSavingCommPrefs(true);
    try {
      const { prefs } = await v2Auth.updateCommunicationPrefs({ marketingEmail: marketingEmailPref });
      setMarketingEmailPref(Boolean(prefs?.marketingEmail));
      toast.success('Communication preferences saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save preferences');
    } finally {
      setSavingCommPrefs(false);
    }
  };

  const enableTeamWorkspace = async (e) => {
    e.preventDefault();
    if (!canRenameOrg) return;
    const trimmed = teamNameDraft.trim();
    if (trimmed.length < 1 || trimmed.length > 128) {
      toast.error('Team name must be 1–128 characters');
      return;
    }
    setEnablingTeam(true);
    try {
      await v2Orgs.patchMe({ name: trimmed, makeTeam: true });
      toast.success('Company workspace enabled');
      const fresh = await v2Orgs.me();
      setOrg(fresh);
      setOrgNameDraft(fresh?.org?.name || trimmed);
      setTeamNameDraft('');
      const meFresh = await v2Auth.me();
      setProfile(meFresh);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not enable team workspace');
    } finally {
      setEnablingTeam(false);
    }
  };

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
      toast.success('Team name updated');
      const fresh = await v2Orgs.me();
      setOrg(fresh);
      setOrgNameDraft(fresh?.org?.name || trimmed);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update name');
    } finally {
      setSavingOrgName(false);
    }
  };

  const saveBranding = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setSavingBranding(true);
    try {
      const res = await v2Orgs.patchBranding({
        accentColor: brandingAccent,
        welcomeMessage: brandingWelcome,
      });
      if (res?.branding) {
        setBrandingAccent(res.branding.accentColor || brandingAccent);
        setBrandingWelcome(res.branding.welcomeMessage || '');
        setBrandingLogoUrl(res.branding.logoUrl || brandingLogoUrl);
      }
      toast.success('Branding saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save branding');
    } finally {
      setSavingBranding(false);
    }
  };

  const onLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canManage) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be 2 MB or smaller');
      return;
    }
    setUploadingLogo(true);
    try {
      const res = await v2Orgs.uploadBrandingLogo(file);
      setBrandingLogoUrl(res?.branding?.logoUrl || '');
      toast.success('Logo uploaded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    if (!canManage) return;
    setUploadingLogo(true);
    try {
      await v2Orgs.deleteBrandingLogo();
      setBrandingLogoUrl('');
      toast.success('Logo removed');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not remove logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const previewBranding = {
    accentColor: brandingAccent,
    logoUrl: brandingLogoUrl || null,
    welcomeMessage: brandingWelcome,
    hostName: workspaceLabel({ org: org?.org || profile?.org, user: profile?.user }),
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
    return (
      <div className="space-y-6">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <div className="hidden shrink-0 space-y-2 lg:block lg:w-52">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 w-full animate-pulse rounded-md bg-muted/70" />
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="h-7 w-40 animate-pulse rounded bg-muted" />
            <div className="app-card h-48 animate-pulse border-border/50 bg-muted/40" />
          </div>
        </div>
      </div>
    );
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                section === s.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your role: <span className="text-foreground">{role}</span>
            </p>
          </div>

          {section === 'profile' && (
            <>
              <Card className="app-card border-border/60">
                <CardHeader>
                  <CardTitle>{teamAccount ? 'Organization' : 'Your account'}</CardTitle>
                  <CardDescription>
                    {teamAccount
                      ? 'Workspace name shown to your team. Owners and admins can change it.'
                      : 'Personal account — your name is shown in meetings and across the app. No company name required.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {!teamAccount && (
                    <form onSubmit={saveDisplayName} className="max-w-md space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="display-name">Your name</Label>
                        <Input
                          id="display-name"
                          value={displayNameDraft}
                          onChange={(e) => setDisplayNameDraft(e.target.value)}
                          maxLength={128}
                          autoComplete="name"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground">Email</span>
                        <p className="font-medium text-foreground">{userEmail}</p>
                      </div>
                      <Button type="submit" disabled={savingDisplayName}>
                        {savingDisplayName ? 'Saving…' : 'Save'}
                      </Button>
                    </form>
                  )}
                  {teamAccount && !canRenameOrg && (
                    <div>
                      <span className="text-muted-foreground">Workspace name</span>
                      <p className="font-medium text-foreground">{orgName}</p>
                    </div>
                  )}
                  {teamAccount && canRenameOrg && (
                    <form onSubmit={saveOrgName} className="max-w-md space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="org-name">Team or company name</Label>
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
              <Card className="app-card border-border/60">
                <CardHeader>
                  <CardTitle>Password</CardTitle>
                  <CardDescription>Change the password for {userEmail}.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={savePassword} className="max-w-md space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="current-password">Current password</Label>
                      <Input
                        id="current-password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-password">New password (min 8 characters)</Label>
                      <Input
                        id="new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Confirm new password</Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </div>
                    <Button type="submit" disabled={savingPassword}>
                      {savingPassword ? 'Updating…' : 'Update password'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="app-card border-border/60">
                <CardHeader>
                  <CardTitle>Communication preferences</CardTitle>
                  <CardDescription>
                    Choose how we may contact you about Parley. Transactional emails (password resets, billing,
                    support replies) are always sent when needed.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveCommPrefs} className="max-w-md space-y-4">
                    <div className="flex items-start gap-2">
                      <input
                        id="pref-marketing-email"
                        type="checkbox"
                        checked={marketingEmailPref}
                        onChange={(e) => setMarketingEmailPref(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                      />
                      <Label
                        htmlFor="pref-marketing-email"
                        className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground"
                      >
                        Email me product updates, tips, and announcements
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Text message and phone preferences are coming soon.
                    </p>
                    <Button type="submit" disabled={savingCommPrefs}>
                      {savingCommPrefs ? 'Saving…' : 'Save preferences'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
              {!teamAccount && canRenameOrg && (
                <Card className="app-card border-border/60">
                  <CardHeader>
                    <CardTitle>Company workspace</CardTitle>
                    <CardDescription>
                      {teamWorkspace
                        ? 'Switch from a personal account to a company workspace so your organization name appears across meetings and settings.'
                        : 'On an individual or Starter plan you can host meetings and share guest links. Upgrade to Pro for a business workspace where you can invite colleagues with their own logins.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!teamWorkspace && (
                      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                        <p>
                          You can upgrade anytime from Billing—even if you&apos;re already on a paid personal plan. Pro
                          unlocks member invites and shared workspace features.
                        </p>
                        <Button type="button" variant="link" className="mt-1 h-auto p-0" onClick={() => setSection('billing')}>
                          View plans in Billing →
                        </Button>
                      </div>
                    )}
                    <form onSubmit={enableTeamWorkspace} className="max-w-md space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="team-name">Company name</Label>
                        <Input
                          id="team-name"
                          value={teamNameDraft}
                          onChange={(e) => setTeamNameDraft(e.target.value)}
                          placeholder="Acme Inc"
                          maxLength={128}
                          autoComplete="organization"
                        />
                      </div>
                      <Button type="submit" variant="outline" disabled={enablingTeam || !teamNameDraft.trim()}>
                        {enablingTeam ? 'Switching…' : 'Switch to company workspace'}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )}
            </>
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
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{m.email}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.display_name || '—'} · {m.role}
                        </div>
                      </div>
                      {canManage && m.role !== 'owner' && (
                        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive" onClick={() => setRemoveTarget(m.id)}>
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
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="app-card border-border/60">
                <CardHeader>
                  <CardTitle>Guest join branding</CardTitle>
                  <CardDescription>
                    Logo, accent color, and welcome message appear on your guest join and prejoin pages. Hosts see the
                    same styling when joining from the dashboard.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!canManage && (
                    <p className="text-sm text-muted-foreground">Only owners and admins can edit branding.</p>
                  )}
                  {canManage && (
                    <form onSubmit={saveBranding} className="space-y-5">
                      <div className="space-y-2">
                        <Label>Logo</Label>
                        <div className="flex flex-wrap items-center gap-3">
                          {brandingLogoUrl ? (
                            <img
                              src={brandingLogoUrl}
                              alt=""
                              className="h-12 max-w-[140px] rounded border border-border/60 bg-muted/30 object-contain p-1"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
                              <ImagePlus className="h-5 w-5" />
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={uploadingLogo} asChild>
                              <label className="cursor-pointer">
                                {uploadingLogo ? 'Uploading…' : 'Upload logo'}
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp,image/gif"
                                  className="sr-only"
                                  onChange={onLogoPick}
                                />
                              </label>
                            </Button>
                            {brandingLogoUrl && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={uploadingLogo}
                                onClick={removeLogo}
                              >
                                <Trash2 className="mr-1 h-4 w-4" />
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, or GIF · max 2 MB</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="brand-accent">Accent color</Label>
                        <div className="flex max-w-xs items-center gap-2">
                          <input
                            id="brand-accent"
                            type="color"
                            value={brandingAccent}
                            onChange={(e) => setBrandingAccent(e.target.value)}
                            className="h-10 w-14 cursor-pointer rounded border border-input bg-background p-1"
                            aria-label="Accent color"
                          />
                          <Input
                            value={brandingAccent}
                            onChange={(e) => setBrandingAccent(e.target.value)}
                            pattern="^#[0-9A-Fa-f]{6}$"
                            maxLength={7}
                            className="font-mono text-sm"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="brand-welcome">Welcome message</Label>
                        <Input
                          id="brand-welcome"
                          value={brandingWelcome}
                          onChange={(e) => setBrandingWelcome(e.target.value)}
                          maxLength={200}
                          placeholder="Welcome to our weekly sync"
                        />
                        <p className="text-xs text-muted-foreground">Optional · shown under your name on the join page</p>
                      </div>
                      <Button type="submit" disabled={savingBranding}>
                        {savingBranding ? 'Saving…' : 'Save branding'}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
              <Card className="app-card border-border/60">
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                  <CardDescription>How guests will see your join lobby</CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className="rounded-xl border border-border/60 bg-muted/30 p-6"
                    style={brandingStyleVars(previewBranding)}
                  >
                    <MeetingBrandHeader branding={previewBranding} meetingTitle="Weekly standup" />
                    <h3 className="text-center text-base font-semibold">Ready to join?</h3>
                    <p className="mt-1 text-center text-xs text-muted-foreground">v2-example-room</p>
                    <div className="mt-4 space-y-2">
                      <div className="h-9 rounded-md border border-border/60 bg-background" />
                      <button
                        type="button"
                        tabIndex={-1}
                        className={brandButtonClassName('h-10 w-full rounded-md text-sm font-medium')}
                      >
                        Join meeting
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {section === 'billing' && (
            <Card className="app-card border-border/60">
              <CardHeader>
                <CardTitle>Billing</CardTitle>
                <CardDescription>
                  Plan, usage, and self-serve upgrade. Individual and Starter are for solo use; Pro is the business plan
                  with team invites.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {!teamWorkspace && canManage && billingSnap?.subscription?.is_comp !== 1 && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 text-foreground">
                    <p className="font-medium">Need to invite colleagues?</p>
                    <p className="mt-1 text-muted-foreground">
                      Upgrade to Pro for a business workspace—member invites, shared settings, and higher volume. Works
                      whether you started as an individual or company, and whether you&apos;re on free or Starter today.
                    </p>
                  </div>
                )}
                {billingSnap?.subscription?.is_comp === 1 && (
                  <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-3 text-foreground">
                    Unlimited access ({billingSnap.subscription.comp_label || 'comp'}) — usage caps waived.
                  </div>
                )}
                {canManage && billingSnap?.subscription?.is_comp !== 1 && plans.filter((p) => p.id !== 'free').length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {plans
                      .filter((p) => p.id !== 'free')
                      .map((p) => {
                        const isCurrent = p.id === billingSnap?.plan?.id;
                        const isRecommended = p.id === upgradeOffer?.primaryPlan?.id && !isCurrent;
                        return (
                          <div
                            key={p.id}
                            className={cn(
                              'relative flex flex-col rounded-xl border border-border/60 p-4',
                              isCurrent && 'border-primary/40 bg-primary/5',
                              isRecommended && 'border-primary ring-1 ring-primary/25',
                            )}
                          >
                            {isRecommended && (
                              <span className="absolute -top-2.5 left-3 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                                Recommended
                              </span>
                            )}
                            <div className="font-semibold text-foreground">{p.name}</div>
                            <div className="mt-1 text-xl font-bold tracking-tight">{formatPlanPrice(p.monthly_price_cents)}</div>
                            <ul className="mt-3 flex-1 space-y-1.5 text-xs text-muted-foreground">
                              <li>{Number(p.included_meeting_minutes).toLocaleString()} participant-minutes/mo</li>
                              <li>{Number(p.included_translation_minutes).toLocaleString()} translation minutes/mo</li>
                              {p.teamWorkspace ? <li className="text-foreground/80">Team workspace + member invites</li> : null}
                            </ul>
                            <Button
                              type="button"
                              className="mt-4 w-full"
                              variant={isRecommended ? 'default' : 'outline'}
                              disabled={isCurrent || !billingSnap?.stripeEnabled || checkoutLoading === p.id}
                              onClick={() => startCheckout(p.id)}
                            >
                              {isCurrent
                                ? 'Current plan'
                                : checkoutLoading === p.id
                                  ? 'Loading…'
                                  : `Upgrade to ${p.name}`}
                            </Button>
                          </div>
                        );
                      })}
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
                          <span className="min-w-0 truncate text-foreground">{humanizeUsageLabel(row.event_type)}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{Number(row.total).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canManage && billingSnap?.subscription?.is_comp !== 1 && (
                  <div className="space-y-4 border-t border-border/60 pt-4">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upgrade</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {plans
                          .filter((p) => p.id !== 'free' && p.id !== billingSnap?.plan?.id)
                          .map((p) => (
                            <Button
                              key={p.id}
                              type="button"
                              variant={p.teamWorkspace ? 'default' : 'outline'}
                              size="sm"
                              disabled={!billingSnap?.stripeEnabled || checkoutLoading === p.id}
                              onClick={() => startCheckout(p.id)}
                            >
                              {checkoutLoading === p.id
                                ? 'Loading…'
                                : `Upgrade to ${p.name}${p.teamWorkspace ? ' (business)' : ''}`}
                            </Button>
                          ))}
                      </div>
                      {!billingSnap?.stripeEnabled && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Payments are disabled. A platform admin can enable Stripe under Admin → Billing & Stripe.
                        </p>
                      )}
                    </div>

                    {billingSnap?.subscription?.stripe_customer_id && billingSnap?.stripeEnabled && (
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Subscription management
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Update your payment method, view invoices, or cancel your subscription. Cancellations are
                            processed securely through Stripe.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={portalLoading === 'manage'}
                            onClick={() => openPortal()}
                          >
                            {portalLoading === 'manage' ? 'Loading…' : 'Manage billing & invoices'}
                          </Button>
                          {billingSnap?.subscription?.stripe_subscription_id &&
                            billingSnap?.plan?.id !== 'free' &&
                            !['canceled', 'cancelled'].includes(
                              String(billingSnap?.subscription?.status || '').toLowerCase()
                            ) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={portalLoading === 'cancel'}
                                onClick={() => openPortal('cancel')}
                              >
                                {portalLoading === 'cancel' ? 'Loading…' : 'Cancel subscription'}
                              </Button>
                            )}
                        </div>
                      </div>
                    )}

                    {billingSnap?.overageAutoCharge?.platformEnabled &&
                      billingSnap?.stripeEnabled &&
                      billingSnap?.subscription?.is_comp !== 1 && (
                        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
                          <div>
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Usage overages
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              If you exceed included minutes on your plan, overages may be billed at the rates shown on
                              your plan. Opt in only if you want us to charge your saved payment method automatically
                              when a billing period closes.
                            </p>
                          </div>
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              id="overage-auto-charge"
                              type="checkbox"
                              checked={overageAutoChargeOptIn}
                              disabled={savingOverageAutoCharge}
                              onChange={(e) => {
                                setOverageAutoChargeOptIn(e.target.checked);
                                saveOverageAutoCharge(e.target.checked);
                              }}
                              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary disabled:opacity-50"
                            />
                            <span className="cursor-pointer text-muted-foreground">
                              <span className="font-medium text-foreground">
                                Automatically charge overages to my payment method
                              </span>
                              <span className="mt-1 block text-xs">
                                You can turn this off anytime. Without opt-in, overages are tracked but not auto-charged.
                                {billingSnap?.overageAutoCharge?.optedInAt && overageAutoChargeOptIn
                                  ? ` Opted in ${new Date(billingSnap.overageAutoCharge.optedInAt).toLocaleString()}.`
                                  : ''}
                              </span>
                            </span>
                          </label>
                        </div>
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
