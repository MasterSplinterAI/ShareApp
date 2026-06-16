import { useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { MeetingLanguageList } from './MeetingLanguageList';
import { CORE_UI_LOCALE_CODES, getUiLanguageDisplay, getUiLanguages } from '../lib/i18n/uiLanguages';
import { useTranslation } from '../lib/i18n/I18nProvider';
import { cn } from '../lib/utils';

const UI_LANGUAGES = getUiLanguages();

/**
 * Site-wide locale switcher with search — core locales use JSON bundles;
 * all Deepgram languages use English copy + live DOM translation.
 */
export function LanguageSwitcher({ className, compact = false }) {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = getUiLanguageDisplay(locale);

  const handleSelect = (code) => {
    setLocale(code);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'sm'}
          className={cn('shrink-0 gap-1.5', className)}
          aria-label={t('language.choose')}
        >
          <Globe className="h-4 w-4 shrink-0" />
          {!compact && (
            <span className="hidden max-w-[7rem] truncate sm:inline">{current.nativeName}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-0" data-no-translate="true">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">{t('language.label')}</p>
          <p className="text-xs text-muted-foreground">
            Built-in locales ship translated UI. Others translate live in your browser.
          </p>
        </div>
        <MeetingLanguageList
          value={locale}
          onChange={handleSelect}
          languages={UI_LANGUAGES}
          coreLocaleCodes={CORE_UI_LOCALE_CODES}
          maxHeightClass="max-h-[min(22rem,55dvh)]"
          searchPlaceholder="Search languages…"
          className="border-0"
        />
        {locale && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Selected: <span className="font-medium text-foreground">{current.nativeName}</span>
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
