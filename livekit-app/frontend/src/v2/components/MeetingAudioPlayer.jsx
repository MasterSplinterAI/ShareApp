import { useRef, useState } from 'react';
import { Download, Headphones } from 'lucide-react';
import { resolveApiBaseUrl } from '../../lib/nativePlatform';
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

export default function MeetingAudioPlayer({ recording }) {
  const audioRef = useRef(null);
  const [speed, setSpeed] = useState(1);

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

          <div className="flex items-center gap-2">
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
