import { Mic, Video, MonitorUp, MessageSquare, Users, Phone } from 'lucide-react';

/**
 * CSS-only product mock for marketing hero (no real video / screenshots).
 */
export function MeetingPreview() {
  return (
    <div className="mx-auto mt-14 max-w-5xl px-2 sm:mt-20">
      <div className="relative mx-auto w-full max-w-4xl -rotate-1 transition-transform duration-500 hover:-rotate-0 sm:-rotate-2">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl ring-1 ring-black/5 sm:rounded-2xl">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 sm:px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
          <span className="ml-2 truncate text-[10px] font-medium text-muted-foreground sm:text-xs">JarMetals Conference — Live</span>
        </div>

        <div className="relative grid min-h-[200px] grid-cols-1 gap-2 p-2 sm:min-h-[240px] sm:grid-cols-[1fr_11rem] sm:gap-3 sm:p-3">
          {/* Video tiles */}
          <div className="grid min-h-0 grid-cols-3 gap-2">
            <div className="flex aspect-video flex-col justify-end rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 p-2 text-[10px] text-white shadow-inner sm:text-xs">
              <span className="truncate font-medium">You</span>
              <span className="truncate text-white/60">Camera on</span>
            </div>
            <div className="flex aspect-video flex-col justify-end rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 p-2 text-[10px] text-white shadow-inner sm:text-xs">
              <span className="truncate font-medium">Guest (ES)</span>
              <span className="truncate text-white/60">Translated audio</span>
            </div>
            <div className="flex aspect-video flex-col items-center justify-center rounded-lg border border-dashed border-white/20 bg-slate-900/80 text-[10px] text-white/50 sm:text-xs">
              + Join
            </div>
          </div>

          {/* Captions strip */}
          <div className="flex flex-col justify-end gap-2 rounded-lg border border-border/60 bg-background/95 p-2 shadow-sm sm:min-h-0">
            <p className="rounded-md bg-primary/10 px-2 py-1.5 text-[10px] font-medium text-primary sm:text-xs">Translating EN → ES</p>
            <div className="space-y-1.5 rounded-md bg-muted/50 p-2 text-[10px] leading-snug text-foreground sm:text-xs">
              <p>
                <span className="font-semibold text-primary">You:</span> Let&apos;s align on the rollout timeline.
              </p>
              <p className="text-muted-foreground">
                <span className="font-semibold">ES:</span> Revisemos el cronograma del despliegue.
              </p>
            </div>
          </div>
        </div>

        {/* Faux control bar */}
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/80 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur-sm sm:gap-2 sm:px-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Mic className="h-4 w-4" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            <Video className="h-4 w-4" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            <MonitorUp className="h-4 w-4" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            <MessageSquare className="h-4 w-4" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            <Users className="h-4 w-4" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <Phone className="h-4 w-4 rotate-[135deg]" />
          </span>
        </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">Simulated interface — actual room matches this layout.</p>
    </div>
  );
}
