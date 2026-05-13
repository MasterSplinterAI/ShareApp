/**
 * In-app debug panel for translation troubleshooting.
 * Enable with ?debug=1 in the URL (e.g. https://share.jarmetals.com/room/xxx?debug=1)
 */
import { useState, useEffect, useRef } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { Bug } from 'lucide-react';

function TranslationDebugPanel({ selectedLanguage, spokenLanguage, translationEnabled, participantName }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [isOpen, setIsOpen] = useState(false);
  const [lastLangSent, setLastLangSent] = useState(null);
  const [transcriptionCount, setTranscriptionCount] = useState(0);
  const [lastTranscriptions, setLastTranscriptions] = useState([]);
  const [agentInRoom, setAgentInRoom] = useState(false);
  const countRef = useRef(0);

  const showDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';

  useEffect(() => {
    if (!room || !showDebug) return;

    const handleData = (payload, participant, kind, topic) => {
      try {
        const raw = payload instanceof Uint8Array ? payload : (payload?.data ?? payload);
        if (!raw) return;
        const msg = JSON.parse(new TextDecoder().decode(raw));
        // Log ALL data when debug (helps trace transcription flow)
        if (msg.type === 'transcription') {
          console.log('📡 Transcription received:', { topic, partial: msg.partial, speaker: msg.participant_id, text: msg.text?.slice(0, 30) });
        }
        if (msg.type !== 'transcription') return;

        countRef.current += 1;
        setTranscriptionCount(countRef.current);
        setLastTranscriptions(prev => [
          { speaker: msg.participant_id, orig: msg.originalText?.slice(0, 40), trans: msg.text?.slice(0, 40), partial: msg.partial },
          ...prev.slice(0, 4)
        ]);
      } catch (_) {}
    };

    room.on('dataReceived', handleData);
    return () => room.off('dataReceived', handleData);
  }, [room, showDebug]);

  useEffect(() => {
    if (!showDebug) return;
    setLastLangSent({ lang: selectedLanguage, enabled: translationEnabled, name: participantName });
  }, [selectedLanguage, translationEnabled, participantName, showDebug]);

  useEffect(() => {
    if (!showDebug || !participants) return;
    const agent = participants.find(p => p.identity?.startsWith('agent-'));
    setAgentInRoom(!!agent);
  }, [participants, showDebug]);

  if (!showDebug) return null;

  return (
    <div className="fixed top-2 left-2 z-[100]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Translation debug (add ?debug=1 to URL)"
      >
        <Bug className="w-3.5 h-3.5" />
        Debug
      </button>
      {isOpen && (
        <div className="mt-2 max-w-xs rounded-lg border border-border bg-card p-3 font-mono text-xs text-foreground shadow-xl">
          <div className="mb-2 font-semibold text-muted-foreground">Translation Debug</div>
          <div className="space-y-1.5 text-foreground">
            <div>
              <span className="text-muted-foreground">You:</span> {participantName} | language={selectedLanguage} | enabled=
              {String(translationEnabled)}
            </div>
            <div>
              <span className="text-muted-foreground">Agent:</span> {agentInRoom ? '✅ In room' : '❌ Not in room'}
            </div>
            <div>
              <span className="text-muted-foreground">Transcriptions:</span> {transcriptionCount} received
            </div>
            {lastTranscriptions.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <div className="mb-1 text-muted-foreground">Last:</div>
                {lastTranscriptions.map((t, i) => (
                  <div key={i} className="truncate text-muted-foreground">
                    {t.speaker}: {t.orig || t.trans} {t.partial ? '(partial)' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TranslationDebugPanel;
