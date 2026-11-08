import { Globe2, Phone, QrCode, ShieldCheck, Sparkles, Volume2 } from 'lucide-react';

/**
 * On-brand CSS/HTML product illustrations in Lalia's Slate & Royal Blue palette.
 * Zero stock photos, zero external image requests, full dark-mode support, accessible via role="img".
 */

export function VoiceBubblesIllustration({
  youSayLang = 'ENGLISH · YOU SAY',
  youSayText = 'We can ship the first order on Thursday, once packaging is approved.',
  theyHearLang = 'ESPAÑOL · THEY HEAR',
  theyHearText = 'Podemos enviar el primer pedido el jueves, una vez aprobado el empaque.',
  caption = 'Live voice translation + bilingual captions in 30+ languages',
  compact = false,
}) {
  const bars = [28, 52, 84, 44, 96, 68, 36, 78, 92, 50, 64, 34, 72, 46, 30];

  return (
    <div
      role="img"
      aria-label={`Product illustration showing spoken translation: ${youSayText} translated to ${theyHearText}`}
      className={`relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-blue-50/60 to-slate-100/90 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900/95 dark:to-blue-950/40 ${
        compact ? 'p-5 sm:p-6' : 'p-6 sm:p-8'
      }`}
    >
      {/* Subtle radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-500/10"
      />

      <div className="relative mx-auto max-w-xl space-y-4">
        {/* Top bubble: YOU SAY */}
        <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/90">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500" />
              {youSayLang}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Original mic
            </span>
          </div>
          <p className={`mt-2 font-medium text-slate-900 dark:text-slate-100 ${compact ? 'text-sm' : 'text-base sm:text-lg'}`}>
            “{youSayText}”
          </p>
        </div>

        {/* Center waveform bridge */}
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
              <Volume2 className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold tracking-tight text-blue-700 dark:text-blue-400">
              Real-time voice &amp; caption stream
            </span>
          </div>
          <div className="flex items-end gap-1" aria-hidden="true">
            {bars.map((h, i) => (
              <span
                key={i}
                style={{ height: `${Math.round((h / 100) * 22)}px` }}
                className={`w-1 rounded-full ${
                  i % 3 === 0
                    ? 'bg-blue-600 dark:bg-blue-400'
                    : i % 2 === 0
                      ? 'bg-blue-400 dark:bg-blue-500/80'
                      : 'bg-slate-300 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Bottom bubble: THEY HEAR */}
        <div className="rounded-2xl border border-blue-300/80 bg-blue-50/90 p-4 shadow-sm backdrop-blur-sm dark:border-blue-500/40 dark:bg-blue-950/50">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
              <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
              {theyHearLang}
            </span>
            <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
              Spoken + captioned
            </span>
          </div>
          <p className={`mt-2 font-medium text-slate-900 dark:text-white ${compact ? 'text-sm' : 'text-base sm:text-lg'}`}>
            «{theyHearText}»
          </p>
        </div>

        {caption && (
          <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{caption}</span>
            <span className="font-mono uppercase tracking-wider opacity-75">LALIA LIVE</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function LanguageBridgeIllustration({
  leftLang = 'English',
  leftQuote = '“Let’s build something together.”',
  rightLang = 'Español',
  rightQuote = '«Construyamos algo juntos.»',
  caption = 'Your voice. Their language. The same conversation.',
  compact = false,
}) {
  return (
    <div
      role="img"
      aria-label={`Illustration bridging ${leftLang} and ${rightLang} speakers in one shared conversation`}
      className={`relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-blue-50/50 to-slate-100 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/40 ${
        compact ? 'p-5 sm:p-6' : 'p-6 sm:p-8'
      }`}
    >
      <div className="relative mx-auto max-w-2xl space-y-5">
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
          {/* Speaker A */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-800">
                EN
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Speaker A</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{leftLang}</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{leftQuote}</p>
          </div>

          {/* Center Bridge Node */}
          <div className="flex flex-col items-center justify-center gap-1 py-1">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-600/20">
              <Globe2 className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
              Live Bridge
            </span>
          </div>

          {/* Speaker B */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 shadow-sm dark:border-blue-500/30 dark:bg-blue-950/40">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                ES
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  Speaker B
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{rightLang}</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">{rightQuote}</p>
          </div>
        </div>

        {/* Bottom caption bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-2.5 text-xs text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
          <span className="font-medium">{caption}</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-blue-600 dark:text-blue-400">
            <Sparkles className="h-3.5 w-3.5" />
            No interpreter booking needed
          </span>
        </div>
      </div>
    </div>
  );
}

export function DecisionBridgeIllustration({
  leftBadge = 'QUALIFIED INTERPRETER',
  leftTitle = 'Certified, specialist, accountable',
  leftSub = 'Legal, medical, regulated & high-stakes negotiations',
  rightBadge = 'LIVE AI TRANSLATION',
  rightTitle = 'Everyday, instant, self-serve',
  rightSub = 'Check-ins, supplier updates, intros & team calls',
  caption = 'Two kinds of support. One goal: everyone understood.',
  compact = false,
}) {
  return (
    <div
      role="img"
      aria-label="Comparison illustration between booking a qualified human interpreter for high-stakes regulated meetings and using live AI translation for everyday conversations"
      className={`relative overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-blue-50/50 to-slate-100 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/40 ${
        compact ? 'p-5 sm:p-6' : 'p-6 sm:p-8'
      }`}
    >
      <div className="relative mx-auto max-w-2xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Left card: Human Interpreter */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  {leftBadge}
                </span>
                <ShieldCheck className="h-4 w-4 text-slate-600 dark:text-slate-400" />
              </div>
              <p className="mt-2.5 text-base font-bold text-slate-900 dark:text-white">{leftTitle}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{leftSub}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800/80">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Cultural mediation
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Certified settings
              </span>
            </div>
          </div>

          {/* Right card: Live AI Translation */}
          <div className="flex flex-col justify-between rounded-2xl border border-blue-300/80 bg-blue-50/90 p-5 shadow-sm dark:border-blue-500/40 dark:bg-blue-950/50">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                  {rightBadge}
                </span>
                <Volume2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="mt-2.5 text-base font-bold text-slate-900 dark:text-white">{rightTitle}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">{rightSub}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-blue-200/60 pt-3 dark:border-blue-800/50">
              <span className="rounded-md bg-blue-600/10 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
                30+ languages live
              </span>
              <span className="rounded-md bg-blue-600/10 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
                Ready in 1 tap
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white/85 px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300">
          <span>{caption}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">DECISION GUIDE</span>
        </div>
      </div>
    </div>
  );
}

export function DirectCallAndQrIllustration() {
  return (
    <div
      role="img"
      aria-label="Illustration showing 1-tap direct calling and instant browser or QR code guest join"
      className="grid gap-4 rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 p-5 sm:grid-cols-2 sm:p-6 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/30"
    >
      {/* Left: 1-tap Direct Call */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
            1-ON-1 DIRECT CALL
          </span>
          <Phone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
        <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
          Ring their phone or browser in 1 tap
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          Save a contact by email and call them like WhatsApp or FaceTime—with native iOS CallKit lock-screen ringing.
        </p>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600/15 text-xs font-bold text-blue-700 dark:text-blue-300">
              C
            </span>
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white">Carlos · Monterrey</p>
              <p className="text-[10px] text-slate-500">Español ↔ English</p>
            </div>
          </div>
          <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white">
            Ring now
          </span>
        </div>
      </div>

      {/* Right: Meeting Link & QR */}
      <div className="rounded-xl border border-blue-200/90 bg-blue-50/70 p-4 shadow-sm dark:border-blue-500/30 dark:bg-blue-950/40">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
            GROUP MEETING ROOM
          </span>
          <QrCode className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
        <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
          Share a link or scan a QR code
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
          Guests never need to install an app or create an account first—they join straight from Safari or Chrome.
        </p>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-blue-200 bg-white/90 px-3 py-2 dark:border-blue-800/60 dark:bg-slate-900/90">
          <span className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300">
            lalia.cloud/join/v2-room…
          </span>
          <span className="shrink-0 rounded-md bg-blue-600/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
            Browser / QR
          </span>
        </div>
      </div>
    </div>
  );
}

export function ArticleCoverIllustration({ variant, props = {}, compact = false }) {
  if (variant === 'decision-bridge') {
    return <DecisionBridgeIllustration {...props} compact={compact} />;
  }
  if (variant === 'language-bridge') {
    return <LanguageBridgeIllustration {...props} compact={compact} />;
  }
  return <VoiceBubblesIllustration {...props} compact={compact} />;
}
