import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowRight,
  Briefcase,
  Globe2,
  Loader2,
  Mic,
  Shield,
  Sparkles,
  UserCheck,
  Volume2,
  Zap,
} from 'lucide-react';
import { MarketingNav } from '../marketing/MarketingNav';
import { MarketingFooter } from '../marketing/MarketingFooter';
import { DemoPreviewPanel } from './DemoPreviewPanel';
import { DemoLiveRoom } from './DemoLiveRoom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { demoLabService } from '../../services/demoLab';

const DEFAULT_SCENARIOS = [
  {
    id: 'standup',
    title: 'Global standup',
    description: 'Weekly sync with Madrid & Tokyo.',
    icon: Globe2,
    accent: 'from-violet-500/20 to-emerald-500/10',
    participants: [
      { id: 'maria', name: 'María', defaultLang: 'es' },
      { id: 'yuki', name: 'Yuki', defaultLang: 'ja' },
    ],
  },
  {
    id: 'customer',
    title: 'Customer call',
    description: 'Prospect asks about guest links.',
    icon: Briefcase,
    accent: 'from-amber-500/20 to-sky-500/10',
    participants: [
      { id: 'ana', name: 'Ana', defaultLang: 'pt' },
      { id: 'james', name: 'James', defaultLang: 'en' },
    ],
  },
  {
    id: 'interview',
    title: 'Interview',
    description: 'HR screens a multilingual candidate.',
    icon: UserCheck,
    accent: 'from-rose-500/20 to-indigo-500/10',
    participants: [
      { id: 'sophie', name: 'Sophie', defaultLang: 'fr' },
      { id: 'marco', name: 'Marco', defaultLang: 'de' },
    ],
  },
];

const STEPS = [
  { icon: Mic, title: 'Speak naturally', body: 'Your mic uses the same Deepgram VAD/STT pipeline as production.' },
  { icon: Sparkles, title: 'AI teammates reply', body: 'María, Yuki, and others respond in their native languages.' },
  { icon: Zap, title: 'Captions translate', body: 'Everyone sees speech in their chosen read language — live.' },
];

function buildDefaultLangs(scenario, speakLang) {
  const langs = { You: speakLang };
  scenario?.participants?.forEach((p) => {
    langs[p.name] = p.defaultLang;
  });
  return langs;
}

