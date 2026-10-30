import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format, isFuture } from 'date-fns';
import {
  Archive,
  Copy,
  FileText,
  Globe,
  MoreHorizontal,
  Pencil,
  PhoneOff,
  RotateCcw,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { v2Meetings, v2Host, v2Auth } from '../../services/apiV2';
import { getMeetingUiState, toneToBadgeVariant } from '../lib/meetingState';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import MeetingJoinCard from '../components/MeetingJoinCard';
import MeetingPresenceCard from '../components/MeetingPresenceCard';
import MeetingAccessPanel from '../components/MeetingAccessPanel';
import MeetingEmailInvites from '../components/MeetingEmailInvites';
import MeetingInvitesPanel from '../components/MeetingInvitesPanel';
import MeetingTranscriptPanel from '../components/MeetingTranscriptPanel';
import { defaultExpiryMode } from '../../lib/inviteExpiry';

/** Click-to-edit meeting title for the header hero. */
function EditableTitle({ value, onChange, onCommit, onCancel }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename meeting"
        className="group flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {value || 'Untitled meeting'}
        </h1>
        <Pencil className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    );
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        setEditing(false);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          onCancel();
          setEditing(false);
        }
      }}
      className="h-11 max-w-xl text-xl font-semibold sm:text-2xl"
    />
  );
}

/** Small muted, copyable room-name code element (lives in Meeting settings). */
function RoomCodeChip({ roomName }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomName);
      toast.success('Copied room name');
    } catch {
      toast.error('Could not copy room name');
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy room name"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <code className="truncate font-mono">{roomName}</code>
      <Copy className="h-3 w-3 shrink-0" />
    </button>
  );
}

