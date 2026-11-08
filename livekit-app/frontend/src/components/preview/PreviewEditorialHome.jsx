import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileText,
  Globe2,
  Lock,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  Users,
  Volume2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { PricingTable } from '../marketing/PricingTable';
import { FAQ } from '../marketing/FAQ';
import LaliaSupportLauncher from '../../v2/components/LaliaSupportLauncher';
import {
  EditorialConversionBand,
  EditorialFooter,
  EditorialNav,
  EditorialPreviewBar,
} from './EditorialChrome';
import {
  DirectCallAndQrIllustration,
  LanguageBridgeIllustration,
  VoiceBubblesIllustration,
} from './EditorialIllustrations';
import { JOURNAL_ARTICLES } from './journalArticles';

const EDITORIAL_FONT_STYLE = {
  fontFamily: "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const HEADING_FONT_STYLE = {
  fontFamily: "'Manrope', 'Inter', sans-serif",
};

const REAL_WORLD_SCENARIOS = [
  {
    eyebrow: 'CLIENT & SALES CALLS',
    title: 'First introductions where nobody holds back a question.',
    body: 'A prospect in São Paulo or Lyon can ask detailed questions in their own language and hear your answer in theirs—without a third party relaying every sentence.',
    languages: 'English ↔ Português / Français',
  },
  {
    eyebrow: 'SUPPLIERS & OPERATIONS',
    title: 'Ten-minute shipping and spec checks that happen today.',
    body: 'When a delivery date or part specification changes, ring your factory or logistics partner directly. Confirm the numbers aloud, read the bilingual caption, and move on.',
    languages: 'English ↔ Español / 中文',
  },
  {
    eyebrow: 'DISTRIBUTED TEAMS',
    title: 'Weekly standups where every office speaks at full speed.',
    body: 'Engineers and regional leads speak the language they think best in while teammates listen and read in their own language lane.',
    languages: '30+ languages in one room',
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Ring a contact in 1 tap, or share a guest link / QR code',
    body: 'Call a saved contact directly like WhatsApp or FaceTime (with native iOS CallKit ringing), or open a meeting room where guests join in Safari or Chrome with zero install.',
  },
  {
    step: '02',
    title: 'Everyone picks the language they want to speak and hear',
    body: 'Each person chooses their own language lane on the pre-join screen. There is no single “meeting language” everyone has to struggle through.',
  },
  {
    step: '03',
    title: 'Speak naturally—listen to the voice translation and read along',
    body: 'Lalia translates speech in real time with smart audio ducking and live bilingual captions, so you can listen for flow and glance at the screen to verify names and numbers.',
  },
  {
    step: '04',
    title: 'Leave with the same reviewed summary and action items',
    body: 'When transcript storage is enabled for a meeting, generate an AI executive summary, action list, or decisions report and email it to participants in one click.',
  },
];