export default function TranslationLabDemo() {
  const [config, setConfig] = useState(null);
  const [scenarioId, setScenarioId] = useState('standup');
  const [speakLang, setSpeakLang] = useState('en');
  const [readLang, setReadLang] = useState('en');
  const [participantLangs, setParticipantLangs] = useState({ You: 'en', María: 'es', Yuki: 'ja' });
  const [participantName, setParticipantName] = useState('Guest');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [starting, setStarting] = useState(false);
  const [liveRoom, setLiveRoom] = useState(null);

  const languages = config?.languages || [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ja', label: 'Japanese' },
  ];
  const scenarios = (config?.scenarios?.length ? config.scenarios : DEFAULT_SCENARIOS).map((s) => {
    const fallback = DEFAULT_SCENARIOS.find((d) => d.id === s.id);
    return { ...fallback, ...s, icon: fallback?.icon || Globe2, accent: fallback?.accent };
  });
  const maxTurns = config?.limits?.maxTurns ?? 12;
  const selectedScenario = scenarios.find((s) => s.id === scenarioId) || scenarios[0];

  useEffect(() => {
    demoLabService.config().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    setParticipantLangs(buildDefaultLangs(selectedScenario, speakLang));
  }, [scenarioId, selectedScenario, speakLang]);

  const joinLiveRoom = async () => {
    setStarting(true);
    try {
      const data = await demoLabService.createRoom({
        scenarioId,
        speakLang,
        readLang,
        participantLangs,
        participantName: participantName.trim() || 'Guest',
      });
      setLiveRoom(data);
      demoLabService.track(data.demoSessionId, 'live_room_start', { scenarioId });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start demo room');
    } finally {
      setStarting(false);
    }
  };

  const leaveRoom = () => {
    setLiveRoom(null);
  };

  if (liveRoom) {
    return (
      <DemoLiveRoom
        token={liveRoom.token}
        url={liveRoom.url}
        demoSessionId={liveRoom.demoSessionId}
        identity={liveRoom.identity}
        userDisplayName={liveRoom.displayName || participantName.trim() || 'Guest'}
        readLang={liveRoom.readLang}
        speakLang={liveRoom.speakLang}
        agents={liveRoom.agents}
        participants={liveRoom.participants}
        scenarioTitle={liveRoom.scenario?.title}
        ttsEnabled={ttsEnabled}
        maxTurns={liveRoom.maxTurns || maxTurns}
        onLeave={leaveRoom}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(var(--primary)/0.14),transparent)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.35)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Translation lab · No signup
            </p>
            <h1 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              Try live translation in a real meeting room
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Join with your mic, talk to AI teammates in different languages, and watch captions translate in
              real time — the same pipeline Lalia uses in production.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {['Deepgram STT', 'Live LLM translation', 'Pipeline TTS', 'No account'].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur-sm"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start lg:gap-12">
          {/* Setup panel */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-border/80 bg-card/80 p-5 shadow-sm backdrop-blur-sm sm:p-6">
              <h2 className="text-sm font-semibold text-foreground">Configure your demo</h2>
              <p className="mt-1 text-xs text-muted-foreground">Pick a scenario and languages, then join.</p>

              <div className="mt-5">
                <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenario</p>
                <div className="grid gap-2">
                  {scenarios.map((s) => {
                    const Icon = s.icon || Globe2;
                    const selected = scenarioId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setScenarioId(s.id)}
                        className={`group relative overflow-hidden rounded-xl border px-3.5 py-3 text-left transition-all ${
                          selected
                            ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                            : 'border-border/70 bg-background/50 hover:border-border hover:bg-muted/30'
                        }`}
                      >
                        <div
                          className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60 ${s.accent || 'from-primary/10 to-transparent'}`}
                        />
                        <div className="relative flex items-start gap-3">
                          <span
                            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <span className="block font-medium text-foreground">{s.title}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{s.description}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="mt-5 block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Your name in the room</span>
                <Input
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  maxLength={64}
                  placeholder="Guest"
                />
              </label>

              <div className="mt-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Languages</p>
                <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">You speak</span>
                    <select
                      value={participantLangs.You || speakLang}
                      onChange={(e) => {
                        setSpeakLang(e.target.value);
                        setParticipantLangs((prev) => ({ ...prev, You: e.target.value }));
                      }}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    >
                      {languages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(selectedScenario.participants || []).map((p) => (
                    <label key={p.id || p.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{p.name}</span>
                      <select
                        value={participantLangs[p.name] || p.defaultLang}
                        onChange={(e) =>
                          setParticipantLangs((prev) => ({ ...prev, [p.name]: e.target.value }))
                        }
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      >
                        {languages.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              <label className="mt-4 block text-sm">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">I read captions in</span>
                <select
                  value={readLang}
                  onChange={(e) => setReadLang(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(e) => setTtsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Volume2 className="h-4 w-4 text-primary" />
                  Hear teammates (pipeline voice translation)
                </span>
              </label>

              <Button size="lg" className="mt-6 w-full gap-2 shadow-md" disabled={starting} onClick={joinLiveRoom}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                Join live demo room
                {!starting && <ArrowRight className="ml-auto h-4 w-4 opacity-70" />}
              </Button>
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Rate-limited preview · No transcript storage · Mic permission required
            </p>
          </div>

          {/* Preview */}
          <DemoPreviewPanel
            scenarioId={scenarioId}
            readLang={readLang}
            participantLangs={participantLangs}
          />
        </div>

        {/* How it works */}
        <div className="mt-16 border-t border-border/60 pt-12">
          <h2 className="text-center text-lg font-semibold">How the demo works</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted-foreground">
            Not a scripted chatbot — a real LiveKit room with production STT and translation.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <div
                key={title}
                className="rounded-xl border border-border/60 bg-card/50 p-5 text-center shadow-sm"
              >
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Step {i + 1}
                </p>
                <h3 className="mt-1 font-medium text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="outline" asChild>
              <Link to="/v2/signup">
                Start free for your team
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
