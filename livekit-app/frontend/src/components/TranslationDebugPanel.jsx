/**
 * In-app debug panel for translation / STT troubleshooting.
 * Enable with ?debug=1 in the URL (e.g. staging.jarmetals.com/room/xxx?debug=1)
 */
import { useState, useEffect, useRef } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { Bug } from 'lucide-react';

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

function TranslationDebugPanel({ selectedLanguage, spokenLanguage, translationEnabled, participantName }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [isOpen, setIsOpen] = useState(false);
  const [transcriptionCount, setTranscriptionCount] = useState(0);
  const [sttProvider, setSttProvider] = useState(null);
  const [sttProviderHistory, setSttProviderHistory] = useState([]);
  const [lastTranscriptions, setLastTranscriptions] = useState([]);
  const [agentInRoom, setAgentInRoom] = useState(false);
  const [agentIdentities, setAgentIdentities] = useState([]);
  const countRef = useRef(0);

  const showDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

  useEffect(() => {
    if (!room || !showDebug) return;

    const handleData = (payload, participant, kind, topic) => {
      try {
        const raw = payload instanceof Uint8Array ? payload : (payload?.data ?? payload);
        if (!raw) return;
        const msg = JSON.parse(new TextDecoder().decode(raw));
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
    ? (sttProvider === 'xai' ? '✅ xAI Grok STT' : `⚠️ ${sttProvider} (not xAI)`)
    : '— waiting for caption packet';

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
          <span className={`rounded px-1 py-0.5 text-[10px] ${sttProvider === 'xai' ? 'bg-emerald-500/20 text-emerald-600' : 'bg-amber-500/20 text-amber-700'}`}>
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
              <div className={sttProvider === 'xai' ? 'text-emerald-600' : sttProvider ? 'text-amber-600' : 'text-muted-foreground'}>
                {sttStatus}
              </div>
              {sttProvider && sttProvider !== 'xai' && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  xAI console will show zero STT usage when fallback is active.
                </div>
              )}
              {sttProviderHistory.length > 1 && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  history:
                  {' '}
                  {sttProviderHistory.map((h) => h.provider).join(' → ')}
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
