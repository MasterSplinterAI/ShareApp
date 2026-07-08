import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { demoLabService } from '../services/demoLab';
import { publishAgentCaptionSequence, delay } from '../lib/demoCaptionPublish';
import { speakDemoLineAsync, stopDemoSpeech } from './useDemoSpeech';

function isAgentSpeaker(participantId, agentNames) {
  if (!participantId || !agentNames?.length) return false;
  return agentNames.some((n) => n === participantId || participantId.startsWith(`agent-${n}`));
}

/**
 * Listens for user final transcripts from the translation agent, calls LLM orchestrator,
 * publishes agent caption packets + optional TTS.
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
  const agentNamesRef = useRef(agentNames);

  useEffect(() => {
    agentNamesRef.current = agentNames;
  }, [agentNames]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const playAgentLines = useCallback(
    async (agentLines) => {
      if (!localParticipant || !agentLines?.length) return;
      onTurnPhase?.('agent_speaking');
      for (const line of agentLines) {
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
          await delay(Math.min(6000, Math.max(1200, line.originalText.length * 48)));
        }
        onActiveSpeaker?.(null);
        await delay(280);
      }
      if (!complete) onTurnPhase?.('your_turn');
    },
    [localParticipant, readLang, ttsEnabled, onActiveSpeaker, onTurnPhase, complete]
  );

  const runOrchestrate = useCallback(
    async ({ userText, trigger }) => {
      if (!demoSessionId || busyRef.current) return;
      setBusy(true);
      busyRef.current = true;
      onTurnPhase?.(trigger === 'opening' ? 'opening' : 'processing');
      try {
        const data = await demoLabService.orchestrate(demoSessionId, { userText, trigger });
        setTurnsRemaining(data.turnsRemaining);
        if (data.complete) {
          setComplete(true);
          onComplete?.(true);
          onTurnPhase?.('complete');
        }
        if (data.agentLines?.length) {
          await playAgentLines(data.agentLines);
        } else if (!data.complete) {
          onTurnPhase?.('your_turn');
        }
        demoLabService.track(demoSessionId, 'live_orchestrate');
      } catch (e) {
        console.error('[useDemoOrchestrator]', e);
        onTurnPhase?.('your_turn');
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [demoSessionId, playAgentLines, onTurnPhase, onComplete]
  );

  // Opening line once room connected + mic path ready
  useEffect(() => {
    if (!room || !demoSessionId || openingSentRef.current) return;
    if (room.state !== ConnectionState.Connected) return;

    const timer = setTimeout(() => {
      if (openingSentRef.current) return;
      openingSentRef.current = true;
      runOrchestrate({ trigger: 'opening' });
    }, 2200);

    return () => clearTimeout(timer);
  }, [room, room?.state, demoSessionId, runOrchestrate]);

  // Listen for user final transcripts from translation agent
  useEffect(() => {
    if (!room || !userIdentity) return;

    const handleData = (payload, _participant, _kind, topic) => {
      if (busyRef.current || complete) return;
      if (topic != null && topic !== 'transcription') return;
      try {
        const raw = payload instanceof Uint8Array ? payload : payload?.data ?? payload;
        if (!raw) return;
        const message = JSON.parse(new TextDecoder().decode(raw));
        if (message.type !== 'transcription') return;
        if (message.sttProvider === 'demo') return;
        if (!message.final) return;

        const speakerId = message.participant_id;
        if (!speakerId || speakerId !== userIdentity) return;
        if (isAgentSpeaker(speakerId, agentNamesRef.current)) return;

        const tid = message.transcriptionId || `${speakerId}-${message.originalText?.slice(0, 24)}`;
        if (processedIdsRef.current.has(tid)) return;
        processedIdsRef.current.add(tid);

        const text = (message.originalText || message.text || '').trim();
        if (!text) return;

        runOrchestrate({ userText: text });
      } catch {
        /* ignore parse errors */
      }
    };

    room.on('dataReceived', handleData);
    return () => room.off('dataReceived', handleData);
  }, [room, userIdentity, complete, runOrchestrate]);

  useEffect(() => () => stopDemoSpeech(), []);

  return { turnsRemaining, complete, busy, agents };
}
