import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Volume2 } from 'lucide-react';
import { MarketingNav } from '../marketing/MarketingNav';
import { MarketingFooter } from '../marketing/MarketingFooter';
import { DemoCaptionPanel } from './DemoCaptionPanel';
import { DemoLiveRoom } from './DemoLiveRoom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { demoLabService } from '../../services/demoLab';

const DEFAULT_SCENARIOS = [
  {
    id: 'standup',
    title: 'Global standup',
    description: 'Weekly sync with Madrid & Tokyo.',
    participants: [
      { id: 'maria', name: 'María', defaultLang: 'es' },
      { id: 'yuki', name: 'Yuki', defaultLang: 'ja' },
    ],
  },
  {
    id: 'customer',
    title: 'Customer call',
    description: 'Prospect asks about guest links.',
    participants: [
      { id: 'ana', name: 'Ana', defaultLang: 'pt' },
      { id: 'james', name: 'James', defaultLang: 'en' },
    ],
  },
  {
    id: 'interview',
    title: 'Interview',
    description: 'HR screens a French-speaking candidate.',
    participants: [
      { id: 'sophie', name: 'Sophie', defaultLang: 'fr' },
      { id: 'marco', name: 'Marco', defaultLang: 'de' },
    ],
  },
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
  const [ttsEnabled, setTtsEnabled] = useState(false);
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
  const scenarios = config?.scenarios?.length ? config.scenarios : DEFAULT_SCENARIOS;
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
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Translation lab</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Try live translation — no signup</h1>
          <p className="mt-4 text-muted-foreground">
            Join a real meeting room with AI teammates. Your mic uses Deepgram STT — the same pipeline as
            production. Speak naturally; agents reply in their languages with live translated captions.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Scenario</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setScenarioId(s.id)}
                    className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                      scenarioId === s.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border/80 bg-card/50 hover:border-border'
                    }`}
                  >
                    <span className="font-medium text-foreground">{s.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{s.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Your name in the room</span>
              <Input
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
                maxLength={64}
                placeholder="Guest"
              />
            </label>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Room languages</p>
              <div className="space-y-2 rounded-lg border border-border/60 bg-card/30 p-3">
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

            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">I read captions in</span>
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

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ttsEnabled}
                onChange={(e) => setTtsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Volume2 className="h-4 w-4" /> Hear teammates speak (use headphones)
              </span>
            </label>

            <Button size="lg" className="w-full gap-2" disabled={starting} onClick={joinLiveRoom}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Join live demo room
            </Button>
          </div>

          <DemoCaptionPanel
            lines={[]}
            readLang={readLang}
            translatingLabel={null}
            emptyHint="After you join, speak into your mic. Captions appear here in real time — exactly like a Lalia meeting."
          />
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
          Live preview · Real Deepgram STT · LLM teammates · Rate-limited · No transcript storage
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
