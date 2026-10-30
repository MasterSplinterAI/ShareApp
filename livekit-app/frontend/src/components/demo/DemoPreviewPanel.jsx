import { Globe2, Languages, Mic, Sparkles, Subtitles, Users } from 'lucide-react';
import { getCaptionDisplay, sourceLangLabel } from '../../lib/captionDisplay';

const SCENARIO_PREVIEWS = {
  standup: {
    title: 'Global standup',
    participants: [
      { name: 'You', speakLang: 'en', gradient: 'from-sky-200 to-slate-300' },
      { name: 'María', speakLang: 'es', gradient: 'from-violet-200 to-slate-300' },
      { name: 'Yuki', speakLang: 'ja', gradient: 'from-emerald-200 to-slate-300' },
    ],
    lines: [
      {
        speaker: 'María',
        sourceLang: 'es',
        originalText: '¿Empezamos el piloto en Madrid el 16 de junio?',
        translations: { en: 'Do we start the Madrid pilot on June 16?' },
      },
      {
        speaker: 'You',
        sourceLang: 'en',
        originalText: "Yes — let's confirm the rollout timeline today.",
        translations: {
          es: 'Sí — confirmemos hoy la cronología del despliegue.',
          ja: 'はい — 今日展開スケジュールを確認しましょう。',
        },
        highlight: true,
      },
      {
        speaker: 'Yuki',
        sourceLang: 'ja',
        originalText: '日本語の資料も必要でしょうか？',
        translations: { en: 'Will you need Japanese materials as well?' },
      },
    ],
  },
  customer: {
    title: 'Customer call',
    participants: [
      { name: 'You', speakLang: 'en', gradient: 'from-sky-200 to-slate-300' },
      { name: 'Ana', speakLang: 'pt', gradient: 'from-amber-200 to-slate-300' },
      { name: 'James', speakLang: 'en', gradient: 'from-sky-200 to-slate-300' },
    ],
    lines: [
      {
        speaker: 'You',
        sourceLang: 'en',
        originalText: 'How do guest links work without an account?',
        translations: { pt: 'Como funcionam os links para convidados sem conta?' },
        highlight: true,
      },
      {
        speaker: 'Ana',
        sourceLang: 'pt',
        originalText: 'Os convidados entram pelo link — legendas e tradução ao vivo.',
        translations: { en: 'Guests join via link — live captions and translation.' },
      },
      {
        speaker: 'James',
        sourceLang: 'en',
        originalText: 'Security-wise, hosts control expiry and secure invite tokens.',
        translations: { pt: 'Em segurança, anfitriões controlam expiração e tokens seguros.' },
      },
    ],
  },
  interview: {
    title: 'Interview',
    participants: [
      { name: 'You', speakLang: 'en', gradient: 'from-sky-200 to-slate-300' },
      { name: 'Sophie', speakLang: 'fr', gradient: 'from-rose-200 to-slate-300' },
      { name: 'Marco', speakLang: 'de', gradient: 'from-indigo-200 to-slate-300' },
    ],
    lines: [
      {
        speaker: 'Sophie',
        sourceLang: 'fr',
        originalText: 'Comment collaborez-vous avec des équipes multilingues ?',
        translations: { en: 'How do you collaborate with multilingual teams?' },
      },
      {
        speaker: 'You',
        sourceLang: 'en',
        originalText: 'We run interviews on Lalia — video, screen share, and live translation.',
        translations: {
          fr: 'Nous faisons les entretiens sur Lalia — vidéo, partage d’écran et traduction en direct.',
          de: 'Wir führen Interviews auf Lalia — Video, Bildschirmfreigabe und Live-Übersetzung.',
        },
        highlight: true,
      },
      {
        speaker: 'Marco',
        sourceLang: 'de',
        originalText: 'Gut — jeder liest Untertitel in seiner Sprache.',
        translations: { en: 'Good — everyone reads captions in their language.' },
      },
    ],
  },
};

function langBadge(code) {
  return (code || 'en').split('-')[0].toUpperCase();
}

