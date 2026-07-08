import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { demoLabService } from '../services/demoLab';
import { publishAgentCaptionSequence, delay } from '../lib/demoCaptionPublish';
import { speakDemoLineAsync, stopDemoSpeech } from './useDemoSpeech';
import { isLikelyEcho } from './useDemoMicGate';

function isAgentSpeaker(participantId, agentNames) {
  if (!participantId || !agentNames?.length) return false;
  const id = String(participantId).toLowerCase();
  return agentNames.some((n) => {
    const name = String(n).toLowerCase();
    return id === name || id.startsWith(`agent-${name}`) || id.includes(name);
  });
}

const LISTENING_PHASES = new Set(['your_turn']);

/**
 * Listens for user final transcripts from the translation agent, calls LLM orchestrator,
 * publishes agent caption packets + optional TTS. Mic is gated externally via useDemoMicGate.
 */
export function useDemoOrchestrator({
  demoSessionId,
  userIdentity,
  readLang,
  agentNames,
  agents,
  ttsEnabled,
  onActiveSpeaker,
  onTurnPhase,
  onComplete,
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [turnsRemaining, setTurnsRemaining] = useState(null);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  const processedIdsRef = useRef(new Set());
  const openingSentRef = useRef(false);
  const busyRef = useRef(false);
  const completeRef = useRef(false);
  const turnPhaseRef = useRef('opening');
  const agentNamesRef = useRef(agentNames);
  const recentAgentTextsRef = useRef([]);

  useEffect(() => {
    agentNamesRef.current = agentNames;
  }, [agentNames]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);

  const setPhase = useCallback(
    (phase) => {
      turnPhaseRef.current = phase;
      onTurnPhase?.(phase);
    },
    [onTurnPhase]
  );

  const playAgentLines = useCallback(
    async (agentLines) => {
      if (!localParticipant || !agentLines?.length) return;
      setPhase('agent_speaking');
      stopDemoSpeech();

      for (const line of agentLines) {
        recentAgentTextsRef.current.push(line.originalText);
        if (recentAgentTextsRef.current.length > 8) {
          recentAgentTextsRef.current.shift();
        }

        onActiveSpeaker?.(line.speaker);
        const translated = line.primary || line.originalText;
        await publishAgentCaptionSequence(localParticipant, {
          speakerId: line.speaker,
          originalText: line.originalText,
          translatedText: translated,
          sourceLang: line.sourceLang,
          targetLang: readLang,
        });

        if (ttsEnabled) {
          await speakDemoLineAsync(line.originalText, line.sourceLang);
        } else {
          await delay(Math.min(6000, Math.max(1400, line.originalText.length * 48)));
        }
        onActiveSpeaker?.(null);
        await delay(320);
      }

      if (!completeRef.current) {
        setPhase('your_turn');
      }
    },
    [localParticipant, readLang, ttsEnabled, onActiveSpeaker, setPhase]
  );

  const runOrchestrate = useCallback(
    async ({ userText, trigger }) => {
      if (!demoSessionId || busyRef.current) return;
      if (trigger !== 'opening' && !LISTENING_PHASES.has(turnPhaseRef.current)) return;

      setBusy(true);
      busyRef.current = true;
      setPhase(trigger === 'opening' ? 'opening' : 'processing');
      stopDemoSpeech();

      try {
        const data = await demoLabService.orchestrate(demoSessionId, { userText, trigger });
        setTurnsRemaining(data.turnsRemaining);
        if (data.complete) {
          setComplete(true);
          completeRef.current = true;
          onComplete?.(true);
          setPhase('complete');
        }
        if (data.agentLines?.length) {
          await playAgentLines(data.agentLines);
        } else if (!data.complete) {
          setPhase('your_turn');
        }
        demoLabService.track(demoSessionId, 'live_orchestrate');
      } catch (e) {
        console.error('[useDemoOrchestrator]', e);
        if (!completeRef.current) setPhase('your_turn');
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [demoSessionId, playAgentLines, setPhase, onComplete]
  );

  useEffect(() => {
    if (!room || !demoSessionId || openingSentRef.current) return;
    if (room.state !== ConnectionState.Connected) return;

    const timer = setTimeout(() => {
      if (openingSentRef.current) return;
      openingSentRef.current = true;
      runOrchestrate({ trigger: 'opening' });
    }, 2800);

    return () => clearTimeout(timer);
  }, [room, room?.state, demoSessionId, runOrchestrate]);

  useEffect(() => {
    if (!room || !userIdentity) return;

    const handleData = (payload, _participant, _kind, topic) => {
      if (topic != null && topic !== 'transcription') return;
      if (busyRef.current || completeRef.current) return;
      if (!LISTENING_PHASES.has(turnPhaseRef.current)) return;

      try {
        const raw = payload instanceof Uint8Array ? payload : payload?.data ?? payload;
        if (!raw) return;
        const message = JSON.parse(new TextDecoder().decode(raw));
        if (message.type !== 'transcription') return;
        if (message.sttProvider === 'demo') return;
        if (!message.final) return;

        const speakerId = message.participant_id;
        if (!speakerId) return;
        if (isAgentSpeaker(speakerId, agentNamesRef.current)) return;
        if (String(speakerId) !== String(userIdentity)) return;

        const text = (message.originalText || message.text || '').trim();
        if (!text || text.length < 3) return;
        if (isLikelyEcho(text, recentAgentTextsRef.current)) return;

        const tid = message.transcriptionId || `${speakerId}-${text.slice(0, 32)}`;
        if (processedIdsRef.current.has(tid)) return;
        processedIdsRef.current.add(tid);

        runOrchestrate({ userText: text });
      } catch {
        /* ignore */
      }
    };

    room.on('dataReceived', handleData);
    return () => room.off('dataReceived', handleData);
  }, [room, userIdentity, runOrchestrate]);

  useEffect(() => () => stopDemoSpeech(), []);

  return { turnsRemaining, complete, busy, agents };
}
