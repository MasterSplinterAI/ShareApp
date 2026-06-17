import { useState, useCallback } from 'react';
import { useParticipants } from '@livekit/components-react';
import { Users, MicOff, Mic, UserX, VolumeX, Loader2 } from 'lucide-react';
import { Track } from 'livekit-client';
import toast from 'react-hot-toast';
import { useMeeting } from '../context/MeetingContext';
import { v2Host } from '../services/apiV2';
import PanelTabs from './PanelTabs';

function isAgentParticipant(identity) {
  const id = (identity || '').toLowerCase();
  return (
    id.startsWith('agent-') ||
    id.includes('translation') ||
    id.includes('-agent') ||
    id.includes('agent_')
  );
}

function ParticipantRow({ participant, meetingId, isLocalHost, localIdentity }) {
  const [busy, setBusy] = useState(null);
  const identity = participant.identity || '';
  const isAgent = isAgentParticipant(identity);
  const isSelf = identity === localIdentity;
  const name = participant.name || identity;

  const micPub = participant.getTrackPublication?.(Track.Source.Microphone);
  const isServerMuted = Boolean(micPub?.isMuted);

  const setRemoteMicMuted = useCallback(
    async (muted) => {
      if (!meetingId || busy) return;
      setBusy(muted ? 'mute' : 'unmute');
      try {
        await v2Host.muteParticipant(meetingId, identity, muted);
        toast.success(muted ? `Muted ${name}` : `Unmuted ${name}`);
      } catch (e) {
        const d = e?.response?.data;
        toast.error(d?.hint || d?.error || (muted ? 'Failed to mute' : 'Failed to unmute'));
      } finally {
        setBusy(null);
      }
    },
    [meetingId, identity, name, busy]
  );

  const handleRemove = useCallback(async () => {
    if (!meetingId || busy) return;
    setBusy('remove');
    try {
      await v2Host.removeParticipant(meetingId, identity);
      toast.success(`Removed ${name}`);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to remove');
    } finally {
      setBusy(null);
    }
  }, [meetingId, identity, name, busy]);

  if (isAgent) return null;

  return (
    <div className="group flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
          {(name[0] || '?').toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">
            {name}
            {isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {isServerMuted && <MicOff className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Muted" />}
        {!isServerMuted && micPub && <Mic className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Unmuted" />}

        {isLocalHost && !isSelf && (
          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            {isServerMuted ? (
              <button
                type="button"
                onClick={() => setRemoteMicMuted(false)}
                disabled={!!busy}
                className="rounded-md bg-secondary p-1.5 text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label={`Unmute ${name}`}
                title={`Unmute ${name}`}
              >
                {busy === 'unmute' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRemoteMicMuted(true)}
                disabled={!!busy}
                className="rounded-md bg-secondary p-1.5 text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label={`Mute ${name}`}
                title={`Mute ${name}`}
              >
                {busy === 'mute' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleRemove}
              disabled={!!busy}
              className="rounded-md bg-destructive/80 p-1.5 text-destructive-foreground transition-colors hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              aria-label={`Remove ${name}`}
              title={`Remove ${name}`}
            >
              {busy === 'remove' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ParticipantsPanel({ meetingId }) {
  const { sidePanelOpen, sidePanelTab, isHost } = useMeeting();
  const participants = useParticipants();
  const [muteAllBusy, setMuteAllBusy] = useState(false);

  const isVisible = sidePanelOpen && sidePanelTab === 'participants';

  const humanParticipants = participants.filter((p) => !isAgentParticipant(p.identity));

  const localIdentity = participants.find((p) => p.isLocal)?.identity;

  const handleMuteAll = useCallback(async () => {
    if (!meetingId || muteAllBusy) return;
    setMuteAllBusy(true);
    try {
      await v2Host.muteAll(meetingId, localIdentity);
      toast.success('All participants muted');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to mute all');
    } finally {
      setMuteAllBusy(false);
    }
  }, [meetingId, localIdentity, muteAllBusy]);

  if (!isVisible) return null;

  return (
    <div
      className="z-40 flex max-h-[45vh] w-full min-h-0 flex-shrink-0 flex-col rounded-t-xl border meeting-panel-surface fixed bottom-12 left-0 right-0 sm:static sm:bottom-auto sm:left-auto sm:right-auto sm:z-auto sm:max-h-none sm:h-full sm:w-80 lg:w-96 sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-none"
      data-no-translate="true"
    >
      <PanelTabs />

      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          <span className="text-sm font-medium">
            {humanParticipants.length} participant{humanParticipants.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-no-translate="true">
        {humanParticipants.map((p) => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            meetingId={meetingId}
            isLocalHost={isHost}
            localIdentity={localIdentity}
          />
        ))}
        {humanParticipants.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No participants yet</p>
        )}
      </div>

      {isHost && humanParticipants.length > 1 && (
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={handleMuteAll}
            disabled={muteAllBusy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {muteAllBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <VolumeX className="h-4 w-4" />}
            Mute all
          </button>
        </div>
      )}
    </div>
  );
}
