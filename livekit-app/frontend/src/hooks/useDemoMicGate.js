import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

/**
 * Demo turn-taking: only publish mic audio during the user's turn so TTS/speakers
 * cannot feed back into Deepgram STT and trigger spurious agent replies.
 */
export function useDemoMicGate(turnPhase, { cooldownMs = 1200 } = {}) {
  const room = useRoomContext();
  const timerRef = useRef(null);

  useEffect(() => {
    const lp = room?.localParticipant;
    if (!room || !lp || room.state !== ConnectionState.Connected) return undefined;

    const setMic = async (enabled) => {
      try {
        await lp.setMicrophoneEnabled(enabled);
      } catch {
        /* ignore — track may not exist yet */
      }
    };

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (turnPhase === 'your_turn') {
      timerRef.current = setTimeout(() => {
        setMic(true);
      }, cooldownMs);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    setMic(false);
    return undefined;
  }, [room, room?.state, turnPhase, cooldownMs]);
}

export function isLikelyEcho(userText, recentAgentTexts) {
  if (!userText || !recentAgentTexts?.length) return false;
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const user = norm(userText);
  if (user.length < 8) return false;

  for (const agentLine of recentAgentTexts) {
    const agent = norm(agentLine);
    if (!agent || agent.length < 8) continue;
    const userWords = user.split(' ').filter((w) => w.length > 2);
    const agentWords = agent.split(' ').filter((w) => w.length > 2);
    if (!userWords.length || !agentWords.length) continue;

    const overlap = userWords.filter((w) => agentWords.includes(w)).length;
    const ratio = overlap / Math.min(userWords.length, agentWords.length);
    if (ratio >= 0.55) return true;
    if (user.includes(agent.slice(0, Math.min(40, agent.length)))) return true;
    if (agent.includes(user.slice(0, Math.min(40, user.length)))) return true;
  }
  return false;
}
