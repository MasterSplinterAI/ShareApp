import { useState, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { normalizeMeetingLanguageCode } from '../lib/languages';
import { MeetingLanguageList, getMeetingLanguageDisplay } from './MeetingLanguageList';

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
  const selectedLanguage = getMeetingLanguageDisplay(normalizedValue);

  const handleLanguageSelect = (code) => {
    onChange(code);
    setIsOpen(false);
  };

  return (
    <div data-no-translate="true">
      {!isCompact && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTranslationToggle}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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
                className="absolute bottom-full right-0 z-[9999] mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
                data-no-translate="true"
              >
                <MeetingLanguageList
                  value={normalizedValue}
                  onChange={handleLanguageSelect}
                  maxHeightClass="max-h-80"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {isCompact && (
        <div className="relative" data-no-translate="true">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`flex items-center gap-1 rounded-lg px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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
              className="absolute bottom-full right-0 z-[9999] mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
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
              <MeetingLanguageList
                value={normalizedValue}
                onChange={handleLanguageSelect}
                disabled={!translationEnabled}
                maxHeightClass="max-h-56"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
