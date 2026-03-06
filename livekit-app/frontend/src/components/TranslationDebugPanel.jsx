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
        className="bg-gray-800 rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-600 flex items-center gap-1"
        title="Translation debug (add ?debug=1 to URL)"
      >
        <Bug className="w-3.5 h-3.5" />
        Debug
      </button>
      {isOpen && (
        <div className="mt-2 bg-gray-900 border border-gray-600 rounded-lg p-3 text-xs font-mono max-w-xs shadow-xl">
          <div className="text-gray-400 mb-2 font-semibold">Translation Debug</div>
          <div className="space-y-1.5 text-gray-300">
            <div><span className="text-gray-500">You:</span> {participantName} | language={selectedLanguage} | enabled={String(translationEnabled)}</div>
            <div><span className="text-gray-500">Agent:</span> {agentInRoom ? '✅ In room' : '❌ Not in room'}</div>
            <div><span className="text-gray-500">Transcriptions:</span> {transcriptionCount} received</div>
            {lastTranscriptions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                <div className="text-gray-500 mb-1">Last:</div>
                {lastTranscriptions.map((t, i) => (
                  <div key={i} className="text-gray-400 truncate">
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
