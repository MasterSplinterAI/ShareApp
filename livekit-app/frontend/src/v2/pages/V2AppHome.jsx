import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Plus, Users, Video, UserPlus } from 'lucide-react';
import { v2Orgs, v2Billing, v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
import { hasTeamWorkspace } from '../lib/planCapabilities';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

export default function V2AppHome() {
  const [orgData, setOrgData] = useState(null);
  const [sub, setSub] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [membersCount, setMembersCount] = useState(0);

  useEffect(() => {
    Promise.all([v2Orgs.me(), v2Billing.subscription(), v2Meetings.list(), v2Orgs.listMembers()])
      .then(([o, s, mList, mem]) => {
        setOrgData(o);
        setSub(s);
        setMeetings(mList.meetings || []);
        setMembersCount((mem.members || []).length);
      })
      .catch((e) => {
        toast.error(e.response?.data?.error || 'Could not load workspace');
      });
  }, []);

  const recentMeetings = useMemo(() => meetings.slice(0, 5), [meetings]);
  const activeLive = useMemo(() => meetings.filter((m) => m.status === 'live').length, [meetings]);
  const teamWorkspace = hasTeamWorkspace(orgData?.entitlements, sub?.plan);

  const copyLastGuestLink = useCallback(async () => {
    const m = meetings.find((x) => x.joinUrl);
    if (!m?.joinUrl) {
      toast.error('No meeting with a guest link yet. Create a meeting first, then use this from the home page.');
      return;
    }
    try {
      await navigator.clipboard.writeText(m.joinUrl);
      toast.success(`Copied guest link (${m.title || 'Meeting'})`);
    } catch {
      toast.error('Could not copy');
    }
  }, [meetings]);

  return (
    <div className="space-y-10">
      <Card className="app-card overflow-hidden border-border/60 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
        <CardHeader className="space-y-2 pb-2 text-center sm:pb-4">
          <Badge variant="secondary" className="mx-auto w-fit text-xs font-normal">
            Workspace
          </Badge>
          <CardTitle className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {orgData?.organization?.name || orgData?.org?.name || 'Your organization'}
          </CardTitle>
          <CardDescription className="mx-auto max-w-xl text-base">
            Host translated meetings with screen share and live captions.
            {teamWorkspace
              ? ' Manage meetings and workspace members from here.'
              : ' Create rooms, share guest links, and manage your meetings from here.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center pb-10 pt-2">
          <Button asChild size="lg" className="min-w-[min(100%,14rem)] gap-2 px-10 text-base">
            <Link to="/v2/app/meetings?create=1">
              <Plus className="h-5 w-5" />
              New meeting
            </Link>
          </Button>
          <p className="mt-3 max-w-md text-center text-sm text-muted-foreground">
            Start here. You&apos;ll get a guest link on the next screen to share with participants.
          </p>
          <Button variant="outline" size="lg" asChild className="mt-6 gap-2">
            <Link to="/v2/app/meetings">
              <Video className="h-4 w-4" />
              All meetings
            </Link>
          </Button>

          <div
            className={`mt-10 grid w-full max-w-2xl gap-4 border-t border-border/60 pt-10 ${teamWorkspace ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}
          >
            <div className="flex flex-col rounded-lg border border-border/60 bg-muted/20 p-4 text-center">
              <p className="text-sm font-medium text-foreground">Copy a guest link</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Copies the join URL from the <span className="font-medium text-foreground">most recent</span> meeting that has one—handy if you just created a room and want to paste it into chat or email.
              </p>
              <Button type="button" variant="secondary" size="sm" className="mt-4 self-center" onClick={copyLastGuestLink}>
                Copy latest guest link
              </Button>
            </div>
            {teamWorkspace ? (
              <div className="flex flex-col rounded-lg border border-border/60 bg-muted/20 p-4 text-center">
                <p className="text-sm font-medium text-foreground">Add workspace members</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Opens <span className="font-medium text-foreground">Settings → Members</span> so you can invite colleagues by email. They get their own login to this organization—not a meeting guest link.
                </p>
                <Button variant="secondary" size="sm" className="mt-4 gap-2 self-center" asChild>
                  <Link to="/v2/app/settings">
                    <UserPlus className="h-4 w-4" />
                    Open member invites
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col rounded-lg border border-dashed border-border/80 bg-muted/10 p-4 text-center">
                <p className="text-sm font-medium text-foreground">Team workspace</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Your plan is for individuals: create meetings and share guest links. Inviting colleagues with their own org login (so they can host rooms in the same workspace) is available on team plans such as Pro or Business.
                </p>
                <Button variant="outline" size="sm" className="mt-4 self-center" asChild>
                  <Link to="/v2/app/settings">View settings &amp; billing</Link>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">At a glance</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="app-card border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Meetings</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">{meetings.length}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">In this workspace</CardContent>
          </Card>
          <Card className="app-card border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>Live now</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums text-emerald-600">{activeLive}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Status &quot;live&quot;</CardContent>
          </Card>
          <Card className="app-card border-border/60 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <Users className="h-3 w-3" /> Members
              </CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">{membersCount}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {teamWorkspace ? 'People in this org' : 'Your account (team plans add seats)'}
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent meetings</h2>
          <Link to="/v2/app/meetings" className="text-xs font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {recentMeetings.length === 0 ? (
          <Card className="border-dashed border-border/80 bg-muted/10">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <p className="text-sm text-muted-foreground">No meetings yet.</p>
              <Button asChild className="mt-4 gap-2">
                <Link to="/v2/app/meetings?create=1">
                  <Plus className="h-4 w-4" />
                  Create your first meeting
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {recentMeetings.map((m) => {
              const ui = getMeetingUiState(m);
              return (
                <li key={m.id}>
                  <Link to={`/v2/app/meetings/${m.id}`}>
                    <Card className="app-card border-border/60 transition-colors hover:border-primary/40 hover:shadow-md">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{m.title || m.livekit_room_name}</span>
                          {m.scheduled_start && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {new Date(m.scheduled_start).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <Badge variant={toneToBadgeVariant(ui.tone)} className="shrink-0 text-xs uppercase tracking-wide">
                          {ui.label}
                        </Badge>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card className="border-border/80 bg-muted/10">
        <CardHeader>
          <CardTitle className="text-lg">Subscription</CardTitle>
          <CardDescription>
            Plan: <span className="text-foreground">{sub?.plan?.name || '—'}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            Status: <span className="text-foreground">{sub?.subscription?.status || '—'}</span>
            {!teamWorkspace && (
              <span className="mt-2 block text-xs leading-relaxed">
                Individual: share guest links for your meetings; upgrade for a shared workspace and email invites for colleagues.
              </span>
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
