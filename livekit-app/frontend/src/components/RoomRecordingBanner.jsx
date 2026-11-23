import { useRoomContext } from '@livekit/components-react';
import { Loader2, Radio } from 'lucide-react';
import { formatRecordingClock, useRoomRecordingState } from '../hooks/useRoomAudioRecorder';

export default function RoomRecordingBanner() {
  const room = useRoomContext();
  const state = useRoomRecordingState(room);

  if (!state.isRecording && !state.isUploading) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-destructive/40 bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">
        {state.isUploading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Saving MP3 &amp; refining transcript…</span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
            <Radio className="h-3.5 w-3.5 text-destructive" />
            <span>
              Recording{state.recordingBy ? ` · ${state.recordingBy}` : ''}
            </span>
            {state.elapsedSeconds > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatRecordingClock(state.elapsedSeconds)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
