import { useRef, useState } from 'react';
import { Download, Headphones, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { resolveApiBaseUrl } from '../../lib/nativePlatform';
import { v2Meetings } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';

const SPEEDS = [1, 1.25, 1.5, 2];

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveMediaUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const apiBase = resolveApiBaseUrl().replace(/\/api\/?$/, '').replace(/\/$/, '');
  return `${apiBase}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export default function MeetingAudioPlayer({
  recording,
  meetingId = null,
  canManageMeeting = false,
  onRefined,
}) {
  const audioRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [refining, setRefining] = useState(false);

  if (!recording?.streamUrl) return null;

  const streamHref = resolveMediaUrl(recording.streamUrl);
  const downloadHref = resolveMediaUrl(recording.downloadUrl || `${recording.streamUrl}&download=1`);
  const durationLabel = formatDuration(recording.duration_seconds);
  const sizeLabel = formatBytes(recording.size_bytes);

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  };

  const handleRefineTranscript = async () => {
    if (!meetingId || refining) return;
    setRefining(true);
    try {
      const res = await v2Meetings.refineTranscriptFromRecording(meetingId);
      const ref = res?.refinement;
      if (ref?.updatedCount > 0) {
        toast.success(`Updated ${ref.updatedCount} transcript line${ref.updatedCount === 1 ? '' : 's'} using MP3 audio`);
      } else if (ref?.insertedCount > 0) {
        toast.success(`Populated ${ref.insertedCount} speaker line${ref.insertedCount === 1 ? '' : 's'} from MP3 audio`);
      } else {
        toast.success('Transcript already matches the MP3 recording');
      }
      await onRefined?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to refine transcript from recording');
    } finally {
      setRefining(false);
    }
  };

  return (
    <Card className="app-card border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card to-card">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Headphones className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Meeting audio recording</h3>
              <p className="text-xs text-muted-foreground">
                {[durationLabel, sizeLabel].filter(Boolean).join(' · ') || 'Full session audio'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cycleSpeed}
              className="h-8 px-2.5 font-mono text-xs"
              title="Playback speed"
            >
              {speed}×
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <a href={downloadHref} download>
                <Download className="h-3.5 w-3.5" />
                Download MP3
              </a>
            </Button>
            {canManageMeeting && meetingId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRefineTranscript}
                disabled={refining}
                className="h-8 gap-1.5 text-xs"
                title="Run xAI batch speech-to-text on the saved MP3 to clean up and improve transcript accuracy"
              >
                {refining ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                )}
                {refining ? 'Refining…' : 'Refine transcript'}
              </Button>
            )}
          </div>
        </div>

        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={streamHref}
          onPlay={() => {
            if (audioRef.current) audioRef.current.playbackRate = speed;
          }}
          className="h-10 w-full rounded-lg"
        />
      </CardContent>
    </Card>
  );
}
