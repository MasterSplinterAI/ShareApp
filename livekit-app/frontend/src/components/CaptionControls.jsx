import { useState, useEffect, useRef } from 'react';
import { Subtitles, Globe, Check, ChevronDown } from 'lucide-react';
import { normalizeMeetingLanguageCode } from '../lib/languages';
import { MeetingLanguageList, getMeetingLanguageDisplay } from './MeetingLanguageList';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const CAPTION_MODES = [
  { value: 'off', label: 'Captions off' },
  { value: 'transcription_only', label: 'Transcription only' },
  { value: 'transcription_translation', label: 'Transcription + Translation' },
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
  const selectedLanguage = getMeetingLanguageDisplay(normalizedValue);

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

  const handleLanguageSelect = (code) => {
    onChange(code);
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
            <MeetingLanguageList
              value={normalizedValue}
              onChange={handleLanguageSelect}
              disabled={!translationEnabled}
              maxHeightClass="max-h-44"
            />
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
                  <MeetingLanguageList
                    mode="multi"
                    values={captionLanguages}
                    onToggle={onToggleCaptionLanguage}
                    maxHeightClass="max-h-40"
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
