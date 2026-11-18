import { useState } from 'react';
import { Bot, ExternalLink, Loader2, Radio, Square, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Notetaker } from '../../services/apiV2';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';

const ACTIVE_BOT_STATES = new Set(['scheduled', 'queued', 'joining', 'waiting_in_lobby', 'recording', 'processing']);

export function isBotSessionActive(session) {
  return Boolean(session && ACTIVE_BOT_STATES.has(session.status));
}

function statusMeta(session) {
  const status = session?.status || 'queued';
  switch (status) {
    case 'scheduled':
      return { label: 'Scheduled', variant: 'secondary', pulse: false };
    case 'queued':
      return { label: 'Queued', variant: 'secondary', pulse: true };
    case 'joining':
      return { label: 'Joining call…', variant: 'default', pulse: true };
    case 'waiting_in_lobby':
      return { label: 'Waiting in lobby', variant: 'warning', pulse: true };
    case 'recording':
      return { label: 'Recording live', variant: 'success', pulse: true };
    case 'processing':
      return { label: 'Generating AI summary…', variant: 'default', pulse: true };
    case 'completed':
      return { label: 'Completed', variant: 'secondary', pulse: false };
    case 'canceled':
      return { label: 'Canceled', variant: 'outline', pulse: false };
    case 'failed':
      return { label: 'Failed', variant: 'destructive', pulse: false };
    default:
      return { label: status, variant: 'secondary', pulse: false };
  }
}

export default function ExternalBotStatusCard({ meeting, botSession, canManage, onUpdated }) {
  const [stopping, setStopping] = useState(false);

  const platformLabel =
    meeting?.meeting_source === 'google_meet'
      ? 'Google Meet'
      : meeting?.meeting_source === 'ms_teams'
        ? 'Microsoft Teams'
        : 'External Meeting';

  const externalUrl = botSession?.normalized_url || meeting?.external_meeting_url || null;
  const meta = statusMeta(botSession);
  const canStop =
    canManage &&
    botSession &&
    ['scheduled', 'queued', 'joining', 'waiting_in_lobby', 'recording'].includes(botSession.status) &&
    !botSession.stop_requested;

  const handleStop = async () => {
    if (!botSession?.id || stopping) return;
    setStopping(true);
    try {
      await v2Notetaker.stopSession(botSession.id);
      toast.success('Requested AI Notetaker to leave & save recording');
      if (onUpdated) onUpdated();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not stop notetaker');
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/35 bg-gradient-to-br from-primary/[0.06] via-card to-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Bot className="h-4 w-4" />
              {platformLabel} AI Notetaker
            </span>
            <Badge variant={meta.variant} className="gap-1.5 text-xs">
              {meta.pulse && (
                <Radio className="h-3 w-3 animate-pulse" />
              )}
              {botSession?.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              {botSession?.status === 'failed' && <AlertCircle className="h-3 w-3" />}
              {meta.label}
            </Badge>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {botSession?.status === 'waiting_in_lobby'
              ? `Waiting for the meeting host to admit "${botSession.bot_display_name || 'Lalia Notetaker'}" from the ${platformLabel} lobby.`
              : botSession?.status_detail ||
                `Participant name: ${botSession?.bot_display_name || 'Lalia Notetaker'}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {externalUrl && (
            <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                Open {platformLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {canStop && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9 gap-1.5 text-xs"
              disabled={stopping}
              onClick={handleStop}
            >
              {stopping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5 fill-current" />
              )}
              {botSession.status === 'queued' || botSession.status === 'scheduled'
                ? 'Cancel bot'
                : 'Stop & save recording'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
