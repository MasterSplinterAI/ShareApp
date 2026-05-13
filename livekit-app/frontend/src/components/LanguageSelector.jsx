import { useState, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../lib/languages';

const MEETING_LANGUAGES = getMeetingLanguages();

function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const check = () => setIsCompact(window.innerWidth < 640 || window.innerHeight < 500);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isCompact;
}

function LanguageSelector({ value, onChange, onTranslationToggle, translationEnabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const isCompact = useIsCompact();
  const normalizedValue = normalizeMeetingLanguageCode(value);
  const selectedLanguage = MEETING_LANGUAGES.find((lang) => lang.code === normalizedValue) || MEETING_LANGUAGES[0];

  const handleLanguageSelect = (language) => {
    onChange(language.code);
    setIsOpen(false);
  };

  return (
    <div data-no-translate="true">
      {/* Desktop: separate toggle + selector */}
      {!isCompact && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTranslationToggle}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-all ${
              translationEnabled
                ? 'bg-emerald-600 text-primary-foreground hover:bg-emerald-700'
                : 'bg-muted text-foreground hover:bg-muted/80'
            }`}
            title={translationEnabled ? 'Captions ON' : 'Captions OFF'}
            aria-label={translationEnabled ? 'Disable captions' : 'Enable captions'}
            data-no-translate="true"
          >
            <Globe className="h-5 w-5" />
            <span className="text-sm font-medium" data-no-translate="true">
              Captions
            </span>
          </button>

          <div className="relative" data-no-translate="true">
            <button
              type="button"
              onClick={() => translationEnabled && setIsOpen(!isOpen)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-all ${
                translationEnabled
                  ? 'bg-muted text-foreground hover:bg-muted/80'
                  : 'cursor-not-allowed bg-muted/50 text-muted-foreground'
              }`}
              disabled={!translationEnabled}
              aria-label="Select language"
              data-no-translate="true"
            >
              <span className="text-base" data-no-translate="true">
                {selectedLanguage.flag}
              </span>
              <span className="text-sm font-medium" data-no-translate="true">
                {selectedLanguage.name}
              </span>
              {translationEnabled && (
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              )}
            </button>

            {isOpen && translationEnabled && (
              <div
                className="absolute bottom-full right-0 z-[9999] mb-2 max-h-80 w-48 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
                data-no-translate="true"
              >
                {MEETING_LANGUAGES.map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    onClick={() => handleLanguageSelect(language)}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-accent ${
                      language.code === normalizedValue ? 'bg-accent' : ''
                    }`}
                    data-no-translate="true"
                  >
                    <span className="flex items-center gap-2" data-no-translate="true">
                      <span className="text-base" data-no-translate="true">
                        {language.flag}
                      </span>
                      <span className="text-sm text-foreground" data-no-translate="true">
                        {language.name}
                      </span>
                    </span>
                    {language.code === normalizedValue && <Check className="h-4 w-4 text-emerald-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compact: single button with combined popover */}
      {isCompact && (
        <div className="relative" data-no-translate="true">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`flex items-center gap-1 rounded-lg px-2 py-2 transition-all ${
              translationEnabled
                ? 'bg-emerald-600 text-primary-foreground hover:bg-emerald-700'
                : 'bg-muted text-foreground hover:bg-muted/80'
            }`}
            aria-label="Captions settings"
            data-no-translate="true"
          >
            <span className="text-sm" data-no-translate="true">
              {selectedLanguage.flag}
            </span>
            <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOpen && (
            <div
              className="absolute bottom-full right-0 z-[9999] mb-2 w-52 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
              data-no-translate="true"
            >
              <button
                type="button"
                onClick={() => {
                  onTranslationToggle();
                }}
                className={`flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left ${
                  translationEnabled ? 'bg-emerald-600/10' : 'bg-muted/30'
                }`}
                data-no-translate="true"
              >
                <Globe className="h-4 w-4" />
                <span className="flex-1 text-sm text-foreground" data-no-translate="true">
                  Captions
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    translationEnabled ? 'bg-emerald-600 text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {translationEnabled ? 'ON' : 'OFF'}
                </span>
              </button>
              <div className="max-h-56 overflow-y-auto">
                {MEETING_LANGUAGES.map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    onClick={() => handleLanguageSelect(language)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-accent ${
                      language.code === normalizedValue ? 'bg-accent' : ''
                    } ${!translationEnabled ? 'opacity-50' : ''}`}
                    disabled={!translationEnabled}
                    data-no-translate="true"
                  >
                    <span className="flex items-center gap-2" data-no-translate="true">
                      <span className="text-sm" data-no-translate="true">
                        {language.flag}
                      </span>
                      <span className="text-xs text-foreground" data-no-translate="true">
                        {language.name}
                      </span>
                    </span>
                    {language.code === normalizedValue && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
