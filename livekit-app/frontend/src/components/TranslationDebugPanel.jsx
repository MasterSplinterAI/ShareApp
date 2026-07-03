/**
 * In-app debug panel for translation / STT troubleshooting.
 * Enable with ?debug=1 in the URL (e.g. staging.jarmetals.com/room/xxx?debug=1)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { Bug } from 'lucide-react';
import { v2Host } from '../services/apiV2';

function isLikelyAgentIdentity(identity) {
  if (!identity) return false;
  const id = identity.toLowerCase();
  return (
    id.startsWith('agent-')
    || id.includes('translation')
    || id.includes('-agent-')
    || id.includes('agent_')
  );
}

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isStagingHost() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname.toLowerCase();
  return h.includes('staging.') || h === 'localhost' || h === '127.0.0.1';
}

function TranslationDebugPanel({
  selectedLanguage,
  spokenLanguage,
  translationEnabled,
  voiceTranslationEnabled = false,
  participantName,
  meetingId,
  isHost,
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [isOpen, setIsOpen] = useState(false);
  const [transcriptionCount, setTranscriptionCount] = useState(0);
  const [sttProvider, setSttProvider] = useState(null);
  const [sttProviderHistory, setSttProviderHistory] = useState([]);
  const [lastTranscriptions, setLastTranscriptions] = useState([]);
  const [agentInRoom, setAgentInRoom] = useState(false);
  const [agentIdentities, setAgentIdentities] = useState([]);
  const [roomPipeline, setRoomPipeline] = useState(null);
  const [pipelineOptions, setPipelineOptions] = useState(['deepgram', 'deepgram_codeswitch']);
  const [pipelineSwitching, setPipelineSwitching] = useState(false);
  const [pipelineError, setPipelineError] = useState(null);
  const [ttsErrors, setTtsErrors] = useState([]);
  const countRef = useRef(0);

  const showDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
  const showPipelineSwitch = showDebug && isHost && isStagingHost() && Boolean(meetingId);
  const inferredPipeline = agentIdentities.some((id) => id.toLowerCase().includes('codeswitch'))
    ? 'deepgram_codeswitch'
    : agentIdentities.some((id) => id.toLowerCase().includes('translation'))
      ? 'deepgram'
      : null;
  const effectivePipeline = roomPipeline || inferredPipeline;
  const voicePipelineReady = effectivePipeline === 'deepgram_codeswitch';
  const voiceOnButWrongPipeline = voiceTranslationEnabled && effectivePipeline && !voicePipelineReady;

  const refreshRoomPipeline = useCallback(async () => {
    if (!showPipelineSwitch) return;
    try {
      const data = await v2Host.getSttPipeline(meetingId);
      setRoomPipeline(data.pipeline || 'deepgram');
      if (Array.isArray(data.options) && data.options.length) {
        setPipelineOptions(data.options);
      }
      setPipelineError(null);
    } catch (e) {
      setPipelineError(e?.response?.data?.error || e.message || 'Failed to load pipeline');
    }
  }, [meetingId, showPipelineSwitch]);

  useEffect(() => {
    refreshRoomPipeline();
  }, [refreshRoomPipeline]);

  useEffect(() => {
    if (!room || !showDebug) return;

    const handleData = (payload, participant, kind, topic) => {
      try {
        const raw = payload instanceof Uint8Array ? payload : (payload?.data ?? payload);
        if (!raw) return;
        const msg = JSON.parse(new TextDecoder().decode(raw));
        if (msg.type === 'tts_error') {
          setTtsErrors((prev) => [
            {
              at: msg.timestamp || Date.now() / 1000,
              provider: msg.provider || '—',
              language: msg.language || '—',
              code: msg.code || 'unknown',
              message: msg.message || 'TTS error',
              httpStatus: msg.http_status ?? null,
              speaker: msg.speaker_id || participant?.identity || '?',
            },
            ...prev.slice(0, 7),
          ]);
          return;
        }
        if (msg.type !== 'transcription') return;

        countRef.current += 1;
        setTranscriptionCount(countRef.current);

        if (msg.sttProvider) {
          setSttProvider(msg.sttProvider);
          setSttProviderHistory((prev) => {
            const entry = { provider: msg.sttProvider, at: Date.now() };
            if (prev[0]?.provider === entry.provider) return prev;
            return [entry, ...prev].slice(0, 5);
          });
        }

        setLastTranscriptions((prev) => [
          {
            at: msg.timestamp || Date.now() / 1000,
            speaker: msg.participant_id || participant?.identity || '?',
            partial: !!msg.partial,
            final: !!msg.final,
            sttProvider: msg.sttProvider || '—',
            sourceLanguage: msg.sourceLanguage || '—',
            language: msg.language || '—',
            transcriptionId: msg.transcriptionId ? String(msg.transcriptionId).slice(-12) : '—',
            origLen: msg.originalText?.length ?? 0,
            textLen: msg.text?.length ?? 0,
            origTail: msg.originalText?.slice(-48) || msg.text?.slice(-48) || '',
            hasTranslation: msg.hasTranslation ?? null,
          },
          ...prev.slice(0, 7),
        ]);
      } catch (_) {
        /* ignore malformed packets */
      }
    };

    room.on('dataReceived', handleData);
    return () => room.off('dataReceived', handleData);
  }, [room, showDebug]);

  useEffect(() => {
    if (!showDebug || !participants) return;
    const agents = participants.filter((p) => isLikelyAgentIdentity(p.identity));
    setAgentInRoom(agents.length > 0);
    setAgentIdentities(agents.map((p) => p.identity));
  }, [participants, showDebug]);

  if (!showDebug) return null;

  const sttStatus = sttProvider
    ? `✅ ${sttProvider}`
    : '— waiting for caption packet';

  const handlePipelineSwitch = async (pipeline) => {
    if (!showPipelineSwitch || pipelineSwitching || pipeline === roomPipeline) return;
    setPipelineSwitching(true);
    setPipelineError(null);
    try {
      const data = await v2Host.switchSttPipeline(meetingId, pipeline);
      setRoomPipeline(data.pipeline || pipeline);
    } catch (e) {
      setPipelineError(e?.response?.data?.error || e.message || 'Switch failed');
    } finally {
      setPipelineSwitching(false);
    }
  };

  return (
    <div className="fixed top-2 left-2 z-[100] max-w-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted"
        title="Caption / STT debug (?debug=1)"
      >
        <Bug className="h-3.5 w-3.5 text-amber-500" />
        Debug
        {sttProvider && (
          <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-600">
            STT:{sttProvider}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card p-3 font-mono text-[11px] leading-relaxed text-foreground shadow-xl">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Caption / STT Debug</div>

          <div className="space-y-2">
            <section className="rounded border border-border/60 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">STT provider</div>
              <div className={sttProvider ? 'text-emerald-600' : 'text-muted-foreground'}>
                {sttStatus}
              </div>
              {sttProviderHistory.length > 1 && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  history:
                  {' '}
                  {sttProviderHistory.map((h) => h.provider).join(' → ')}
                </div>
              )}
            </section>

            {showPipelineSwitch && (
              <section className="rounded border border-amber-500/40 bg-amber-500/5 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Host STT pipeline (staging)
                </div>
                <div className="text-[10px] text-muted-foreground">
                  room config: {roomPipeline || '…'}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pipelineOptions.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={pipelineSwitching}
                      onClick={() => handlePipelineSwitch(p)}
                      className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                        roomPipeline === p
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border bg-background hover:bg-muted'
                      } ${pipelineSwitching ? 'opacity-60' : ''}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                {pipelineSwitching && (
                  <div className="mt-1 text-[10px] text-muted-foreground">Switching agent…</div>
                )}
                {pipelineError && (
                  <div className="mt-1 text-[10px] text-destructive">{pipelineError}</div>
                )}
                <div className="mt-2 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-[10px] text-foreground/90">
                  <div className="font-semibold text-blue-600">Voice translation</div>
                  <p className="mt-1 text-muted-foreground">
                    Spoken translation (TTS) only runs on the{' '}
                    <span className="font-medium text-foreground">deepgram_codeswitch</span>{' '}
                    pipeline. Switch above, then enable captions → Voice translation in the menu.
                  </p>
                  {voiceTranslationEnabled && voicePipelineReady && (
                    <p className="mt-1 text-emerald-600">✅ Voice on + codeswitch pipeline active</p>
                  )}
                  {voiceOnButWrongPipeline && (
                    <p className="mt-1 text-destructive">
                      ⚠ Voice translation is ON but pipeline is &quot;{effectivePipeline}&quot; — no TTS audio will play.
                    </p>
                  )}
                </div>
              </section>
            )}

            <section className="rounded border border-border/60 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Voice / TTS
              </div>
              <div>
                <span className="text-muted-foreground">voice translation:</span>{' '}
                {String(voiceTranslationEnabled)}
              </div>
              <div>
                <span className="text-muted-foreground">pipeline for TTS:</span>{' '}
                {effectivePipeline || '—'}
                {voicePipelineReady ? ' ✅' : ' (needs deepgram_codeswitch)'}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Voice translation requires the codeswitch agent. Host: switch pipeline above (staging + ?debug=1).
              </p>
              {ttsErrors.length === 0 ? (
                <div className="mt-1 text-muted-foreground">No TTS API errors yet</div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {ttsErrors.map((err, i) => (
                    <div
                      key={`${err.at}-${err.code}-${i}`}
                      className="rounded border border-destructive/30 bg-destructive/5 p-1.5"
                    >
                      <div className="flex flex-wrap gap-x-2 text-[10px] text-destructive">
                        <span>{formatTime(err.at)}</span>
                        <span>{err.provider}</span>
                        <span>{err.language}</span>
                        {err.httpStatus != null && <span>HTTP {err.httpStatus}</span>}
                        <span>{err.code}</span>
                      </div>
                      <div className="text-foreground">{err.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded border border-border/60 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Session</div>
              <div><span className="text-muted-foreground">you:</span> {participantName || '—'}</div>
              <div><span className="text-muted-foreground">caption lang:</span> {selectedLanguage} | <span className="text-muted-foreground">spoken:</span> {spokenLanguage}</div>
              <div><span className="text-muted-foreground">captions:</span> {String(translationEnabled)}</div>
              <div><span className="text-muted-foreground">room:</span> {room?.name || '—'}</div>
            </section>

            <section className="rounded border border-border/60 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Agent</div>
              <div>{agentInRoom ? '✅ In room' : '❌ Not in room'}</div>
              {agentIdentities.length > 0 && (
                <div className="truncate text-muted-foreground">{agentIdentities.join(', ')}</div>
              )}
            </section>

            <section className="rounded border border-border/60 bg-muted/30 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Packets</div>
              <div><span className="text-muted-foreground">transcriptions:</span> {transcriptionCount}</div>
            </section>

            {lastTranscriptions.length > 0 && (
              <section className="rounded border border-border/60 bg-muted/30 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent captions</div>
                <div className="space-y-2">
                  {lastTranscriptions.map((t, i) => (
                    <div key={`${t.at}-${i}`} className="border-t border-border/40 pt-1 first:border-0 first:pt-0">
                      <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                        <span>{formatTime(t.at)}</span>
                        <span>{t.partial ? 'partial' : 'final'}</span>
                        <span>stt={t.sttProvider}</span>
                        <span>{t.sourceLanguage}→{t.language}</span>
                      </div>
                      <div className="truncate text-foreground">{t.speaker}</div>
                      <div className="text-muted-foreground">
                        id…{t.transcriptionId} | orig={t.origLen} text={t.textLen}
                        {t.hasTranslation != null && ` | translated=${String(t.hasTranslation)}`}
                      </div>
                      {t.origTail && (
                        <div className="truncate text-foreground/80" title={t.origTail}>
                          …{t.origTail}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TranslationDebugPanel;
