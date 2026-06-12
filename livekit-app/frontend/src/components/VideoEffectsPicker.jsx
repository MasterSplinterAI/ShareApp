import { Ban, Check, Droplets } from 'lucide-react';
import { VIDEO_EFFECTS } from '../lib/videoEffects';
import { cn } from '../lib/utils';

/**
 * Shared blur / virtual-background picker. Used on the prejoin preview and in the
 * in-call Effects menu. Pure UI — the caller owns applying the effect to a track.
 */
function VideoEffectsPicker({ activeEffectId, onSelect, disabled = false, compact = false }) {
  const tile = (effect) => {
    const isActive = activeEffectId === effect.id;
    const base = cn(
      'relative flex items-center justify-center overflow-hidden rounded-lg border transition-all',
      compact ? 'h-12 w-[4.5rem]' : 'h-14 w-20',
      isActive
        ? 'border-primary ring-2 ring-primary/50'
        : 'border-border hover:border-ring/60',
      disabled && 'cursor-not-allowed opacity-50'
    );

    let body;
    if (effect.kind === 'none') {
      body = (
        <span className="flex flex-col items-center gap-0.5 text-muted-foreground">
          <Ban className="h-4 w-4" />
          <span className="text-[10px] font-medium leading-none">None</span>
        </span>
      );
    } else if (effect.kind === 'blur') {
      body = (
        <span className="flex flex-col items-center gap-0.5 text-muted-foreground">
          <Droplets className="h-4 w-4" style={{ filter: `blur(${effect.blurRadius >= 20 ? 1.2 : 0.5}px)` }} />
          <span className="text-[10px] font-medium leading-none">{effect.label}</span>
        </span>
      );
    } else {
      body = (
        <>
          <img
            src={effect.imagePath}
            alt={effect.label}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2 text-center text-[10px] font-medium leading-none text-white">
            {effect.label}
          </span>
        </>
      );
    }

    return (
      <button
        key={effect.id}
        type="button"
        disabled={disabled}
        onClick={() => onSelect(effect.id)}
        className={base}
        aria-label={`Background effect: ${effect.label}`}
        aria-pressed={isActive}
        title={effect.label}
      >
        {body}
        {isActive && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Background effects">
      {VIDEO_EFFECTS.map(tile)}
    </div>
  );
}

export default VideoEffectsPicker;
