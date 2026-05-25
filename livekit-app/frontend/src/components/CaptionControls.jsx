import { useState, useEffect, useRef } from 'react';
import { Subtitles, Globe, Check, ChevronDown } from 'lucide-react';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../lib/languages';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const MEETING_LANGUAGES = getMeetingLanguages();

const CAPTION_MODES = [
  { value: 'off', label: 'Captions off' },
  { value: 'transcription_only', label: 'Transcription only' },
  { value: 'transcription_translation', label: 'Transcription + Translation' },
];

const CAPTION_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh-CN', name: 'Mandarin' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ru', name: 'Russian' },
  { code: 'tiv', name: 'Tiv' },
];

/**
 * Desktop caption control: one "Captions" pill with a dropdown for personal
 * settings and (when host) room broadcast configuration.
 */
export default function CaptionControls({
  value,
  onChange,
  onTranslationToggle,
  translationEnabled = false,
  isHost = false,
  captionMode,
  onCaptionModeChange,
  captionLanguages,
  onToggleCaptionLanguage,
  barBtnClass,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const normalizedValue = normalizeMeetingLanguageCode(value);
  const selectedLanguage =
    MEETING_LANGUAGES.find((lang) => lang.code === normalizedValue) || MEETING_LANGUAGES[0];

  const isActive = translationEnabled || (isHost && captionMode !== 'off');

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleOrientationChange = () => setIsOpen(false);
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => window.removeEventListener('orientationchange', handleOrientationChange);
  }, []);

  const handleLanguageSelect = (language) => {
    onChange(language.code);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef} data-no-translate="true">
      <Button
        type="button"
        variant={isActive ? 'success' : 'secondary'}
        onClick={() => setIsOpen((v) => !v)}
        className={cn(barBtnClass, 'gap-1.5')}
        aria-label="Caption settings"
        aria-expanded={isOpen}
        data-no-translate="true"
      >
        <Subtitles className="h-5 w-5" />
        <span className="text-sm font-medium">Captions</span>
        <span className="text-base leading-none" data-no-translate="true">
          {selectedLanguage.flag}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
      </Button>

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
            className={cn(
              'flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent',
              translationEnabled && 'bg-primary/10'
            )}
            data-no-translate="true"
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-sm">Show my captions</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                translationEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {translationEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <div className="border-b border-border px-2 py-2">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your language
            </p>
            <div className="max-h-40 overflow-y-auto">
              {MEETING_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => handleLanguageSelect(language)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                    language.code === normalizedValue && 'bg-accent',
                    !translationEnabled && 'opacity-50'
                  )}
                  disabled={!translationEnabled}
                  data-no-translate="true"
                >
                  <span className="flex items-center gap-2" data-no-translate="true">
                    <span className="text-sm">{language.flag}</span>
                    <span className="text-sm text-foreground">{language.name}</span>
                  </span>
                  {language.code === normalizedValue && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
          </div>

          {isHost && (
            <div className="p-2">
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Room broadcast
              </p>
              {CAPTION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => {
                    onCaptionModeChange(mode.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                    captionMode === mode.value && 'bg-accent'
                  )}
                >
                  <span>{mode.label}</span>
                  {captionMode === mode.value && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}

              {captionMode !== 'off' && (
                <>
                  <div className="my-1.5 border-t border-border" />
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Broadcast languages
                  </p>
                  <div className="flex flex-wrap gap-1 px-1 pb-1">
                    {CAPTION_LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => onToggleCaptionLanguage(lang.code)}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs transition-colors',
                          captionLanguages.includes(lang.code)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-transparent text-popover-foreground hover:bg-accent'
                        )}
                      >
                        {lang.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
