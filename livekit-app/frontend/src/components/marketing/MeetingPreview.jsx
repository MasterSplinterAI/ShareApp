import { Mic, Video, MonitorUp, MessageSquare, Users, Phone, Subtitles } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/I18nProvider';
import { DEFAULT_LOCALE } from '../../lib/i18n/constants';

/** Caption/chat lines — source language + translations keyed like in-room chat. */
const CAPTION_LINES = [
  {
    speaker: 'Kenny',
    sourceLang: 'en',
    originalText: "Thanks everyone — let's walk through the global rollout timeline.",
    translations: {
      es: 'Gracias a todos — repasemos la cronología del despliegue global.',
      fr: 'Merci à tous — passons en revue le calendrier de déploiement mondial.',
      de: 'Danke an alle — gehen wir den globalen Rollout-Zeitplan durch.',
      pt: 'Obrigado a todos — vamos revisar o cronograma de lançamento global.',
      ja: '皆さん、ありがとうございます。グローバル展開のタイムラインを確認しましょう。',
      'zh-CN': '谢谢大家——我们来过一遍全球推广时间表。',
    },
    highlight: true,
  },
  {
    speaker: 'María',
    sourceLang: 'es',
    originalText: 'Perfecto. ¿Cuándo empezamos el piloto en Madrid?',
    translations: {
      en: 'Perfect. When do we start the pilot in Madrid?',
      fr: 'Parfait. Quand commençons-nous le pilote à Madrid ?',
      de: 'Perfekt. Wann starten wir den Pilot in Madrid?',
      pt: 'Perfeito. Quando começamos o piloto em Madrid?',
      ja: '了解です。マドリードでのパイロットはいつ始めますか？',
      'zh-CN': '好的。马德里试点什么时候开始？',
    },
  },
  {
    speaker: 'Kenny',
    sourceLang: 'en',
    originalText: "Pilot kicks off June 16. I'll share the deck after this call.",
    translations: {
      es: 'El piloto comienza el 16 de junio. Compartiré la presentación después de esta llamada.',
      fr: 'Le pilote commence le 16 juin. Je partagerai la présentation après cet appel.',
      de: 'Der Pilot startet am 16. Juni. Ich teile die Präsentation nach dem Call.',
      pt: 'O piloto começa em 16 de junho. Compartilharei a apresentação após esta call.',
      ja: 'パイロットは6月16日開始です。この通話の後に資料を共有します。',
      'zh-CN': '试点于6月16日开始。通话结束后我会分享演示文稿。',
    },
  },
  {
    speaker: 'Yuki',
    sourceLang: 'ja',
    originalText: '資料の日本語版も必要ですか？',
    translations: {
      en: 'Do you need a Japanese version of the materials as well?',
      es: '¿También necesitan una versión en japonés de los materiales?',
      fr: 'Avez-vous aussi besoin d’une version japonaise des documents ?',
      de: 'Benötigen Sie auch eine japanische Version der Unterlagen?',
      pt: 'Vocês também precisam de uma versão em japonês dos materiais?',
      'zh-CN': '材料也需要日文版吗？',
    },
  },
  {
    speaker: 'Kenny',
    sourceLang: 'en',
    originalText: 'Yes — Lalia will caption and translate live for the APAC team.',
    translations: {
      es: 'Sí — Lalia subtitulará y traducirá en vivo para el equipo de APAC.',
      fr: 'Oui — Lalia sous-titrera et traduira en direct pour l’équipe APAC.',
      de: 'Ja — Lalia untertitelt und übersetzt live für das APAC-Team.',
      pt: 'Sim — o Lalia legendará e traduzirá ao vivo para a equipe APAC.',
      ja: 'はい — LaliaがAPACチーム向けにライブ字幕と翻訳を提供します。',
      'zh-CN': '是的——Lalia 会为 APAC 团队提供实时字幕和翻译。',
    },
  },
];

const CHAT_PEEK = {
  speaker: 'Yuki',
  sourceLang: 'ja',
  originalText: '資料を共有できますか？',
  translations: {
    en: 'Can you share the materials?',
    es: '¿Puedes compartir los materiales?',
    fr: 'Pouvez-vous partager les documents ?',
    de: 'Können Sie die Unterlagen teilen?',
    pt: 'Você pode compartilhar os materiais?',
    'zh-CN': '可以分享材料吗？',
  },
};

function normalizeViewerLocale(locale) {
  return locale || DEFAULT_LOCALE;
}

/** Match in-room chat: viewer locale primary, original source below when different. */
function getChatDisplay(line, viewerLocale) {
  const tgt = normalizeViewerLocale(viewerLocale);
  const src = line.sourceLang;

  if (src === tgt) {
    return {
      primary: line.originalText,
      secondary: null,
      sourceLang: src,
    };
  }

  const primary = line.translations[tgt] || line.originalText;
  const secondary = primary !== line.originalText ? line.originalText : null;

  return { primary, secondary, sourceLang: src };
}

function sourceLangLabel(code) {
  return (code || 'en').split('-')[0].toUpperCase();
}

/** CSS + static assets product mock for marketing hero — mirrors in-room screen-share layout. */
export function MeetingPreview() {
  const { t, locale } = useTranslation();

  return (
    <div id="preview" className="mx-auto mt-14 max-w-5xl scroll-mt-24 px-2 sm:mt-20">
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
                {CAPTION_LINES.map((line) => {
                  const { primary, secondary, sourceLang } = getChatDisplay(line, locale);
                  return (
                    <div key={`${line.speaker}-${line.originalText.slice(0, 12)}`} className="space-y-0.5">
                      <p className={line.highlight ? 'rounded-md bg-primary/10 px-1.5 py-1' : ''}>
                        <span className="font-semibold text-primary">{line.speaker}</span>
                        {secondary && (
                          <span className="ml-1 text-[8px] uppercase text-muted-foreground">
                            {sourceLangLabel(sourceLang)}
                          </span>
                        )}
                        <span className="text-foreground">: {primary}</span>
                      </p>
                      {secondary && (
                        <p className="border-t border-border/40 pl-2 pt-0.5 text-muted-foreground">{secondary}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border/50 bg-muted/30 px-2 py-1.5">
                {(() => {
                  const chat = getChatDisplay(CHAT_PEEK, locale);
                  return (
                    <div className="space-y-0.5 text-[8px] sm:text-[9px]">
                      <p className="text-foreground">
                        <span className="font-medium">Chat · {CHAT_PEEK.speaker}:</span> {chat.primary}
                      </p>
                      {chat.secondary && (
                        <p className="text-muted-foreground">{chat.secondary}</p>
                      )}
                    </div>
                  );
                })()}
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
      <picture>
        <source srcSet="/marketing/hero-screenshare.webp" type="image/webp" />
        <img
          src="/marketing/hero-screenshare.png"
          alt=""
          className="absolute inset-0 h-full w-full object-contain bg-slate-100 p-1 sm:p-2"
          loading="lazy"
          decoding="async"
          width={1600}
          height={1067}
        />
      </picture>
      <div className="absolute bottom-2 left-2 rounded-md border border-border/60 bg-background/90 px-2 py-0.5 text-[9px] text-foreground shadow-sm sm:text-[10px]">
        {presentingLabel}
      </div>
    </div>
  );
}