export default function PreviewEditorialHome() {
  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      style={EDITORIAL_FONT_STYLE}
    >
      <EditorialPreviewBar />
      <EditorialNav />

      <main>
        {/* 1. Magazine Editorial Hero */}
        <section className="relative overflow-hidden border-b border-slate-200/80 py-16 sm:py-24 dark:border-slate-800">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                  MEETINGS WITHOUT BORDERS
                </p>
                <h1
                  className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white"
                  style={{ ...HEADING_FONT_STYLE, lineHeight: 1.06 }}
                >
                  A little less distance.
                  <span className="mt-1.5 block text-blue-600 dark:text-blue-400">
                    Your voice, their language, the same conversation.
                  </span>
                </h1>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                  A client has a question. A supplier has an update. Your team needs to make a decision. Speak in your own language and be understood in theirs—with live spoken translation, bilingual captions, and shared follow-up notes.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Button
                    asChild
                    size="lg"
                    className="h-12 gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
                  >
                    <Link to="/v2/signup">
                      Start talking for free
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-12 rounded-xl border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Link to="/demo">Try the live voice demo</Link>
                  </Button>
                  <a
                    href="#pricing"
                    className="px-2 py-2 text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white"
                  >
                    Compare plans →
                  </a>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-200/80 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    30+ languages live
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    Guests join in browser (no install)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    60 free min/mo · No card required
                  </span>
                </div>
              </div>

              {/* Right Column: Live CSS Product Illustration */}
              <div>
                <VoiceBubblesIllustration
                  youSayLang="ENGLISH · YOU SAY"
                  youSayText="Let’s walk through the updated delivery schedule for Thursday."
                  theyHearLang="ESPAÑOL · THEY HEAR"
                  theyHearText="Repasemos el calendario de entrega actualizado para el jueves."
                  caption="Spoken translation + live bilingual captions in real time"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 2. Editorial Pull-Statement & Dual Mode (Call vs Meeting Room) */}
        <section className="border-b border-slate-200/80 bg-white py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-end justify-between gap-6 border-b border-slate-200/80 pb-10 lg:grid-cols-[1.2fr_0.8fr] dark:border-slate-800">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                  TWO WAYS TO MEET
                </p>
                <h2
                  className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-white"
                  style={{ ...HEADING_FONT_STYLE, lineHeight: 1.12 }}
                >
                  A conversation shouldn’t become a scheduling project.
                  <span className="mt-1 block text-blue-600 dark:text-blue-400">
                    Call in one tap, or open a room for the whole group.
                  </span>
                </h2>
              </div>
              <p className="text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
                Whether you need a quick five-minute check-in with one person or a scheduled walkthrough with guests on three continents, Lalia fits the way you already talk.
              </p>
            </div>

            <div className="mt-10">
              <DirectCallAndQrIllustration />
            </div>

            {/* 3 Core Experience Pillars */}
            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-6 dark:border-slate-800 dark:bg-slate-900">
                <Volume2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3
                  className="mt-4 text-lg font-bold text-slate-900 dark:text-white"
                  style={HEADING_FONT_STYLE}
                >
                  Hear and read at the same time
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Listen to natural translated speech with automatic audio ducking, while live bilingual captions let you double-check names, dates, and phrasing on screen.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-6 dark:border-slate-800 dark:bg-slate-900">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3
                  className="mt-4 text-lg font-bold text-slate-900 dark:text-white"
                  style={HEADING_FONT_STYLE}
                >
                  No app required for guests
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Anyone you invite can join directly in mobile or desktop Safari/Chrome via link or QR code. Or install the iOS/Android app to get lock-screen call rings.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-6 dark:border-slate-800 dark:bg-slate-900">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3
                  className="mt-4 text-lg font-bold text-slate-900 dark:text-white"
                  style={HEADING_FONT_STYLE}
                >
                  Keep the clarity after the call
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  When transcript storage is enabled, Lalia generates an AI executive summary, action items, or decisions report you can review and email in one click.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Scenario-Led Use Cases ("MOMENTS THAT MATTER") */}
        <section
          id="moments"
          className="scroll-mt-20 border-b border-slate-200/80 bg-slate-50 py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-950"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                WHERE IT FITS
              </p>
              <h2
                className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-white"
                style={{ ...HEADING_FONT_STYLE, lineHeight: 1.12 }}
              >
                Built for the conversations that keep work moving.
                <span className="mt-1 block text-blue-600 dark:text-blue-400">
                  Not just the once-a-year boardroom event.
                </span>
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300">
                Most cross-language conversations aren’t formal ceremonies—they are the everyday check-ins that get delayed when language feels like a hurdle.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {REAL_WORLD_SCENARIOS.map((sc) => (
                <div
                  key={sc.eyebrow}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
                      {sc.eyebrow}
                    </span>
                    <h3
                      className="mt-3 text-xl font-bold text-slate-900 dark:text-white"
                      style={HEADING_FONT_STYLE}
                    >
                      {sc.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {sc.body}
                    </p>
                  </div>
                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <span>{sc.languages}</span>
                    <span className="text-[11px] italic">Illustrative scenario</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Honest Self-Limiting Trust Block */}
            <div className="mt-10 rounded-2xl border border-blue-200/80 bg-blue-50/70 p-6 sm:p-8 dark:border-blue-500/30 dark:bg-blue-950/30">
              <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                    <ShieldCheck className="h-4 w-4" />
                    HONEST GUIDANCE · WHEN TO BOOK AN INTERPRETER
                  </div>
                  <h3
                    className="mt-2 text-xl font-bold text-slate-900 dark:text-white"
                    style={HEADING_FONT_STYLE}
                  >
                    Save the human interpreter for the moments that truly need one.
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    Lalia is built for everyday business and personal conversations. Courtroom proceedings, medical consultations, safety-critical briefings, and regulated negotiations may still call for a certified human interpreter. We wrote a practical guide to help your team choose the right support for every meeting.
                  </p>
                </div>
                <Button
                  asChild
                  variant="outline"
                  className="shrink-0 gap-2 border-blue-300 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:bg-slate-900 dark:text-blue-300"
                >
                  <Link to="/preview/blog/interpreter-or-live-ai-translation">
                    Read the 10-meeting decision guide
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* 4. How It Works (Step-by-Step + Language Bridge Art) */}
        <section
          id="how-it-works"
          className="scroll-mt-20 border-b border-slate-200/80 bg-white py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                  HOW A TRANSLATED CALL WORKS
                </p>
                <h2
                  className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl dark:text-white"
                  style={{ ...HEADING_FONT_STYLE, lineHeight: 1.12 }}
                >
                  Simple enough for a five-minute check-in.
                  <span className="mt-1 block text-blue-600 dark:text-blue-400">
                    Structured enough for a client presentation.
                  </span>
                </h2>
                <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300">
                  No plugins to configure and no separate interpreter channel to coordinate.
                </p>

                <div className="mt-8">
                  <LanguageBridgeIllustration compact />
                </div>

                {/* Privacy reassurance box */}
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <div>
                    <strong className="text-slate-900 dark:text-white">Private by design:</strong> Lalia does not record meeting audio or video. Captions and translation are processed live, transcript storage is opt-in per meeting, and your conversations are never used to train Lalia’s own models.
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {HOW_IT_WORKS_STEPS.map((s) => (
                  <div
                    key={s.step}
                    className="rounded-2xl border border-slate-200/90 bg-slate-50/70 p-6 transition-colors hover:border-blue-300 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/10 font-mono text-xs font-bold text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                        {s.step}
                      </span>
                      <h3
                        className="text-base font-bold text-slate-900 sm:text-lg dark:text-white"
                        style={HEADING_FONT_STYLE}
                      >
                        {s.title}
                      </h3>
                    </div>
                    <p className="mt-2.5 pl-11 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {s.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 5. Featured from the Lalia Journal */}
        <section className="border-b border-slate-200/80 bg-slate-50 py-20 sm:py-24 dark:border-slate-800 dark:bg-slate-950">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-6 dark:border-slate-800">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                  FROM THE LALIA JOURNAL
                </p>
                <h2
                  className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white"
                  style={HEADING_FONT_STYLE}
                >
                  Practical guides for teams meeting across languages.
                </h2>
              </div>
              <Link
                to="/preview/blog"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                Explore all stories in the Journal
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {JOURNAL_ARTICLES.map((post) => (
                <Link
                  key={post.slug}
                  to={`/preview/blog/${post.slug}`}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
                        {post.eyebrow}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {post.readMinutes} min
                      </span>
                    </div>
                    <h3
                      className="mt-3 text-xl font-bold leading-snug text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400"
                      style={HEADING_FONT_STYLE}
                    >
                      {post.h1Line1}{' '}
                      <span className="text-slate-600 dark:text-slate-300">{post.h1Line2}</span>
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {post.deck}
                    </p>
                  </div>

                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-blue-600 dark:border-slate-800 dark:text-blue-400">
                    <span>Read the story</span>
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 6. Existing Pricing Table & FAQ (Preserving all real product plan tiers & FAQs) */}
        <PricingTable />
        <FAQ />

        {/* 7. Closing Editorial Conversion Band */}
        <EditorialConversionBand />
      </main>

      <EditorialFooter />
      <LaliaSupportLauncher audience="public" />
    </div>
  );
}
