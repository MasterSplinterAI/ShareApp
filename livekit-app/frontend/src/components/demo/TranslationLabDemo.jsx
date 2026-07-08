import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowRight, Loader2, Mic, MicOff, RotateCcw, Volume2 } from 'lucide-react';
import { MarketingNav } from '../marketing/MarketingNav';
import { MarketingFooter } from '../marketing/MarketingFooter';
import { DemoCaptionPanel } from './DemoCaptionPanel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { demoLabService } from '../../services/demoLab';
import {
  demoLangToSpeechLocale,
  speakDemoLine,
  stopDemoSpeech,
  useDemoSpeechRecognition,
} from '../../hooks/useDemoSpeech';

const DEFAULT_SCENARIOS = [
  { id: 'standup', title: 'Global standup', description: 'Weekly sync with Madrid & Tokyo.' },
  { id: 'customer', title: 'Customer call', description: 'Prospect asks about guest links.' },
  { id: 'interview', title: 'Interview', description: 'HR screens a French-speaking candidate.' },
];

export default function TranslationLabDemo() {
  const [config, setConfig] = useState(null);
  const [scenarioId, setScenarioId] = useState('standup');
  const [speakLang, setSpeakLang] = useState('en');
  const [readLang, setReadLang] = useState('en');
  const [sessionId, setSessionId] = useState(null);
  const [lines, setLines] = useState([]);
  const [turnsRemaining, setTurnsRemaining] = useState(null);
  const [complete, setComplete] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

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

  const handleSpeechResult = useCallback(
    (text) => {
      setInput(text);
    },
    []
  );

  const { supported: micSupported, listening, start: startMic, stop: stopMic } = useDemoSpeechRecognition({
    lang: demoLangToSpeechLocale(speakLang),
    onResult: handleSpeechResult,
  });

  useEffect(() => {
    demoLabService.config().then(setConfig).catch(() => {});
    return () => stopDemoSpeech();
  }, []);

  const maybeSpeakBot = useCallback(
    (line) => {
      if (!ttsEnabled || !line || line.speaker === 'You') return;
      speakDemoLine(line.primary || line.originalText, line.sourceLang);
    },
    [ttsEnabled]
  );

  const startSession = async () => {
    setStarting(true);
    setBusy(true);
    stopMic();
    stopDemoSpeech();
    try {
      const data = await demoLabService.startSession({ scenarioId, speakLang, readLang });
      setSessionId(data.sessionId);
      setLines(data.lines || []);
      setTurnsRemaining(data.maxTurns);
      setComplete(false);
      setInput('');
      demoLabService.track(data.sessionId, 'session_start', { scenarioId });
      if (data.lines?.[0]) maybeSpeakBot(data.lines[0]);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start demo');
    } finally {
      setStarting(false);
      setBusy(false);
    }
  };

  const sendTurn = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!sessionId || !text || busy || complete) return;
    setBusy(true);
    stopMic();
    try {
      const data = await demoLabService.turn(sessionId, text);
      setLines((prev) => [...prev, data.userLine, data.botLine]);
      setTurnsRemaining(data.turnsRemaining);
      setComplete(Boolean(data.complete));
      setInput('');
      demoLabService.track(sessionId, 'turn');
      maybeSpeakBot(data.botLine);
      if (data.complete) {
        demoLabService.track(sessionId, 'complete');
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Demo turn failed');
    } finally {
      setBusy(false);
    }
  };

  const resetDemo = () => {
    setSessionId(null);
    setLines([]);
    setTurnsRemaining(null);
    setComplete(false);
    setInput('');
    stopMic();
    stopDemoSpeech();
  };

  const translatingLabel =
    speakLang !== readLang
      ? `Translating ${speakLang.toUpperCase()} → ${readLang.toUpperCase()}`
      : `Captions in ${readLang.toUpperCase()}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Translation lab</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Try live translation — no signup</h1>
          <p className="mt-4 text-muted-foreground">
            Pick a scenario, speak or type in your language, and see captions update in real time. Bot replies are
            scripted; your lines use the same translation engine as meetings.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-start">
          <div className="space-y-5">
            {!sessionId ? (
              <>
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">I speak</span>
                    <select
                      value={speakLang}
                      onChange={(e) => setSpeakLang(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {languages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
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
                </div>

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
                    <Volume2 className="h-4 w-4" /> Hear bot replies (browser voice)
                  </span>
                </label>

                <Button size="lg" className="w-full gap-2" disabled={starting} onClick={startSession}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Start demo
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    {turnsRemaining != null ? `${turnsRemaining} tries left` : `${maxTurns} tries max`}
                  </span>
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
                      placeholder="Type what you'd say in the meeting…"
                      maxLength={200}
                      disabled={busy}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={busy || !input.trim()}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                      </Button>
                      {micSupported && (
                        <Button
                          type="button"
                          variant={listening ? 'destructive' : 'outline'}
                          disabled={busy}
                          onClick={() => (listening ? stopMic() : startMic())}
                        >
                          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                          {listening ? 'Stop' : 'Hold to speak'}
                        </Button>
                      )}
                    </div>
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
                    <Volume2 className="h-4 w-4" /> Hear bot replies
                  </span>
                </label>
              </>
            )}
          </div>

          <DemoCaptionPanel
            lines={lines}
            readLang={readLang}
            translatingLabel={sessionId ? translatingLabel : null}
            emptyHint={sessionId ? 'Waiting for your line…' : 'Start the demo to see captions here.'}
          />
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
          Public preview · Rate-limited · No video or guest links · Transcripts not saved
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