export default function V2MeetingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoJoinIntent = searchParams.get('join') === '1';
  const [meeting, setMeeting] = useState(null);
  const [me, setMe] = useState(null);
  const [autoJoinTriggered, setAutoJoinTriggered] = useState(false);
  const [titleEdit, setTitleEdit] = useState('');
  const [newInviteExpiryMode, setNewInviteExpiryMode] = useState('days_after_start');
  const [newInviteCustomHours, setNewInviteCustomHours] = useState(72);
  const [ending, setEnding] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const load = () =>
    v2Meetings
      .get(id)
      .then((m) => {
        setMeeting(m);
        setTitleEdit(m.title || '');
      })
      .catch(() => {
        toast.error('Meeting not found');
        navigate('/v2/app/meetings');
      });

  useEffect(() => {
    load();
  }, [id, navigate]);

  useEffect(() => {
    v2Auth.me().then(setMe).catch(() => {});
  }, []);

  const hostDisplayName = useMemo(() => {
    const u = me?.user;
    return (u?.display_name || u?.displayName || u?.email?.split('@')[0] || '').trim();
  }, [me]);

  const hostShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/v2/app/meetings/${id}?join=1`;
  }, [id]);

  const copyHostLink = async () => {
    if (!hostShareUrl) return;
    try {
      await navigator.clipboard.writeText(hostShareUrl);
      toast.success('Copied host link — only meeting hosts can use it');
    } catch {
      toast.error('Could not copy host link');
    }
  };

  useEffect(() => {
    if (!meeting) return;
    const mode = defaultExpiryMode(meeting);
    setNewInviteExpiryMode(mode);
    const maxDays = meeting.inviteMaxTtlDays ?? 90;
    setNewInviteCustomHours((h) => Math.min(Math.max(1, h), maxDays * 24));
  }, [meeting?.id, meeting?.scheduled_start, meeting?.defaultExpiryMode, meeting?.inviteMaxTtlDays]);

  useEffect(() => {
    if (!meeting || !['live', 'scheduled'].includes(meeting.status)) return undefined;
    const t = setInterval(() => {
      v2Meetings.get(id).then(setMeeting).catch(() => {});
    }, 12000);
    return () => clearInterval(t);
  }, [meeting?.status, id]);

  const ui = meeting ? getMeetingUiState(meeting) : null;

  const canManageMeeting =
    meeting &&
    me &&
    (meeting.host_user_id === me.user?.id || ['owner', 'admin'].includes(me.role));

  const canEndMeeting =
    meeting &&
    ['live', 'scheduled'].includes(meeting.status) &&
    canManageMeeting;

  const onTitleBlur = async () => {
    if (!meeting || !titleEdit.trim()) return;
    if (titleEdit.trim() === (meeting.title || '').trim()) return;
    try {
      await v2Meetings.patch(id, { title: titleEdit.trim() });
      toast.success('Title saved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
      setTitleEdit(meeting.title || '');
    }
  };

  const patchPolicy = async (body) => {
    try {
      await v2Meetings.patch(id, body);
      toast.success('Settings updated');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    }
  };

  const runArchive = async () => {
    try {
      await v2Meetings.patch(id, { status: 'archived' });
      toast.success('Meeting archived');
      setArchiveOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const runRestore = async () => {
    setRestoring(true);
    try {
      await v2Meetings.patch(id, { status: 'ended' });
      toast.success('Meeting restored');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not restore');
    } finally {
      setRestoring(false);
    }
  };

  const runDelete = async () => {
    setDeleting(true);
    try {
      await v2Meetings.delete(id);
      toast.success('Meeting deleted');
      setDeleteOpen(false);
      navigate('/v2/app/meetings');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not delete');
    } finally {
      setDeleting(false);
    }
  };

  const runEndMeeting = async () => {
    setEnding(true);
    try {
      await v2Host.endMeeting(id);
      toast.success('Meeting ended');
      setEndOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not end meeting');
    } finally {
      setEnding(false);
    }
  };

  const createInvite = async () => {
    try {
      const body = {
        expiryMode: newInviteExpiryMode,
        label: 'Guest link',
      };
      if (newInviteExpiryMode === 'custom_hours') {
        body.expiresInHours = newInviteCustomHours;
      }
      const r = await v2Meetings.createInvite(id, body);
      toast.success('Invite created');
      await navigator.clipboard.writeText(r.joinUrl);
      toast('Copied invite link to clipboard');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const revokeInvite = async (linkId) => {
    try {
      await v2Meetings.revokeInvite(id, linkId);
      toast.success('Invite revoked');
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const copyGuestUrl = async () => {
    if (!meeting?.joinUrl) return;
    await navigator.clipboard.writeText(meeting.joinUrl);
    toast.success('Copied guest link');
  };

  const copyInviteUrl = async (url) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success('Copied invite link');
  };

  const joinAsHost = async () => {
    if (!hostDisplayName) {
      toast.error('Set your name in Settings before joining');
      return;
    }
    if (!meeting) return;
    try {
      await v2Meetings.hostSessionOpen(id);
      const share = meeting.joinUrl || `${window.location.origin}/join/${encodeURIComponent(meeting.livekit_room_name)}`;
      const participantInfo = {
        isHost: true,
        participantName: hostDisplayName,
        hostCode: meeting.host_code,
        shareableLink: share,
        shareableLinkNetwork: share,
        roomName: meeting.livekit_room_name,
        meetingId: id,
        inviteToken: '',
      };
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
      const next = new URLSearchParams(window.location.search);
      next.delete('join');
      const qs = next.toString();
      navigate(`/room/${encodeURIComponent(meeting.livekit_room_name)}${qs ? `?${qs}` : ''}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not join meeting');
    }
  };

  useEffect(() => {
    if (!autoJoinIntent) return;
    if (autoJoinTriggered) return;
    if (!meeting || !me) return;
    if (!hostDisplayName) return;
    if (meeting.host_user_id && me?.user?.id && meeting.host_user_id !== me.user.id) {
      toast.error('This host link only works for the meeting host');
      const next = new URLSearchParams(searchParams);
      next.delete('join');
      setSearchParams(next, { replace: true });
      return;
    }
    setAutoJoinTriggered(true);
    joinAsHost();
  }, [autoJoinIntent, autoJoinTriggered, meeting?.host_user_id, me?.user?.id, hostDisplayName]);

  const downloadTranscriptJson = async () => {
    try {
      const { lines } = await v2Meetings.getTranscript(id);
      const blob = new Blob([JSON.stringify(lines, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting-${id}-transcript.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Download failed');
    }
  };

  const downloadTranscriptTxt = async () => {
    try {
      const blob = await v2Meetings.getTranscriptTxtBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting-${id}-transcript.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Download failed');
    }
  };

  if (!meeting) {
    return (
      <div className="mx-auto max-w-screen-xl space-y-6" aria-busy="true">
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-9 w-64 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-5 w-44 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <div className="h-48 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
          </div>
          <div className="space-y-6 lg:col-span-2">
            <div className="h-32 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
          </div>
        </div>
        <span className="sr-only">Loading meeting…</span>
      </div>
    );
  }

  const policy = meeting.policy || { host_required_to_start: false, require_invite_token: true, store_transcripts: true };
  const guestUrlNeedsToken = meeting.joinUrl && !meeting.joinUrl.includes('?i=');
  const maxInviteDays = meeting.inviteMaxTtlDays ?? 90;
  const presence = meeting.roomPresence || { humanCount: 0, participants: [] };
  const canManageTranscriptPolicy = canManageMeeting;

  // State machine for layout: archived > ended > live (people in room or status
  // 'live') > upcoming (scheduled/ready, nobody joined yet).
  const isArchived = meeting.status === 'archived';
  const isEnded = meeting.status === 'ended';
  const isLive = !isArchived && !isEnded && (presence.humanCount > 0 || meeting.status === 'live');
  const isUpcoming = !isArchived && !isEnded && !isLive;
  const joinDemoted = isEnded || isArchived;

  const startDate = meeting.scheduled_start ? new Date(meeting.scheduled_start) : null;
  const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;
  const scheduleText = validStart ? format(validStart, 'EEEE, MMM d · h:mm a') : null;

  let quietLine = null;
  if (isUpcoming) {
    if (meeting.host_present === 1) {
      quietLine = 'Session is open — waiting for guests to join.';
    } else if (validStart && isFuture(validStart)) {
      quietLine = `Starts ${format(validStart, 'EEEE h:mm a')} — no one has joined yet.`;
    } else {
      quietLine = 'No one has joined yet.';
    }
  }

  const accessPanelProps = {
    meeting,
    policy,
    onPatchPolicy: patchPolicy,
    canManageTranscriptPolicy,
    guestUrlNeedsToken,
    guestLinkMeta: meeting.guestLinkMeta,
    onCopyGuestUrl: copyGuestUrl,
  };

  const invitesPanelProps = {
    meeting,
    newInviteExpiryMode,
    setNewInviteExpiryMode,
    newInviteCustomHours,
    setNewInviteCustomHours,
    maxInviteDays,
    onCreateInvite: createInvite,
    onRevokeInvite: revokeInvite,
    onCopyInviteUrl: copyInviteUrl,
  };

  const transcriptCount = meeting.transcriptLineCount || 0;

  const primaryHostActions = !joinDemoted && (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" size="lg" className="h-12 flex-1 gap-2.5 text-base font-semibold shadow-sm">
            <Video className="h-4 w-4 shrink-0" />
            Join as host
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <MeetingJoinCard onJoinAsHost={joinAsHost} hostShareUrl={hostShareUrl} onCopyHostLink={copyHostLink} />
        </PopoverContent>
      </Popover>
      {meeting.joinUrl && (
        <Button
          type="button"
          size="lg"
          className="h-12 flex-1 gap-2.5 bg-sky-600 text-base font-semibold text-white shadow-sm hover:bg-sky-700"
          onClick={copyGuestUrl}
        >
          <Copy className="h-4 w-4 shrink-0" />
          Copy guest link
        </Button>
      )}
      {canManageMeeting && (
        <Button
          type="button"
          size="lg"
          className="h-12 flex-1 gap-2.5 bg-emerald-600 text-base font-semibold text-white shadow-sm hover:bg-emerald-700"
          onClick={() => {
            const el = document.getElementById('meeting-guests');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              const input = el.querySelector('input[inputmode="email"], input[type="email"], #guest-emails-' + meeting.id);
              if (input instanceof HTMLElement) {
                window.setTimeout(() => input.focus(), 350);
              }
            }
          }}
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          Invite guests
        </Button>
      )}
    </div>
  );

  const secondaryHostActions = (isLive && canEndMeeting) || canManageMeeting ? (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
      {isLive && canEndMeeting && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={ending}
          onClick={() => setEndOpen(true)}
        >
          <PhoneOff className="h-3.5 w-3.5" />
          {ending ? 'Ending…' : 'End for everyone'}
        </Button>
      )}
      {canManageMeeting && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <MoreHorizontal className="h-3.5 w-3.5" />
              More actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isArchived && (
              <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            )}
            {isArchived && (
              <DropdownMenuItem disabled={restoring} onSelect={runRestore}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {restoring ? 'Restoring…' : 'Restore'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  ) : null;

  const joinHostButtonDemoted = joinDemoted && (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="gap-2">
          <Video className="h-4 w-4" />
          Join as host
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <MeetingJoinCard onJoinAsHost={joinAsHost} hostShareUrl={hostShareUrl} onCopyHostLink={copyHostLink} />
      </PopoverContent>
    </Popover>
  );

  const metricCards = (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
        <Users className="mb-2 h-4 w-4 text-muted-foreground" />
        <div className="text-xl font-semibold text-foreground">{presence.humanCount || 0}</div>
        <div className="text-xs text-muted-foreground">People live</div>
      </div>
      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
        <Globe className="mb-2 h-4 w-4 text-muted-foreground" />
        <div className="text-xl font-semibold text-foreground">Live</div>
        <div className="text-xs text-muted-foreground">Translation ready</div>
      </div>
      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
        <FileText className="mb-2 h-4 w-4 text-muted-foreground" />
        <div className="text-xl font-semibold text-foreground">{transcriptCount}</div>
        <div className="text-xs text-muted-foreground">Caption lines</div>
      </div>
    </div>
  );

  const transcriptCard = (
    <Card className="app-card border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              AI insights & transcript
            </CardTitle>
            <CardDescription>
              Meeting summary, action items, exports, and saved caption lines.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setTranscriptOpen(true)}>
              <Sparkles className="h-3.5 w-3.5" />
              Open insights
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setTranscriptOpen((v) => !v)}
            >
              <FileText className="h-3.5 w-3.5" />
              {transcriptOpen ? 'Hide transcript' : 'View transcript'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-background/65 p-3">
            <div className="text-xs text-muted-foreground">Transcript</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{transcriptCount} lines</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/65 p-3">
            <div className="text-xs text-muted-foreground">Insights</div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {policy.store_transcripts ? 'Ready' : 'Off'}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/65 p-3">
            <div className="text-xs text-muted-foreground">Exports</div>
            <div className="mt-1 text-lg font-semibold text-foreground">TXT / JSON</div>
          </div>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            What you can do here
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Generate an AI report, review the saved captions, or export the transcript after the meeting.
          </p>
        </div>
        {transcriptOpen && (
          <div className="border-t border-border/60 pt-4">
            <MeetingTranscriptPanel
              meetingId={id}
              lineCount={meeting.transcriptLineCount}
              storeTranscripts={policy.store_transcripts}
              onDownloadJson={downloadTranscriptJson}
              onDownloadTxt={downloadTranscriptTxt}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );

  const settingsSections = (
    <Accordion
      type="multiple"
      defaultValue={[]}
      className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
    >
      <AccordionItem value="settings" className="border-b border-border/60 px-4 last:border-b-0">
        <AccordionTrigger className="text-sm font-medium hover:no-underline">
          <span className="flex flex-col items-start gap-0.5 text-left">
            Meeting settings
            <span className="text-xs font-normal text-muted-foreground">
              Access, policies, and advanced invite links.
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-8 pt-1">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Access &amp; policy</h3>
            <MeetingAccessPanel {...accessPanelProps} showGuestUrl={false} />
          </section>
          {joinDemoted && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guest link</h3>
              <MeetingAccessPanel {...accessPanelProps} showPolicyToggles={false} showGuestUrl />
            </section>
          )}
          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Advanced invites</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional extra links for one-off guests, expirations, or revocation.
              </p>
            </div>
            <MeetingInvitesPanel {...invitesPanelProps} />
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Room</h3>
            <RoomCodeChip roomName={meeting.livekit_room_name} />
          </section>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-[1.5rem] border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <div className="space-y-5">
          <div className="space-y-3">
            <Link to="/v2/app/meetings" className="text-sm font-medium text-primary hover:underline">
              ← Meetings
            </Link>
            <div className="min-w-0 space-y-2">
              <EditableTitle
                value={titleEdit}
                onChange={setTitleEdit}
                onCommit={onTitleBlur}
                onCancel={() => setTitleEdit(meeting.title || '')}
              />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {ui && (
                  <Badge variant={toneToBadgeVariant(ui.tone)} className="uppercase tracking-wide">
                    {ui.label}
                  </Badge>
                )}
                {scheduleText && <span className="text-muted-foreground">{scheduleText}</span>}
              </div>
              {quietLine && <p className="text-sm text-muted-foreground">{quietLine}</p>}
            </div>
          </div>
          {primaryHostActions}
          {joinHostButtonDemoted}
          {metricCards}
          {secondaryHostActions}
        </div>
      </div>

      {isArchived && canManageMeeting && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            This meeting is archived and hidden from the main list. New joins are blocked.
          </p>
          <Button type="button" variant="outline" size="sm" className="gap-2" disabled={restoring} onClick={runRestore}>
            <RotateCcw className="h-4 w-4" />
            {restoring ? 'Restoring…' : 'Restore'}
          </Button>
        </div>
      )}

      {transcriptCard}

      {canManageMeeting && (
        <Card id="meeting-guests" className="app-card scroll-mt-24 border-border/60">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserPlus className="h-5 w-5 text-emerald-600" />
              Guests
            </CardTitle>
            <CardDescription>
              Invite by email and track who accepted, declined, or still needs to reply.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <MeetingEmailInvites meetingId={meeting.id} />
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        {isLive ? (
          <MeetingPresenceCard presence={presence} />
        ) : (
          <Card className="app-card border-border/60">
            <CardHeader className="border-b border-border/60 pb-3">
              <CardTitle className="text-base">Participants</CardTitle>
              <CardDescription>No one is connected right now.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Participants appear here when the meeting is live.</p>
            </CardContent>
          </Card>
        )}
        {settingsSections}
      </div>

      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End meeting for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              The meeting room will be closed and invite links revoked. Participants will be disconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={runEndMeeting}>
              End meeting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              It will move to the Archived tab on your meetings list. Transcripts and reports are kept. New joins are
              blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meeting permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the meeting, invite links, transcript lines, and AI reports. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={runDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
