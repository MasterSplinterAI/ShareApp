import VideoGrid from '../VideoGrid';
import { DemoAgentFilmstrip } from './DemoAgentFilmstrip';

const PHASE_HINTS = {
  opening: 'Meeting starting — you can speak anytime',
  your_turn: 'Your turn — speak now',
  you_speaking: 'Listening…',
  processing: 'Translating your line…',
  agent_speaking: 'Teammate responding…',
  complete: 'Demo complete',
};

export function DemoMeetingStage({ agents, activeSpeaker, turnPhase, scenarioTitle }) {
  const hint = PHASE_HINTS[turnPhase] || '';

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-muted/15">
      {/* Mobile: compact phase line only. Desktop: fake window chrome + hint */}
      <div className="shrink-0 border-b border-border/60 bg-muted/40 px-3 py-1.5 sm:px-4 sm:py-2">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
          <span className="ml-1 truncate text-xs font-medium text-muted-foreground">
            Lalia · {scenarioTitle || 'Translation lab'}
          </span>
        </div>
        {hint && (
          <p className="text-center text-xs text-muted-foreground sm:mt-1.5">{hint}</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <VideoGrid />
        </div>
        <DemoAgentFilmstrip agents={agents} activeSpeaker={activeSpeaker} />
      </div>
    </div>
  );
}
