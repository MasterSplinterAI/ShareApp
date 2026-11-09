import { useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { MeetingLanguageList, getMeetingLanguageDisplay } from './MeetingLanguageList';
import {
  QUICK_PICK_GUEST_LANGUAGES,
  resolvePreselectedLanguage,
} from '../lib/guestLanguage';
import { cn } from '../lib/utils';

/**
 * Reusable "Guest's language" selector for shared meeting links, QR codes,
 * email invites, and contacts.
 *
 * When `value` is `''` (empty string), the link lets the guest choose their own
 * language. When a language code is selected, the share URL & QR code include
 * `?lang=<code>` so the recipient's join screen & room default to that language.
 */
export function GuestLanguageSelector({
  value = '',
  onChange,
  label = "Guest's language",
  showQuickPicks = true,
  compact = false,
  className = '',
  align = 'start',
}) {
  const [open, setOpen] = useState(false);
  const resolved = resolvePreselectedLanguage(value) || '';
  const selectedLang = resolved ? getMeetingLanguageDisplay(resolved) : null;

  const handleSelect = (code) => {
    const next = resolvePreselectedLanguage(code) || '';
    onChange?.(next);
    setOpen(false);
  };

  return (
    <div
      className={cn('space-y-2', className)}
      data-testid="guest-language-selector"
      data-no-translate="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Globe className="h-3.5 w-3.5 text-primary" />
          <span>{label}:</span>
        </span>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="guest-language-dropdown-trigger"
              className={cn(
                'h-8 gap-2 px-2.5 text-xs font-medium',
                resolved && 'border-primary/50 bg-primary/5 text-foreground'
              )}
              data-no-translate="true"
            >
              {selectedLang ? (
                <span className="flex items-center gap-1.5">
                  {selectedLang.flag ? <span>{selectedLang.flag}</span> : null}
                  <span>
                    {selectedLang.name}
                    {selectedLang.nativeName && selectedLang.nativeName !== selectedLang.name
                      ? ` (${selectedLang.nativeName})`
                      : ''}
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span>🌐</span>
                  <span>Auto / Let guest choose</span>
                </span>
              )}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(100vw-2rem,20rem)] p-0"
            align={align}
            data-no-translate="true"
          >
            <div className="border-b border-border p-1.5">
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-accent',
                  !resolved && 'bg-accent text-foreground'
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-base leading-none">🌐</span>
                  <span>
                    <span className="block text-foreground">Auto / Let guest choose</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      Guest picks their own language on join
                    </span>
                  </span>
                </span>
                {!resolved ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            </div>
            <MeetingLanguageList
              value={resolved || 'en'}
              onChange={(code) => handleSelect(code)}
              showSearch
              maxHeightClass="max-h-60"
            />
          </PopoverContent>
        </Popover>
      </div>

      {showQuickPicks && !compact && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick pick guest language">
          {QUICK_PICK_GUEST_LANGUAGES.map((item) => {
            const isActive = item.code === resolved;
            return (
              <button
                key={item.code || 'auto'}
                type="button"
                data-testid={`guest-lang-pill-${item.code || 'auto'}`}
                onClick={() => handleSelect(item.code)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/70 bg-background/80 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                <span>{item.flag}</span>
                <span>{item.code ? item.nativeLabel : 'Auto'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default GuestLanguageSelector;
