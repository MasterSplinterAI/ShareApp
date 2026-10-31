import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getPublicAppOrigin } from '../../lib/nativePlatform';
import toast from 'react-hot-toast';
import { format, isToday, isTomorrow, isThisYear } from 'date-fns';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Clock,
  FileText,
  Link2,
  MoreHorizontal,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  Video,
  Zap,
} from 'lucide-react';
import { v2Auth, v2Meetings } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
import { useUpgradeOffer } from '../hooks/useUpgradeOffer';
import { UpgradeQuotaActions } from '../components/UpgradePrompt';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
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
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { DatetimePicker, getNextRoundedScheduleDate } from '../../components/ui/datetime-picker';

const RECENT_CAP = 10;

/** "Today 3:00 PM" / "Tomorrow 3:00 PM" / "Thu Jun 12, 3:00 PM" / "Jun 12, 2025". */
function friendlyTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return `Today ${format(d, 'h:mm a')}`;
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'h:mm a')}`;
  if (isThisYear(d)) return format(d, 'EEE MMM d, h:mm a');
  return format(d, 'MMM d, yyyy');
}

function meetingAnchorTime(m) {
  const t = new Date(m.scheduled_start || m.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isJoinableState(uiKey, meeting) {
  if (!uiKey || uiKey === 'ended' || uiKey === 'archived' || uiKey === 'unknown') {
    return false;
  }
  if (meeting?.is_direct_call) {
    // Direct calls are only joinable while someone is actively in the room
    return uiKey === 'live_active' || uiKey === 'scheduled_active';
  }
  return (
    uiKey === 'live_active' ||
    uiKey === 'live_ready' ||
    uiKey === 'scheduled_active' ||
    uiKey === 'scheduled_ready' ||
    uiKey === 'waiting_for_host'
  );
}

function isLiveState(uiKey) {
  return uiKey === 'live_active' || uiKey === 'scheduled_active';
}

/** Guest link when derivable from list payload; otherwise null ("Open" covers it). */
function inviteUrlFor(m) {
  return m.joinUrl || null;
}

function LiveBadge({ label }) {
  return (
    <Badge variant="success" className="shrink-0 gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
      </span>
      {label || 'Live'}
    </Badge>
  );
}

function MeetingCard({ meeting: m, isArchivedView, onJoin, onArchive, onRestore, onDelete }) {
  const ui = getMeetingUiState(m);
  const live = isLiveState(ui.key);
  const lineCount = Number(m.transcript_line_count) || 0;
  const url = inviteUrlFor(m);
  const canQuickJoin = !isArchivedView && isJoinableState(ui.key, m);
  const canCopyInvite = canQuickJoin && Boolean(url) && m.guestAccessActive !== false;
  const timeLabel = friendlyTime(m.scheduled_start || m.created_at);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <Card className="app-card app-card-hover group flex h-full flex-col border-border/70 hover:border-primary/40">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/v2/app/meetings/${m.id}`} className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground group-hover:text-primary">
              {m.title || m.livekit_room_name}
            </span>
          </Link>
          {live ? (
            <LiveBadge label={ui.label} />
          ) : (
            <Badge variant={toneToBadgeVariant(ui.tone)} className="shrink-0">
              {ui.label}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {timeLabel}
          </span>
          {lineCount > 0 && (
            <span className="inline-flex items-center gap-1.5" title={`${lineCount} transcript lines`}>
              <FileText className="h-3.5 w-3.5" />
              {lineCount} lines
            </span>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
          {canQuickJoin && onJoin && (
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500"
              onClick={() => onJoin(m)}
            >
              <Video className="h-3.5 w-3.5" />
              Join
            </Button>
          )}
          <Button variant="outline" size="sm" asChild className="h-8 gap-1 px-2.5 text-xs">
            <Link to={`/v2/app/meetings/${m.id}`}>
              {lineCount > 0 ? 'Transcript & AI' : 'Details'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          {canCopyInvite && (
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={copyInvite}>
              <Link2 className="h-3.5 w-3.5" />
              Copy link
            </Button>
          )}
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem asChild>
                  <Link to={`/v2/app/meetings/${m.id}`}>Open</Link>
                </DropdownMenuItem>
                {!isArchivedView && m.status !== 'archived' && (
                  <DropdownMenuItem onClick={(e) => onArchive(m.id, e)}>
                    <Archive className="mr-2 h-4 w-4" />
                    Archive
                  </DropdownMenuItem>
                )}
                {isArchivedView && (
                  <DropdownMenuItem onClick={(e) => onRestore(m.id, e)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Restore
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(m.id);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete permanently
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ icon: Icon, title, count }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {count != null && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

function CardGrid({ children }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function LoadingGrid() {
  return (
    <CardGrid>
      {[0, 1, 2].map((i) => (
        <div key={i} className="app-card h-36 animate-pulse border-border/50 bg-muted/40" />
      ))}
    </CardGrid>
  );
}

export default function V2MeetingsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [me, setMe] = useState(null);
  const [view, setView] = useState('meetings'); // 'meetings' | 'direct_calls' | 'archived'
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('Instant meeting');
  const [hostRequired, setHostRequired] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(undefined);
  const [startingInstant, setStartingInstant] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(null);
  const { offer, checkoutLoading, startCheckout } = useUpgradeOffer(me);

  const archivedView = view === 'archived';
  const directCallsView = view === 'direct_calls';

  useEffect(() => {
    v2Auth.me().then(setMe).catch(() => {});
  }, []);

  const load = (archived = false) => {
    setLoading(true);
    v2Meetings
      .list({ archived })
      .then((r) => setMeetings(r.meetings || []))
      .catch(() => toast.error('Failed to load meetings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(archivedView);
  }, [archivedView]);

  useEffect(() => {
    if (searchParams.get('create') === '1' || searchParams.get('schedule') === '1') {
      setNewTitle('Scheduled meeting');
      setHostRequired(false);
      setScheduledDate(getNextRoundedScheduleDate());
      setShowCreate(true);
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      next.delete('schedule');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const conferenceMeetings = useMemo(
    () => meetings.filter((m) => !m.is_direct_call),
    [meetings]
  );
  const directCallMeetings = useMemo(
    () => meetings.filter((m) => Boolean(m.is_direct_call)),
    [meetings]
  );

  const groups = useMemo(() => {
    if (archivedView || directCallsView) return { today: [], upcoming: [], recent: [] };
    const now = Date.now();
    const today = [];
    const upcoming = [];
    const recent = [];
    for (const m of conferenceMeetings) {
      const ui = getMeetingUiState(m);
      const anchor = new Date(m.scheduled_start || m.created_at);
      const anchorOk = !Number.isNaN(anchor.getTime());
      const ended = ui.key === 'ended' || ui.key === 'archived';
      if (!ended && (isLiveState(ui.key) || (anchorOk && isToday(anchor)))) {
        today.push(m);
      } else if (!ended && m.scheduled_start && anchorOk && anchor.getTime() > now) {
        upcoming.push(m);
      } else {
        recent.push(m);
      }
    }
    // Today: live first, then by time ascending.
    today.sort((a, b) => {
      const aLive = isLiveState(getMeetingUiState(a).key);
      const bLive = isLiveState(getMeetingUiState(b).key);
      if (aLive !== bLive) return aLive ? -1 : 1;
      return meetingAnchorTime(a) - meetingAnchorTime(b);
    });
    upcoming.sort((a, b) => meetingAnchorTime(a) - meetingAnchorTime(b));
    recent.sort((a, b) => meetingAnchorTime(b) - meetingAnchorTime(a));
    return { today, upcoming, recent };
  }, [conferenceMeetings, archivedView, directCallsView]);

  const visibleRecent = showAllRecent ? groups.recent : groups.recent.slice(0, RECENT_CAP);

  const handleCreateError = (e) => {
    const code = e.response?.data?.code;
    if (
      e.response?.status === 402 &&
      (code === 'hard_cap_meeting' || code === 'hard_cap_translation')
    ) {
      setShowCreate(false);
      setQuotaBlocked(e.response?.data?.error || 'Usage limit reached');
      return;
    }
    toast.error(e.response?.data?.error || 'Could not create');
  };

  const openCreateModal = () => {
    setNewTitle('Scheduled meeting');
    setHostRequired(false);
    setScheduledDate(getNextRoundedScheduleDate());
    setShowCreate(true);
  };

  const createNow = async () => {
    setCreating(true);
    try {
      const iso =
        scheduledDate instanceof Date && !Number.isNaN(scheduledDate.getTime()) ? scheduledDate.toISOString() : null;
      const m = await v2Meetings.create({
        title: newTitle.trim() || 'Meeting',
        host_required_to_start: hostRequired,
        ...(iso ? { scheduled_start: iso } : {}),
      });
      toast.success(m.status === 'scheduled' ? 'Meeting scheduled' : 'Meeting created');
      setShowCreate(false);
      window.location.href = `/v2/app/meetings/${m.id}`;
    } catch (e) {
      handleCreateError(e);
    } finally {
      setCreating(false);
    }
  };

  const startInstant = async () => {
    setStartingInstant(true);
    try {
      const m = await v2Meetings.create({
        title: 'Instant meeting',
        host_required_to_start: false,
      });
      await v2Meetings.hostSessionOpen(m.id).catch(() => {});
      const hostDisplayName =
        (me?.user?.display_name || me?.user?.displayName || me?.user?.email?.split('@')[0] || 'Host').trim();
      const participantInfo = {
        isHost: true,
        participantName: hostDisplayName,
        hostCode: m.hostCode,
        shareableLink: m.joinUrl,
        shareableLinkNetwork: m.joinUrl,
        roomName: m.livekitRoomName,
        meetingId: m.id,
        inviteToken: '',
      };
      try {
        sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      } catch {
        /* ignore */
      }
      navigate(`/room/${encodeURIComponent(m.livekitRoomName)}`, {
        state: {
          ...participantInfo,
          meetingTitle: m.title,
        },
      });
    } catch (e) {
      handleCreateError(e);
    } finally {
      setStartingInstant(false);
    }
  };

  const joinMeetingAsHost = async (m) => {
    const hostDisplayName =
      (me?.user?.display_name || me?.user?.displayName || me?.user?.email?.split('@')[0] || 'Host').trim();
    try {
      await v2Meetings.hostSessionOpen(m.id).catch(() => {});
      const share = m.joinUrl || `${getPublicAppOrigin()}/join/${encodeURIComponent(m.livekit_room_name)}`;
      const participantInfo = {
        isHost: true,
        participantName: hostDisplayName,
        hostCode: m.host_code,
        shareableLink: share,
        shareableLinkNetwork: share,
        roomName: m.livekit_room_name,
        meetingId: m.id,
        inviteToken: '',
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      navigate(`/room/${encodeURIComponent(m.livekit_room_name)}`, {
        state: {
          ...participantInfo,
          meetingTitle: m.title,
        },
      });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not join meeting');
    }
  };

  const archiveMeeting = async (id, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    try {
      await v2Meetings.patch(id, { status: 'archived' });
      toast.success('Meeting archived');
      load(archivedView);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not archive');
    }
  };

  const restoreMeeting = async (id, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    try {
      await v2Meetings.patch(id, { status: 'ended' });
      toast.success('Meeting restored');
      load(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not restore');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await v2Meetings.delete(pendingDelete);
      toast.success('Meeting deleted');
      setPendingDelete(null);
      load(archivedView);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not delete');
    } finally {
      setDeleting(false);
    }
  };

  const cardProps = {
    isArchivedView: archivedView,
    onJoin: joinMeetingAsHost,
    onArchive: archiveMeeting,
    onRestore: restoreMeeting,
    onDelete: setPendingDelete,
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Meetings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create instant or scheduled meetings, invite guests, join as host.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={startInstant}
            disabled={startingInstant}
            className="gap-2"
          >
            <Zap className="h-4 w-4" />
            {startingInstant ? 'Starting…' : 'Start instant meeting'}
          </Button>
          <Button onClick={openCreateModal} className="gap-2">
            <Plus className="h-4 w-4" />
            New meeting
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border/80 bg-muted/30 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('meetings')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === 'meetings'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Video className="h-3.5 w-3.5" />
            Meetings
            {!archivedView && (
              <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] tabular-nums text-muted-foreground">
                {conferenceMeetings.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('direct_calls')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === 'direct_calls'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Phone className="h-3.5 w-3.5" />
            Direct calls
            {!archivedView && (
              <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] tabular-nums text-muted-foreground">
                {directCallMeetings.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('archived')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              view === 'archived'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Archive className="h-3.5 w-3.5" />
            Archived
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {archivedView
            ? 'Archived rooms & calls'
            : directCallsView
              ? '1-on-1 direct call rooms & transcripts'
              : 'Scheduled & instant meetings — live and today first'}
        </span>
      </div>

      {loading ? (
        <LoadingGrid />
      ) : archivedView ? (
        meetings.length === 0 ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none">
            <CardContent className="flex flex-col items-center py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Archive className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="mt-4 text-sm font-medium text-foreground">No archived meetings</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Archive a meeting from its actions menu and it will show up here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <CardGrid>
            {meetings.map((m) => (
              <MeetingCard key={m.id} meeting={m} {...cardProps} />
            ))}
          </CardGrid>
        )
      ) : directCallsView ? (
        directCallMeetings.length === 0 ? (
          <Card className="border-dashed border-border bg-muted/30 shadow-none">
            <CardContent className="flex flex-col items-center py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Phone className="h-5 w-5 text-primary" />
              </span>
              <p className="mt-4 text-sm font-medium text-foreground">No direct calls yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                1-on-1 calls you place from your Contacts list appear here with their transcripts and AI summaries, keeping your main Meetings list clean.
              </p>
              <Button asChild variant="outline" className="mt-5 gap-2">
                <Link to="/v2/app">Go to Contacts &amp; Call Log</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <CardGrid>
            {directCallMeetings.map((m) => (
              <MeetingCard key={m.id} meeting={m} {...cardProps} />
            ))}
          </CardGrid>
        )
      ) : conferenceMeetings.length === 0 ? (
        <Card className="border-dashed border-border bg-muted/30 shadow-none">
          <CardContent className="flex flex-col items-center py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Video className="h-6 w-6 text-primary" />
            </span>
            <p className="mt-4 text-base font-medium text-foreground">No meetings yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Start an instant meeting or schedule one for later — you&apos;ll get a guest link to share.
            </p>
            <Button onClick={openCreateModal} className="mt-5 gap-2">
              <Plus className="h-4 w-4" />
              New meeting
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {groups.today.length > 0 && (
            <section>
              <SectionHeading icon={Clock} title="Today" count={groups.today.length} />
              <CardGrid>
                {groups.today.map((m) => (
                  <MeetingCard key={m.id} meeting={m} {...cardProps} />
                ))}
              </CardGrid>
            </section>
          )}

          {groups.upcoming.length > 0 && (
            <section>
              <SectionHeading icon={CalendarClock} title="Upcoming" count={groups.upcoming.length} />
              <CardGrid>
                {groups.upcoming.map((m) => (
                  <MeetingCard key={m.id} meeting={m} {...cardProps} />
                ))}
              </CardGrid>
            </section>
          )}

          {groups.recent.length > 0 && (
            <section>
              <SectionHeading icon={Archive} title="Recent" count={groups.recent.length} />
              <CardGrid>
                {visibleRecent.map((m) => (
                  <MeetingCard key={m.id} meeting={m} {...cardProps} />
                ))}
              </CardGrid>
              {!showAllRecent && groups.recent.length > RECENT_CAP && (
                <div className="mt-3 flex justify-center">
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setShowAllRecent(true)}>
                    <ChevronDown className="h-4 w-4" />
                    Show all {groups.recent.length}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] overflow-y-auto p-4 sm:max-w-md sm:p-6">
          <DialogHeader>
            <DialogTitle>{scheduledDate ? 'Schedule a meeting' : 'New instant meeting'}</DialogTitle>
            <DialogDescription>
              Pick a date and time to schedule, or clear the date to create an instant room.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="mtitle">Meeting title</Label>
              <Input id="mtitle" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>When</Label>
              <DatetimePicker
                value={scheduledDate}
                onChange={setScheduledDate}
                defaultExpanded={Boolean(scheduledDate)}
                placeholder="Instant — tap to schedule date & time"
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="host-wait" className="text-sm">
                  Guests wait for host
                </Label>
                <p className="text-xs text-muted-foreground">Guests enter only after you open the session.</p>
              </div>
              <Switch id="host-wait" checked={hostRequired} onCheckedChange={setHostRequired} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="button" onClick={createNow} disabled={creating}>
              {creating ? 'Creating…' : scheduledDate ? 'Schedule meeting' : 'Create meeting'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meeting permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the meeting, invites, transcripts, and AI reports. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(quotaBlocked)} onOpenChange={(open) => !open && setQuotaBlocked(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{offer?.pressure?.level === 'over' ? 'Usage limit reached' : 'Upgrade to keep hosting'}</AlertDialogTitle>
            <AlertDialogDescription>{quotaBlocked}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:flex-col sm:space-x-0">
            <UpgradeQuotaActions
              offer={offer}
              checkoutLoading={checkoutLoading}
              onCheckout={startCheckout}
              onDismiss={() => setQuotaBlocked(null)}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
