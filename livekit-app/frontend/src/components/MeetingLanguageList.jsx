import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import {
  getMeetingLanguages,
  normalizeMeetingLanguageCode,
} from '../lib/languages';
import { filterMeetingLanguages, splitPopularLanguages } from '../lib/deepgramLanguages';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

const ALL_LANGUAGES = getMeetingLanguages();

function LanguageRow({
  language,
  selected,
  onSelect,
  disabled,
  mode,
  multiSelected,
  showCoreBadge,
}) {
  const isSelected = mode === 'multi' ? multiSelected : selected;

  return (
    <button
      type="button"
      onClick={() => onSelect(language.code)}
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
        isSelected && 'bg-accent',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      data-no-translate="true"
    >
      <span className="flex min-w-0 items-center gap-2" data-no-translate="true">
        {language.flag ? (
          <span className="shrink-0 text-base leading-none" aria-hidden="true">
            {language.flag}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="block truncate text-foreground">{language.name}</span>
            {showCoreBadge ? (
              <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                Built-in
              </span>
            ) : null}
          </span>
          {language.nativeName !== language.name ? (
            <span className="block truncate text-xs text-muted-foreground">{language.nativeName}</span>
          ) : null}
        </span>
      </span>
      {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
    </button>
  );
}

/**
 * Searchable, scrollable Deepgram language list — popular languages first.
 */
export function MeetingLanguageList({
  value,
  values,
  onChange,
  onToggle,
  mode = 'single',
  disabled = false,
  maxHeightClass = 'max-h-[min(18rem,50dvh)]',
  searchPlaceholder = 'Search languages…',
  showSearch = true,
  className,
  languages: languagesProp,
  coreLocaleCodes,
}) {
  const [query, setQuery] = useState('');
  const baseLanguages = languagesProp ?? ALL_LANGUAGES;
  const normalizedValue = normalizeMeetingLanguageCode(value);
  const selectedSet = useMemo(() => new Set((values || []).map(normalizeMeetingLanguageCode)), [values]);

  const filtered = useMemo(
    () => filterMeetingLanguages(baseLanguages, query),
    [baseLanguages, query]
  );
  const { popular, other } = useMemo(
    () => splitPopularLanguages(filtered, query),
    [filtered, query]
  );

  const handleSelect = (code) => {
    if (mode === 'multi') {
      onToggle?.(code);
      return;
    }
    onChange?.(code);
  };

  return (
    <div className={cn('flex flex-col', className)} data-no-translate="true">
      {showSearch && (
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
              aria-label={searchPlaceholder}
              data-no-translate="true"
            />
          </div>
        </div>
      )}

      <div className={cn('overflow-y-auto py-1', maxHeightClass)}>
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No languages match your search.</p>
        ) : (
          <>
            {popular.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Popular
                </p>
                {popular.map((language) => (
                  <LanguageRow
                    key={language.code}
                    language={language}
                    selected={language.code === normalizedValue}
                    multiSelected={selectedSet.has(language.code)}
                    onSelect={handleSelect}
                    disabled={disabled}
                    mode={mode}
                    showCoreBadge={coreLocaleCodes?.has(language.code)}
                  />
                ))}
                {other.length > 0 && <div className="my-1 border-t border-border/60" />}
              </>
            )}
            {other.length > 0 && (
              <>
                {popular.length === 0 ? null : (
                  <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    All languages
                  </p>
                )}
                {other.map((language) => (
                  <LanguageRow
                    key={language.code}
                    language={language}
                    selected={language.code === normalizedValue}
                    multiSelected={selectedSet.has(language.code)}
                    onSelect={handleSelect}
                    disabled={disabled}
                    mode={mode}
                    showCoreBadge={coreLocaleCodes?.has(language.code)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function getMeetingLanguageDisplay(code) {
  const normalized = normalizeMeetingLanguageCode(code);
  return ALL_LANGUAGES.find((lang) => lang.code === normalized) || ALL_LANGUAGES[0];
}
