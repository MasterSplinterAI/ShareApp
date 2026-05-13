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
        {isServerMuted && <MicOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0" aria-hidden />}
        {!isServerMuted && micPub && <Mic className="w-3.5 h-3.5 text-emerald-400/80 flex-shrink-0" aria-hidden />}

        {isLocalHost && !isSelf && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isServerMuted ? (
              <button
                type="button"
                onClick={() => setRemoteMicMuted(false)}
                disabled={!!busy}
                className="rounded-md bg-secondary p-1.5 text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
                title={`Unmute ${name}`}
              >
                {busy === 'unmute' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRemoteMicMuted(true)}
                disabled={!!busy}
                className="rounded-md bg-secondary p-1.5 text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
                title={`Mute ${name}`}
              >
                {busy === 'mute' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleRemove}
              disabled={!!busy}
              className="rounded-md bg-destructive/80 p-1.5 text-destructive-foreground transition-colors hover:bg-destructive disabled:opacity-50"
              title={`Remove ${name}`}
            >
              {busy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
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
    <div className="flex h-full w-80 flex-shrink-0 flex-col border-l border-border bg-card sm:w-96">
      <PanelTabs />

      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          <span className="text-sm font-medium">
            {humanParticipants.length} participant{humanParticipants.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
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
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
          >
            {muteAllBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <VolumeX className="w-4 h-4" />}
            Mute all
          </button>
        </div>
      )}
    </div>
  );
}
