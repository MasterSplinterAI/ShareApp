import { ChevronDown } from 'lucide-react';
import { normalizeMeetingLanguageCode, writeStoredMeetingLanguage } from '../lib/languages';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { MeetingLanguageList, getMeetingLanguageDisplay } from './MeetingLanguageList';
import { cn } from '../lib/utils';

/**
 * Trigger + popover wrapper for meeting caption language selection.
 * Persists choice to localStorage (`app_language`) when `persist` is true.
 */
export function MeetingLanguagePicker({
  value,
  onChange,
  disabled = false,
  persist = true,
  align = 'start',
  fullWidth = true,
  buttonClassName,
  contentClassName,
  onOpenChange,
  open,
  showSearch = true,
  maxHeightClass,
}) {
  const normalized = normalizeMeetingLanguageCode(value);
  const selected = getMeetingLanguageDisplay(normalized);

  const handleChange = (code) => {
    const next = normalizeMeetingLanguageCode(code);
    if (persist) writeStoredMeetingLanguage(next);
    onChange?.(next);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            fullWidth && 'w-full',
            'justify-between font-normal',
            buttonClassName
          )}
          data-no-translate="true"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected.flag ? <span className="shrink-0">{selected.flag}</span> : null}
            <span className="truncate">{selected.name}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[min(100vw-2rem,20rem)] p-0', contentClassName)}
        align={align}
        data-no-translate="true"
      >
        <MeetingLanguageList
          value={normalized}
          onChange={(code) => {
            handleChange(code);
            onOpenChange?.(false);
          }}
          disabled={disabled}
          showSearch={showSearch}
          maxHeightClass={maxHeightClass}
        />
      </PopoverContent>
    </Popover>
  );
}
