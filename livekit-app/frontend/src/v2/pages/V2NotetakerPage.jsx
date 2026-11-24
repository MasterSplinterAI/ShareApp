import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Mail,
  RefreshCw,
  Sparkles,
  Square,
} from 'lucide-react';
import toast from 'react-hot-toast';
import CalendarNotetakerSection from '../components/CalendarNotetakerSection';
import SendNotetakerDialog, { detectExternalMeetingPlatformClient } from '../components/SendNotetakerDialog';
import { isBotSessionActive } from '../components/ExternalBotStatusCard';
import { v2Notetaker } from '../../services/apiV2';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

const PLATFORM_LABELS = {
  google_meet: 'Google Meet',
  ms_teams: 'Microsoft Teams',
  zoom: 'Zoom',
  webex: 'Webex',
};

function formatStatusLabel(status) {
  switch (String(status || '').toLowerCase()) {
    case 'queued':
      return 'Queued';
    case 'scheduled':
      return 'Scheduled';
    case 'joining':
      return 'Joining';
    case 'in_waiting_room':
      return 'Waiting room';
    case 'in_call':
      return 'In meeting';
    case 'recording':
      return 'Recording';
    case 'processing':
      return 'Processing';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return status || 'Unknown';
  }
}

function statusBadgeVariant(status) {
  switch (String(status || '').toLowerCase()) {
    case 'completed':
      return 'success';
    case 'recording':
    case 'in_call':
      return 'destructive';
    case 'joining':
    case 'in_waiting_room':
    case 'queued':
    case 'processing':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

function formatDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function V2NotetakerPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stoppingId, setStoppingId] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('notes@invite.lalia.cloud');
  const [copiedInvite, setCopiedInvite] = useState(false);

  const [quickUrl, setQuickUrl] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialUrl, setDialogInitialUrl] = useState('');

  const detectedPlatform = detectExternalMeetingPlatformClient(quickUrl);
  const detectedPlatformKey = typeof detectedPlatform === 'string'
    ? detectedPlatform
    : (detectedPlatform?.platform || detectedPlatform?.id || '');
  const detectedPlatformText =
    (typeof detectedPlatform === 'object' && (detectedPlatform?.platformLabel || detectedPlatform?.label || detectedPlatform?.name)) ||
    PLATFORM_LABELS[detectedPlatformKey] ||
    detectedPlatformKey;

  const loadSessions = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingSessions(true);
    else setRefreshing(true);
    try {
      const [sessRes, calRes] = await Promise.all([
        v2Notetaker.listSessions(),
        v2Notetaker.listCalendars().catch(() => null),
      ]);
      setSessions(Array.isArray(sessRes?.sessions) ? sessRes.sessions : []);
      if (calRes?.inviteEmail) {
        setInviteEmail(calRes.inviteEmail);
      }
    } catch (err) {
      if (!quiet) {
        toast.error(err?.response?.data?.error || 'Failed to load notetaker sessions');
      }
    } finally {
      setLoadingSessions(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const hasActiveBot = sessions.some((s) => isBotSessionActive(s));

  useEffect(() => {
    if (!hasActiveBot) return undefined;
    const id = setInterval(() => {
      loadSessions({ quiet: true });
    }, 8000);
    return () => clearInterval(id);
  }, [hasActiveBot, loadSessions]);

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteEmail);
      setCopiedInvite(true);
      toast.success(`Copied ${inviteEmail}`);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      toast.error('Copy failed — highlight and copy the email address');
    }
  };

  const handleQuickLaunch = (e) => {
    e.preventDefault();
    const trimmed = quickUrl.trim();
    if (trimmed && !detectExternalMeetingPlatformClient(trimmed)) {
      toast.error('Paste a valid Google Meet, Microsoft Teams, Zoom, or Webex meeting URL');
      return;
    }
    setDialogInitialUrl(trimmed);
    setDialogOpen(true);
  };

  const handleStopSession = async (sessionId) => {
    setStoppingId(sessionId);
    try {
      await v2Notetaker.stopSession(sessionId);
      toast.success('Requested notetaker to leave and wrap up');
      await loadSessions({ quiet: true });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to stop notetaker');
    } finally {
      setStoppingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Bot className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">AI Notetaker</h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Send Lalia into Google Meet, Microsoft Teams, Zoom, and Webex calls via direct link, calendar invite email, or auto-sync.
          </p>
        </div>
        <Button
          type="button"
          className="shrink-0 gap-2"
          onClick={() => {
            setDialogInitialUrl('');
            setDialogOpen(true);
          }}
        >
          <Sparkles className="h-4 w-4" />
          Send Notetaker
        </Button>
      </div>

      {/* Way 1 & Way 2: Direct Link + Invite Email */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/80 bg-card/85">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Send directly to a call</h2>
              </div>
              {detectedPlatform ? (
                <Badge variant="secondary" className="text-[10px]">
                  {detectedPlatformText}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  On-demand
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Paste any external meeting URL to dispatch Lalia right now or schedule a bot for later.
            </p>
            <form onSubmit={handleQuickLaunch} className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={quickUrl}
                onChange={(e) => setQuickUrl(e.target.value)}
                placeholder="https://meet.google.com/... or teams.microsoft.com/..."
                className="h-9 flex-1 text-xs"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <Button type="submit" size="sm" variant="secondary" className="h-9 shrink-0 gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Send
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/85">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Invite by calendar email</h2>
              </div>
              <Badge variant="outline" className="text-[10px]">
                No OAuth needed
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Invite or forward any calendar invite to this address. When a matching Lalia account or workspace domain is on the invite, Lalia joins automatically.
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <code className="flex-1 truncate font-mono text-xs font-medium text-foreground">
                {inviteEmail}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={handleCopyInvite}
              >
                {copiedInvite ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Way 3: Google & Outlook Calendar OAuth Auto-Sync */}
      <CalendarNotetakerSection onUpdated={() => loadSessions({ quiet: true })} />

      {/* Recent & Scheduled Bot Sessions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">Recent &amp; scheduled bots</h2>
            <p className="text-xs text-muted-foreground">
              Track live status, recordings, and completed transcripts from external meetings.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => loadSessions({ quiet: true })}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {loadingSessions ? (
          <Card className="border-border/70 bg-card/70">
            <CardContent className="p-6 text-center text-xs text-muted-foreground">
              Loading bot sessions…
            </CardContent>
          </Card>
        ) : sessions.length === 0 ? (
          <Card className="border-dashed border-border/70 bg-card/50">
            <CardContent className="p-6 text-center text-xs text-muted-foreground">
              No external bot sessions yet. Send Lalia to a meeting link above, invite{' '}
              <span className="font-mono text-foreground">{inviteEmail}</span>, or connect your calendar to auto-join calls.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => {
              const active = isBotSessionActive(s);
              const whenLabel = formatDateTime(s.scheduled_for || s.created_at);
              return (
                <Card key={s.id} className="border-border/70 bg-card/80">
                  <CardContent className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/v2/app/meetings/${s.meeting_id}`}
                          className="truncate text-sm font-semibold text-foreground hover:text-primary"
                        >
                          {s.meeting_title || s.bot_display_name || 'External Meeting'}
                        </Link>
                        <Badge variant={statusBadgeVariant(s.status)} className="text-[10px]">
                          {formatStatusLabel(s.status)}
                        </Badge>
                        {s.platform && (
                          <Badge variant="outline" className="text-[10px]">
                            {PLATFORM_LABELS[s.platform] || s.platform}
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.status_detail || s.normalized_url || s.target_url}
                        {whenLabel ? ` · ${whenLabel}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {active && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                          disabled={stoppingId === s.id}
                          onClick={() => handleStopSession(s.id)}
                        >
                          <Square className="h-3 w-3" />
                          {stoppingId === s.id ? 'Stopping…' : 'Stop bot'}
                        </Button>
                      )}
                      <Button asChild size="sm" variant="secondary" className="h-8 gap-1.5 text-xs">
                        <Link to={`/v2/app/meetings/${s.meeting_id}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          View meeting
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <SendNotetakerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialUrl={dialogInitialUrl}
        onDispatched={(data) => {
          setQuickUrl('');
          loadSessions({ quiet: true });
          if (data?.meetingId) {
            navigate(`/v2/app/meetings/${data.meetingId}`);
          }
        }}
      />
    </div>
  );
}