function PreviewTile({ participant, active }) {
  const initial = participant.name?.charAt(0) || '?';
  return (
    <div
      className={`relative aspect-video w-[5.5rem] shrink-0 overflow-hidden rounded-lg border shadow-sm sm:w-[6.5rem] ${
        active ? 'border-emerald-400 ring-2 ring-emerald-400/60' : 'border-border/50'
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${participant.gradient}`} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
      <span className="absolute left-1 top-1 rounded bg-primary/90 px-1 py-0.5 text-[7px] font-bold text-primary-foreground">
        {langBadge(participant.speakLang)}
      </span>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/20 text-sm font-semibold text-white">
          {initial}
        </span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 truncate p-1 text-[8px] font-medium text-white">
        {participant.name}
      </div>
    </div>
  );
}

export function DemoPreviewPanel({ scenarioId, readLang, participantLangs }) {
  const preview = SCENARIO_PREVIEWS[scenarioId] || SCENARIO_PREVIEWS.standup;
  const participants = preview.participants.map((p) =>
    p.name === 'You' ? { ...p, speakLang: participantLangs?.You || p.speakLang } : p
  );

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.08),transparent_70%)]" />
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
          <span className="ml-1 truncate text-xs font-medium text-muted-foreground">
            Lalia · {preview.title}
          </span>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Sparkles className="h-3 w-3" />
            Preview
          </span>
        </div>

        <div className="flex min-h-[22rem] flex-col sm:flex-row">
          <div className="flex flex-1 flex-col bg-muted/20 p-3">
            <div className="flex justify-center gap-2 overflow-x-auto pb-2">
              {participants.map((p, i) => (
                <PreviewTile key={p.name} participant={p} active={i === 0 && p.name === 'You'} />
              ))}
            </div>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
              {[
                { icon: Mic, label: 'Deepgram STT' },
                { icon: Languages, label: 'Live translation' },
                { icon: Subtitles, label: 'Per-person captions' },
                { icon: Users, label: 'AI teammates' },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-2.5 py-2 text-[10px] text-muted-foreground"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col border-t border-border/60 bg-background sm:w-[52%] sm:border-l sm:border-t-0">
            <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2 text-xs">
              <span className="flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 font-medium text-primary">
                <Subtitles className="h-3.5 w-3.5" />
                Captions
              </span>
              <span className="rounded-md px-2 py-1 text-muted-foreground">Chat</span>
            </div>
            <p className="border-b border-border/40 bg-primary/5 px-3 py-1.5 text-[10px] font-medium text-primary">
              Reading in {langBadge(readLang)} · teammate lines appear when you speak
            </p>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 text-xs leading-snug">
              {preview.lines.map((line, idx) => {
                const display = getCaptionDisplay({ ...line, readLang });
                const teammateLines =
                  line.speaker === 'You' && line.translations
                    ? Object.entries(line.translations)
                        .filter(([lang]) => lang !== readLang && lang !== line.sourceLang)
                        .map(([lang, text]) => {
                          const teammate = participants.find((p) => langBadge(p.speakLang) === langBadge(lang));
                          return { name: teammate?.name || 'Teammate', lang, text };
                        })
                    : [];
                return (
                  <div key={`${line.speaker}-${idx}`} className="space-y-1">
                    <p className={line.highlight ? 'rounded-md bg-primary/10 px-2 py-1.5' : ''}>
                      <span className="font-semibold text-primary">{line.speaker}</span>
                      {display.secondary && (
                        <span className="ml-1.5 text-[9px] uppercase text-muted-foreground">
                          {sourceLangLabel(display.sourceLang)}
                        </span>
                      )}
                      <span className="text-foreground">: {display.primary}</span>
                    </p>
                    {display.secondary && (
                      <p className="border-t border-border/40 pl-3 pt-0.5 text-muted-foreground">
                        {display.secondary}
                      </p>
                    )}
                    {teammateLines.map(({ name, lang, text }) => (
                      <p key={`${name}-${lang}`} className="pl-3 text-[10px] text-muted-foreground opacity-80">
                        <span className="font-medium text-foreground/70">{name}</span> hears [{langBadge(lang)}]:{' '}
                        {text}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
        <Globe2 className="h-3.5 w-3.5" />
        Same caption UI as a real Lalia meeting — join to try it live
      </p>
    </div>
  );
}

export { SCENARIO_PREVIEWS };
