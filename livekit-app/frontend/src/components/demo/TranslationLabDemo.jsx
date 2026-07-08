import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowRight, Loader2, RotateCcw, Volume2 } from 'lucide-react';
import { MarketingNav } from '../marketing/MarketingNav';
import { MarketingFooter } from '../marketing/MarketingFooter';
import { DemoCaptionPanel } from './DemoCaptionPanel';
import { DemoRoomStage } from './DemoRoomStage';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { demoLabService } from '../../services/demoLab';
import {
  delay,
  demoLangToSpeechLocale,
  estimateSpeechMs,
  speakDemoLineAsync,
  stopDemoSpeech,
  useDemoSpeechRecognition,
} from '../../hooks/useDemoSpeech';

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
  const [sessionId, setSessionId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [lines, setLines] = useState([]);
  const [turnsRemaining, setTurnsRemaining] = useState(null);
  const [complete, setComplete] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [turnPhase, setTurnPhase] = useState('setup');
  const [activeSpeaker, setActiveSpeaker] = useState(null);

  const turnPhaseRef = useRef('setup');
  const completeRef = useRef(false);
  const sendTurnRef = useRef(null);

  const languages = config?.languages || [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ja', label: 'Japanese' },
  ];
  const scenarios = config?.scenarios?.length ? config.scenarios : DEFAULT_SCENARIOS;
  const maxTurns = config?.limits?.maxTurns ?? 8;
  const selectedScenario = scenarios.find((s) => s.id === scenarioId) || scenarios[0];

  useEffect(() => {
    turnPhaseRef.current = turnPhase;
  }, [turnPhase]);

  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);

  useEffect(() => {
    setParticipantLangs(buildDefaultLangs(selectedScenario, speakLang));
  }, [scenarioId, selectedScenario, speakLang]);

  const handleSpeechResult = useCallback((text) => {
    if (!text) return;
    const phase = turnPhaseRef.current;
    if (phase !== 'your_turn' && phase !== 'you_speaking') return;
    setInput(text);
    sendTurnRef.current?.(text);
  }, []);

  const { supported: micSupported, listening, start: startMic, stop: stopMic } = useDemoSpeechRecognition({
    lang: demoLangToSpeechLocale(speakLang),
    onResult: handleSpeechResult,
  });

  useEffect(() => {
    demoLabService.config().then(setConfig).catch(() => {});
    return () => stopDemoSpeech();
  }, []);

  const playLine = useCallback(
    async (line) => {
      if (!line) return;
      setActiveSpeaker(line.speaker);
      if (ttsEnabled) {
        await speakDemoLineAsync(line.originalText, line.sourceLang);
      } else {
        await delay(estimateSpeechMs(line.primary || line.originalText));
      }
      setActiveSpeaker(null);
      await delay(300);
    },
    [ttsEnabled]
  );

  const playAgentSequence = useCallback(
    async (agentLines) => {
      setTurnPhase('agent_speaking');
      for (const line of agentLines) {
        setLines((prev) => [...prev, line]);
        await playLine(line);
      }
      if (!completeRef.current) {
        setTurnPhase('your_turn');
      }
    },
    [playLine]
  );

  const startSession = async () => {
    setStarting(true);
    setBusy(true);
    stopMic();
    stopDemoSpeech();
    try {
      const data = await demoLabService.startSession({
        scenarioId,
        speakLang,
        readLang,
        participantLangs,
      });
      setSessionId(data.sessionId);
      setParticipants(data.participants || []);
      setScenarioTitle(data.scenario?.title || selectedScenario.title);
      setLines([]);
      setTurnsRemaining(data.maxTurns);
      setComplete(false);
      setInput('');
      demoLabService.track(data.sessionId, 'session_start', { scenarioId });

      setTurnPhase('opening');
      if (data.openingLine) {
        setLines([data.openingLine]);
        await playLine(data.openingLine);
      }
      setTurnPhase('your_turn');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start demo');
      setTurnPhase('setup');
    } finally {
      setStarting(false);
      setBusy(false);
    }
  };

  const sendTurn = useCallback(
    async (textOverride) => {
      const text = (textOverride ?? input).trim();
      if (!sessionId || !text || completeRef.current) return;
      if (turnPhaseRef.current !== 'your_turn' && turnPhaseRef.current !== 'you_speaking') return;

      setBusy(true);
      setTurnPhase('processing');
      stopMic();
      setInput('');

      try {
        const data = await demoLabService.turn(sessionId, text);
        setLines((prev) => [...prev, data.userLine]);
        setActiveSpeaker('You');
        await delay(450);
        setActiveSpeaker(null);

        setTurnsRemaining(data.turnsRemaining);
        setComplete(Boolean(data.complete));
        demoLabService.track(sessionId, 'turn');

        const agents = data.agentLines?.length ? data.agentLines : data.botLine ? [data.botLine] : [];
        await playAgentSequence(agents);

        if (data.complete) {
          setTurnPhase('complete');
          demoLabService.track(sessionId, 'complete');
        }
      } catch (e) {
        toast.error(e.response?.data?.error || 'Demo turn failed');
        setTurnPhase('your_turn');
      } finally {
        setBusy(false);
      }
    },
    [input, sessionId, playAgentSequence]
  );

  useEffect(() => {
    sendTurnRef.current = sendTurn;
  }, [sendTurn]);

  const resetDemo = () => {
    setSessionId(null);
    setParticipants([]);
    setLines([]);
    setTurnsRemaining(null);
    setComplete(false);
    setInput('');
    setTurnPhase('setup');
    setActiveSpeaker(null);
    stopMic();
    stopDemoSpeech();
  };

  const onMicDown = () => {
    if (turnPhase !== 'your_turn' || busy || complete) return;
    setTurnPhase('you_speaking');
    startMic();
  };

  const onMicUp = () => {
    stopMic();
    if (turnPhaseRef.current === 'you_speaking') {
      setTurnPhase('your_turn');
    }
  };

  const canInteract =
    sessionId && !complete && (turnPhase === 'your_turn' || turnPhase === 'you_speaking') && !busy;

  const translatingLabel =
    speakLang !== readLang
      ? `Translating ${speakLang.toUpperCase()} → ${readLang.toUpperCase()}`
      : `Captions in ${readLang.toUpperCase()}`;

  const roomParticipants =
    participants.length > 0
      ? participants
      : [
          { id: 'you', name: 'You', speakLang, gradient: 'from-primary/30 to-slate-300' },
          ...(selectedScenario.participants || []).map((p) => ({
            ...p,
            speakLang: participantLangs[p.name] || p.defaultLang,
            gradient: p.gradient || 'from-slate-200 to-slate-300',
          })),
        ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Translation lab</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Try live translation — no signup</h1>
          <p className="mt-4 text-muted-foreground">
            Join a mini meeting room, set each person&apos;s language, then take turns speaking — just like a real call.
          </p>
        </div>

        <div className="mt-10 space-y-6">
          {sessionId ? (
            <>
              <DemoRoomStage
                participants={roomParticipants}
                activeSpeaker={activeSpeaker}
                turnPhase={turnPhase}
                scenarioTitle={scenarioTitle}
                micSupported={micSupported}
                listening={listening}
                micDisabled={!canInteract}
                onMicDown={onMicDown}
                onMicUp={onMicUp}
              />

              <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>{turnsRemaining != null ? `${turnsRemaining} turns left` : `${maxTurns} turns max`}</span>
                    <button
                      type="button"
                      onClick={resetDemo}
                      className="inline-flex items-center gap-1 text-foreground hover:underline"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset
                    </button>
                  </div>

                  {!complete ? (
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        sendTurn();
                      }}
                    >
                      <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                          canInteract ? "Or type what you'd say…" : 'Wait for your teammate to finish…'
                        }
                        maxLength={200}
                        disabled={!canInteract}
                      />
                      <Button type="submit" disabled={!canInteract || !input.trim()}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                      </Button>
                      {!micSupported && (
                        <p className="text-xs text-muted-foreground">
                          Mic unavailable in this browser — type your line instead.
                        </p>
                      )}
                    </form>
                  ) : (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                      <p className="font-medium text-foreground">Demo complete</p>
                      <p className="mt-1 text-muted-foreground">
                        Full meetings add video, guest links, transcript storage, and AI reports.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button asChild onClick={() => demoLabService.track(sessionId, 'signup_click')}>
                          <Link to="/v2/signup">
                            Start free <ArrowRight className="ml-1 h-4 w-4" />
                          </Link>
                        </Button>
                        <Button variant="outline" onClick={resetDemo}>
                          Try again
                        </Button>
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ttsEnabled}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setTtsEnabled(on);
                        if (on && sessionId) demoLabService.track(sessionId, 'tts_enabled');
                        if (!on) stopDemoSpeech();
                      }}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Volume2 className="h-4 w-4" /> Hear teammates speak (browser voice)
                    </span>
                  </label>
                </div>

                <DemoCaptionPanel
                  lines={lines}
                  readLang={readLang}
                  translatingLabel={translatingLabel}
                  emptyHint="Captions appear here as people speak."
                />
              </div>
            </>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
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

                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Room languages
                  </p>
                  <div className="space-y-2 rounded-lg border border-border/60 bg-card/30 p-3">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">You</span>
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
                    onChange={(e) => {
                      const on = e.target.checked;
                      setTtsEnabled(on);
                      if (!on) stopDemoSpeech();
                    }}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Volume2 className="h-4 w-4" /> Hear teammates speak (browser voice)
                  </span>
                </label>

                <Button size="lg" className="w-full gap-2" disabled={starting} onClick={startSession}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Join demo room
                </Button>
              </div>

              <DemoCaptionPanel
                lines={[]}
                readLang={readLang}
                translatingLabel={null}
                emptyHint="Pick a scenario and join the room. Captions will appear here as you and teammates speak."
              />
            </div>
          )}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
          Public preview · Rate-limited · No video or guest links · Transcripts not saved
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
