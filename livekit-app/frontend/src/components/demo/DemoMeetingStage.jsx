import { useMemo } from 'react';
import VideoGrid from '../VideoGrid';

const PHASE_HINTS = {
  opening: 'Joining room — teammates are saying hello…',
  your_turn: 'Your turn — speak naturally into your mic',
  you_speaking: 'Listening & translating live…',
  processing: 'Translating your line…',
  agent_speaking: 'Teammate responding…',
  complete: 'Demo complete — start a free meeting anytime',
};

export function DemoMeetingStage({ agents = [], activeSpeaker, turnPhase, scenarioTitle }) {
  const hint =
    turnPhase === 'agent_speaking' && activeSpeaker
      ? `${activeSpeaker} is speaking…`
      : PHASE_HINTS[turnPhase] || '';
  const micActive = turnPhase === 'your_turn' || turnPhase === 'you_speaking';

  const demoParticipants = useMemo(
    () =>
      agents.map((agent) => ({
        ...agent,
        isSpeaking: activeSpeaker === agent.name,
        isThinking: turnPhase === 'processing',
      })),
    [agents, activeSpeaker, turnPhase]
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {hint && (
        <div className="pointer-events-none absolute left-1/2 top-2.5 z-20 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-md">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              micActive
                ? 'animate-pulse bg-emerald-400'
                : turnPhase === 'agent_speaking'
                  ? 'animate-pulse bg-sky-400'
                  : 'bg-amber-400'
            }`}
          />
          <span className="truncate">
            {scenarioTitle ? `${scenarioTitle} · ` : ''}
            {hint}
          </span>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <VideoGrid demoParticipants={demoParticipants} />
      </div>
    </div>
  );
}
