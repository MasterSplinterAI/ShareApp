import { Subtitles } from 'lucide-react';
import { getCaptionDisplay, sourceLangLabel } from '../../lib/captionDisplay';

export function DemoCaptionPanel({ lines, readLang, translatingLabel, emptyHint }) {
  return (
    <div className="flex h-full min-h-[20rem] flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm">
      <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2 text-xs">
        <span className="flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 font-medium text-primary">
          <Subtitles className="h-3.5 w-3.5" />
          Captions
        </span>
      </div>
      {translatingLabel && (
        <p className="border-b border-border/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
          {translatingLabel}
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm leading-snug">
        {lines.length === 0 && emptyHint && (
          <p className="text-muted-foreground">{emptyHint}</p>
        )}
        {lines.map((line, idx) => {
          const display = getCaptionDisplay({ ...line, readLang });
          return (
            <div key={`${line.speaker}-${idx}-${line.originalText?.slice(0, 12)}`} className="space-y-0.5">
              <p className={line.speaker === 'You' ? 'rounded-md bg-primary/10 px-2 py-1.5' : ''}>
                <span className="font-semibold text-primary">{line.speaker}</span>
                {display.secondary && (
                  <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                    {sourceLangLabel(display.sourceLang)}
                  </span>
                )}
                <span className="text-foreground">: {display.primary}</span>
              </p>
              {display.secondary && (
                <p className="border-t border-border/40 pl-3 pt-0.5 text-muted-foreground">{display.secondary}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
