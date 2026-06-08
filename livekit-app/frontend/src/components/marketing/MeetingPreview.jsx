import { Mic, Video, MonitorUp, MessageSquare, Users, Phone, Subtitles } from 'lucide-react';

const TRANSCRIPT = [
  {
    speaker: 'Kenny',
    lang: 'EN',
    original: "Thanks everyone — let's walk through the Q3 rollout timeline.",
    translated: null,
    highlight: true,
  },
  {
    speaker: 'María',
    lang: 'ES',
    original: 'Perfecto. ¿Cuándo empezamos el piloto en Madrid?',
    translated: 'Perfect. When do we start the pilot in Madrid?',
  },
  {
    speaker: 'Kenny',
    lang: 'EN',
    original: "Pilot kicks off June 16. I'll share the deck after this call.",
    translated: 'El piloto comienza el 16 de junio. Compartiré la presentación después de esta llamada.',
  },
  {
    speaker: 'Yuki',
    lang: 'JA',
    original: '資料の日本語版も必要ですか？',
    translated: 'Do you need a Japanese version of the materials as well?',
  },
  {
    speaker: 'Kenny',
    lang: 'EN',
    original: 'Yes — Parley will caption and translate live for the APAC team.',
    translated: 'Sí — Parley subtitulará y traducirá en vivo para el equipo de APAC.',
  },
];

/** CSS + static assets product mock for marketing hero. */
export function MeetingPreview() {
  return (
    <div className="mx-auto mt-14 max-w-5xl px-2 sm:mt-20">
      <div className="relative mx-auto w-full max-w-4xl -rotate-1 transition-transform duration-500 hover:rotate-0 sm:-rotate-2">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl ring-1 ring-black/5 sm:rounded-2xl">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 sm:px-4">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
            <span className="ml-2 truncate text-[10px] font-medium text-muted-foreground sm:text-xs">
              Parley — Q3 rollout · Live captions ON
            </span>
          </div>

          <div className="relative grid min-h-[220px] grid-cols-1 gap-2 p-2 pb-14 sm:min-h-[280px] sm:grid-cols-[1fr_12rem] sm:gap-3 sm:p-3 sm:pb-16 lg:grid-cols-[1fr_14rem]">
            {/* Video area */}
            <div className="grid min-h-0 grid-cols-3 gap-1.5 sm:gap-2">
              <VideoTile
                label="Kenny (Host)"
                sub="Camera · EN"
                image="/marketing/hero-kenny.jpg"
                fallback="from-sky-700 to-slate-900"
              />
              <VideoTile
                label="María"
                sub="Translated · ES"
                image="/marketing/hero-maria.jpg"
                fallback="from-violet-700 to-slate-900"
                badge="ES"
              />
              <ScreenShareTile />
            </div>

            {/* Side panel: captions + chat peek */}
            <div className="flex min-h-[120px] flex-col overflow-hidden rounded-lg border border-border/60 bg-background/95 shadow-sm sm:min-h-0">
              <div className="flex items-center gap-1 border-b border-border/50 px-2 py-1.5 text-[9px] sm:text-[10px]">
                <span className="flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
                  <Subtitles className="h-3 w-3" />
                  Captions
                </span>
                <span className="rounded-md px-1.5 py-0.5 text-muted-foreground">Chat</span>
                <span className="rounded-md px-1.5 py-0.5 text-muted-foreground">People</span>
              </div>
              <p className="border-b border-border/40 bg-primary/5 px-2 py-1 text-[9px] font-medium text-primary sm:text-[10px]">
                Translating EN → ES, JA
              </p>
              <div className="flex-1 space-y-2 overflow-y-auto p-2 text-[9px] leading-snug sm:text-[10px]">
                {TRANSCRIPT.map((line) => (
                  <div key={`${line.speaker}-${line.original.slice(0, 12)}`} className="space-y-0.5">
                    <p className={line.highlight ? 'rounded-md bg-primary/10 px-1.5 py-1' : ''}>
                      <span className="font-semibold text-primary">{line.speaker}</span>
                      <span className="ml-1 text-[8px] uppercase text-muted-foreground">{line.lang}</span>
                      <span className="text-foreground">: {line.original}</span>
                    </p>
                    {line.translated && (
                      <p className="pl-2 text-muted-foreground">{line.translated}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-border/50 bg-muted/30 px-2 py-1.5">
                <p className="text-[8px] text-muted-foreground sm:text-[9px]">
                  <span className="font-medium text-foreground">Chat · Yuki:</span> 資料を共有できますか？
                </p>
              </div>
            </div>
          </div>

          {/* Control bar */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/80 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur-sm sm:gap-2 sm:px-3">
            <ControlIcon active icon={Mic} />
            <ControlIcon icon={Video} />
            <ControlIcon icon={MonitorUp} active />
            <ControlIcon icon={MessageSquare} />
            <ControlIcon icon={Users} />
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
              <Phone className="h-4 w-4 rotate-[135deg]" />
            </span>
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Simulated room — live captions, translation, chat, and screen share in one view.
      </p>
    </div>
  );
}

function ControlIcon({ icon: Icon, active = false }) {
  return (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-full ${
        active ? 'bg-emerald-600 text-white' : 'bg-muted text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function VideoTile({ label, sub, image, fallback, badge }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg shadow-inner">
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      <div className={`absolute inset-0 bg-gradient-to-br ${fallback} opacity-30`} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      {badge && (
        <span className="absolute right-1 top-1 rounded bg-primary/90 px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
          {badge}
        </span>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-1.5 text-[9px] text-white sm:text-[10px]">
        <span className="block truncate font-medium">{label}</span>
        <span className="block truncate text-white/70">{sub}</span>
      </div>
    </div>
  );
}

function ScreenShareTile() {
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-sky-500/40 bg-slate-950 shadow-inner">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_100%)]" />
      {/* Mock slide */}
      <div className="absolute inset-1.5 flex flex-col rounded border border-white/10 bg-white p-1.5 sm:inset-2 sm:p-2">
        <div className="mb-1 h-1 w-8 rounded bg-sky-500/80" />
        <p className="text-[7px] font-semibold leading-tight text-slate-800 sm:text-[8px]">Q3 Rollout</p>
        <div className="mt-1 flex flex-1 items-end gap-0.5">
          {[40, 65, 50, 80, 72].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-sky-500/70"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <p className="mt-0.5 text-[6px] text-slate-500 sm:text-[7px]">Screen share · Kenny</p>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 text-[9px] text-white sm:text-[10px]">
        <span className="font-medium">Deck — screen</span>
      </div>
    </div>
  );
}
