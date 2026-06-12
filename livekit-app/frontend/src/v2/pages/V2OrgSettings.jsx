import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Auth, v2Orgs, v2Billing, v2Usage } from '../../services/apiV2';
import { hasTeamWorkspace } from '../lib/planCapabilities';
import { isTeamWorkspace, workspaceLabel } from '../lib/workspaceDisplay';
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
  const [enablingTeam, setEnablingTeam] = useState(false);
  const [brandingAccent, setBrandingAccent] = useState(DEFAULT_BRAND_ACCENT);
  const [brandingWelcome, setBrandingWelcome] = useState('');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
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
          usageSummary: usage?.byType || [],
        });
        const b = o?.branding;
        if (b) {
          setBrandingAccent(b.accentColor || DEFAULT_BRAND_ACCENT);
          setBrandingWelcome(b.welcomeMessage || '');
          setBrandingLogoUrl(b.logoUrl || '');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingSnap, searchParams]);

  const canManage = ['owner', 'admin'].includes(role);
  const canRenameOrg = canManage;
  const teamWorkspace = hasTeamWorkspace(org?.entitlements);
  const teamAccount = isTeamWorkspace(org?.org || profile?.org);
  const navSections = useMemo(() => {
    const label = teamAccount ? 'Organization' : 'Account';
    return BASE_SECTIONS.map((s) => (s.id === 'profile' ? { ...s, label } : s)).filter(
      (s) => s.id !== 'members' || teamWorkspace
    );
  }, [teamWorkspace, teamAccount]);
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
                  <div className="space-y-3 border-t border-border/60 pt-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upgrade</div>
                    <div className="flex flex-wrap gap-2">
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
