import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Plus, Users, Video, UserPlus } from 'lucide-react';
import { v2Orgs, v2Billing, v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
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

  const copyLastGuestLink = useCallback(async () => {
    const m = meetings.find((x) => x.joinUrl);
    if (!m?.joinUrl) {
      toast.error('No meeting with a guest link yet');
      return;
    }
    try {
      await navigator.clipboard.writeText(m.joinUrl);
      toast.success('Copied guest link');
    } catch {
      toast.error('Could not copy');
    }
  }, [meetings]);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="gap-2">
          <Link to="/v2/app/meetings?create=1">
            <Plus className="h-4 w-4" />
            New meeting
          </Link>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={copyLastGuestLink}>
          Copy last guest link
        </Button>
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <Link to="/v2/app/settings">
            <UserPlus className="h-4 w-4" />
            Invite teammate
          </Link>
        </Button>
      </div>

      <Card className="app-card overflow-hidden border-border/60 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
        <CardHeader className="space-y-2 pb-2 sm:pb-4">
          <Badge variant="secondary" className="w-fit text-xs font-normal">
            Workspace
          </Badge>
          <CardTitle className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {orgData?.organization?.name || orgData?.org?.name || 'Your organization'}
          </CardTitle>
          <CardDescription className="max-w-xl text-base">
            Host translated meetings with screen share and live captions. Manage meetings and members from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 pb-8">
          <Button variant="outline" size="lg" asChild className="gap-2">
            <Link to="/v2/app/meetings">
              <Video className="h-4 w-4" />
              All meetings
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild className="gap-2">
            <Link to="/v2/app/settings">
              <UserPlus className="h-4 w-4" />
              Invite teammate
            </Link>
          </Button>
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
            <CardContent className="text-xs text-muted-foreground">Organization</CardContent>
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
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
