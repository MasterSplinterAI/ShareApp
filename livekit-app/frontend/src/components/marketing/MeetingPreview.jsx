import { Mic, Video, MonitorUp, MessageSquare, Users, Phone, Subtitles } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/I18nProvider';

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

/** CSS + static assets product mock for marketing hero — mirrors in-room screen-share layout. */
export function MeetingPreview() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto mt-14 max-w-5xl px-2 sm:mt-20">
      <div className="relative mx-auto w-full max-w-4xl -rotate-1 transition-transform duration-500 hover:rotate-0 sm:-rotate-2">
        <div className="relative flex aspect-[16/9] w-full flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl ring-1 ring-black/5 sm:rounded-2xl">
          {/* Window chrome */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 sm:px-4">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
            <span className="ml-2 truncate text-[10px] font-medium text-muted-foreground sm:text-xs">
              {t('meetingPreview.windowTitle')}
            </span>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col sm:flex-row">
            {/* Video area — screen share + participant filmstrip (matches VideoGrid) */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/25">
              <div className="relative min-h-0 flex-1">
                <ScreenShareTile presentingLabel={t('meetingPreview.presenting')} />
              </div>
              <div className="flex h-[4.5rem] shrink-0 gap-1.5 overflow-x-auto border-t border-border/60 bg-background/60 p-1.5 sm:h-24 sm:gap-2 sm:p-2">
                <VideoTile
                  compact
                  label="Kenny (Host)"
                  sub="Camera · EN"
                  image="/marketing/hero-kenny.jpg"
                  fallback="from-sky-200 to-slate-300"
                />
                <VideoTile
                  compact
                  label="María"
                  sub="Translated · ES"
                  image="/marketing/hero-maria.jpg"
                  fallback="from-violet-200 to-slate-300"
                  badge="ES"
                />
                <VideoTile
                  compact
                  label="Yuki"
                  sub="Camera · JA"
                  fallback="from-emerald-200 to-slate-300"
                  badge="JA"
                />
              </div>
            </div>

            {/* Side panel: captions + chat peek */}
            <div className="flex h-28 min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-border/60 bg-background shadow-sm sm:h-auto sm:w-[11rem] sm:border-l sm:border-t-0 lg:w-[13rem]">
              <div className="flex items-center gap-1 border-b border-border/50 px-2 py-1.5 text-[9px] sm:text-[10px]">
                <span className="flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
                  <Subtitles className="h-3 w-3" />
                  {t('meetingPreview.captions')}
                </span>
                <span className="rounded-md px-1.5 py-0.5 text-muted-foreground">{t('meetingPreview.chat')}</span>
                <span className="rounded-md px-1.5 py-0.5 text-muted-foreground">{t('meetingPreview.people')}</span>
              </div>
              <p className="border-b border-border/40 bg-primary/5 px-2 py-1 text-[9px] font-medium text-primary sm:text-[10px]">
                {t('meetingPreview.translating')}
              </p>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 text-[9px] leading-snug sm:text-[10px]">
                {TRANSCRIPT.map((line) => (
                  <div key={`${line.speaker}-${line.original.slice(0, 12)}`} className="space-y-0.5">
                    <p className={line.highlight ? 'rounded-md bg-primary/10 px-1.5 py-1' : ''}>
                      <span className="font-semibold text-primary">{line.speaker}</span>
                      <span className="ml-1 text-[8px] uppercase text-muted-foreground">{line.lang}</span>
                      <span className="text-foreground">: {line.original}</span>
                    </p>
                    {line.translated && <p className="pl-2 text-muted-foreground">{line.translated}</p>}
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
          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/80 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur-sm sm:bottom-3 sm:gap-2 sm:px-3">
            <ControlIcon active icon={Mic} />
            <ControlIcon icon={Video} />
            <ControlIcon icon={MonitorUp} active />
            <ControlIcon icon={MessageSquare} />
            <ControlIcon icon={Users} />
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground sm:h-9 sm:w-9">
              <Phone className="h-3.5 w-3.5 rotate-[135deg] sm:h-4 sm:w-4" />
            </span>
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">{t('meetingPreview.footnote')}</p>
    </div>
  );
}

function ControlIcon({ icon: Icon, active = false }) {
  return (
    <span
      className={`flex h-8 w-8 items-center justify-center rounded-full sm:h-9 sm:w-9 ${
        active ? 'bg-emerald-600 text-white' : 'bg-muted text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
    </span>
  );
}

function VideoTile({ label, sub, image, fallback, badge, compact = false }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-border/50 shadow-sm ${
        compact ? 'aspect-video h-full w-[5.5rem] shrink-0 sm:w-40' : 'aspect-video w-full'
      }`}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <div className={`absolute inset-0 bg-gradient-to-br ${fallback} ${image ? 'opacity-40' : 'opacity-95'}`} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
      {badge && (
        <span className="absolute right-1 top-1 rounded bg-primary/90 px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
          {badge}
        </span>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-1 text-[8px] text-white sm:p-1.5 sm:text-[9px]">
        <span className="block truncate font-medium drop-shadow-sm">{label}</span>
        {!compact && <span className="block truncate text-white/80">{sub}</span>}
      </div>
    </div>
  );
}

function ScreenShareTile({ presentingLabel }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#f1f5f9_0%,#e2e8f0_100%)]" />
      {/* Mock slide — centered like object-contain screen share */}
      <div className="absolute inset-2 flex items-center justify-center sm:inset-3">
        <div className="flex h-full max-h-full w-full max-w-[92%] flex-col rounded border border-border/60 bg-white p-2 shadow-md sm:p-3">
          <div className="mb-1 h-1 w-10 rounded bg-sky-500/80" />
          <p className="text-[9px] font-semibold leading-tight text-slate-800 sm:text-[11px]">Q3 Rollout</p>
          <div className="mt-2 flex min-h-[3rem] flex-1 items-end gap-1 sm:min-h-[4rem]">
            {[40, 65, 50, 80, 72].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-sky-500/70" style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="mt-1 text-[7px] text-slate-500 sm:text-[8px]">Screen share · Kenny</p>
        </div>
      </div>
      <div className="absolute bottom-2 left-2 rounded-md border border-border/60 bg-background/90 px-2 py-0.5 text-[9px] text-foreground shadow-sm sm:text-[10px]">
        {presentingLabel}
      </div>
    </div>
  );
}
