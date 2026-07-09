function langLabel(code) {
  return (code || 'en').split('-')[0].toUpperCase();
}

function AgentTile({ agent, active }) {
  const initial = agent.name?.charAt(0) || '?';

  return (
    <div
      className={`relative aspect-video h-full w-[5.5rem] shrink-0 overflow-hidden rounded-lg border shadow-sm sm:w-40 ${
        active
          ? 'border-emerald-400 ring-2 ring-emerald-400/70'
          : 'border-border/50'
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${agent.gradient || 'from-slate-200 to-slate-300'}`} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
      {active && (
        <span className="absolute right-1 top-1 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[8px] font-semibold text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Live
        </span>
      )}
      <span className="absolute left-1 top-1 rounded bg-primary/90 px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
        {langLabel(agent.speakLang || agent.nativeLang)}
      </span>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/20 text-base font-semibold text-white sm:h-10 sm:w-10">
          {initial}
        </span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 truncate p-1.5 text-[9px] font-medium text-white sm:text-[10px]">
        {agent.name}
        <span className="block truncate text-[8px] font-normal text-white/75">
          AI teammate · {langLabel(agent.speakLang || agent.nativeLang)}
        </span>
      </div>
    </div>
  );
}

export function DemoAgentFilmstrip({ agents = [], activeSpeaker }) {
  if (!agents.length) return null;

  return (
    <div className="shrink-0 border-t border-border/60 bg-background/80 p-2">
      <p className="mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        AI teammates
      </p>
      <div className="flex h-[4.5rem] gap-2 overflow-x-auto sm:h-24">
        {agents.map((agent) => (
          <AgentTile
            key={agent.id || agent.name}
            agent={agent}
            active={activeSpeaker === agent.name}
          />
        ))}
      </div>
    </div>
  );
}
