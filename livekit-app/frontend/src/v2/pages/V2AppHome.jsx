import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { format, isToday, isTomorrow, isThisYear } from 'date-fns';
import { ArrowRight, CalendarClock, Clock, Plus, UserPlus, Video } from 'lucide-react';
import { v2Auth, v2Orgs, v2Billing, v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
import { hasTeamWorkspace } from '../lib/planCapabilities';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function friendlyTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return `Today ${format(d, 'h:mm a')}`;
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'h:mm a')}`;
  if (isThisYear(d)) return format(d, 'EEE MMM d, h:mm a');
  return format(d, 'MMM d, yyyy');
}

export default function V2AppHome() {
  const [me, setMe] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [sub, setSub] = useState(null);
  const [meetings, setMeetings] = useState([]);

  useEffect(() => {
    Promise.all([v2Auth.me(), v2Orgs.me(), v2Billing.subscription(), v2Meetings.list()])
      .then(([meRes, o, s, mList]) => {
        setMe(meRes);
        setOrgData(o);
        setSub(s);
        setMeetings(mList.meetings || []);
      })
      .catch((e) => {
        toast.error(e.response?.data?.error || 'Could not load workspace');
      });
  }, []);

  const displayName = me?.user?.display_name || me?.user?.displayName || me?.user?.email?.split('@')[0] || 'there';
  const firstName = displayName.split(' ')[0];
  const workspaceName = me?.org?.name || orgData?.org?.name || 'Workspace';
  const teamWorkspace = hasTeamWorkspace(orgData?.entitlements, sub?.plan);

  const nextUpcoming = useMemo(() => {
    const now = Date.now();
    return meetings
      .filter((m) => {
        const t = m.scheduled_start ? new Date(m.scheduled_start).getTime() : NaN;
        return !Number.isNaN(t) && t > now;
      })
      .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))[0] || null;
  }, [meetings]);

  const recentMeetings = useMemo(
    () => meetings.filter((m) => m.id !== nextUpcoming?.id).slice(0, 3),
    [meetings, nextUpcoming],
  );

  const usageMinutes = Math.round(Number(orgData?.usageThisMonth?.meetingMinutes) || 0);
  const planName = sub?.plan?.name;

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <section className="space-y-5 pt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {greetingForNow()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspaceName} · Host translated meetings with live captions and guest links.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild className="gap-2">
            <Link to="/v2/app/meetings?create=1">
              <Plus className="h-4 w-4" />
              New meeting
            </Link>
          </Button>
          <Button variant="outline" asChild className="gap-2">
            <Link to="/v2/app/meetings?create=1">
              <CalendarClock className="h-4 w-4" />
              Schedule
            </Link>
          </Button>
          <Button variant="ghost" asChild className="gap-2">
            <Link to="/v2/app/meetings">
              <Video className="h-4 w-4" />
              All meetings
            </Link>
          </Button>
          {teamWorkspace && (
            <Button variant="ghost" asChild className="gap-2">
              <Link to="/v2/app/settings">
                <UserPlus className="h-4 w-4" />
                Invite teammate
              </Link>
            </Button>
          )}
        </div>
      </section>

      {nextUpcoming && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</h2>
          <Link to={`/v2/app/meetings/${nextUpcoming.id}`}>
            <Card className="app-card app-card-hover border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.04] hover:border-primary/50">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <CalendarClock className="h-5 w-5 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {nextUpcoming.title || nextUpcoming.livekit_room_name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {friendlyTime(nextUpcoming.scheduled_start)}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent meetings</h2>
          <Link to="/v2/app/meetings" className="text-xs font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {recentMeetings.length === 0 ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Video className="h-5 w-5 text-primary" />
              </span>
              <p className="mt-4 text-sm font-medium text-foreground">No meetings yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Create one and you&apos;ll get a guest link to share with participants.
              </p>
              <Button asChild className="mt-5 gap-2">
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
                    <Card className="app-card app-card-hover border-border/70 hover:border-primary/40">
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{m.title || m.livekit_room_name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {friendlyTime(m.scheduled_start || m.created_at)}
                          </span>
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

      <p className="text-xs text-muted-foreground">
        {planName ? `${planName} plan` : 'Plan: —'}
        <span className="mx-1.5">·</span>
        {usageMinutes} participant-minutes used this month
        <span className="mx-1.5">·</span>
        <Link to="/v2/app/settings?section=billing" className="text-primary hover:underline">
          Manage billing
        </Link>
      </p>
    </div>
  );
}
