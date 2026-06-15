import { useState, useEffect, useRef } from 'react';
import { Subtitles, MessageCircle, Users, Globe, Check, ChevronDown } from 'lucide-react';
import { normalizeMeetingLanguageCode } from '../lib/languages';
import { MeetingLanguageList, getMeetingLanguageDisplay } from './MeetingLanguageList';
import { useMeeting } from '../context/MeetingContext';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const PANEL_ITEMS = [
  { id: 'captions', label: 'Captions', icon: Subtitles },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'participants', label: 'People', icon: Users, hostOnly: true },
];

const CAPTION_MODES = [
  { value: 'off', label: 'Captions off' },
  { value: 'transcription_only', label: 'Transcription only' },
  { value: 'transcription_translation', label: 'Transcription + Translation' },
];

/**
 * Mobile-only control: one fixed-size pill to switch Captions / Chat / People
 * and adjust personal caption settings inside the same dropdown.
 */
export default function MeetingPanelMenu({
  value,
  onChange,
  onTranslationToggle,
  translationEnabled = false,
  isHost = false,
  captionMode,
  onCaptionModeChange,
  captionLanguages = [],
  onToggleCaptionLanguage,
  barBtnClass,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const {
    sidePanelOpen,
    sidePanelTab,
    openSidePanel,
    closeSidePanel,
    unreadCount,
  } = useMeeting();

  const normalizedValue = normalizeMeetingLanguageCode(value);
  const selectedLanguage = getMeetingLanguageDisplay(normalizedValue);

  const visiblePanels = PANEL_ITEMS.filter((item) => !item.hostOnly || isHost);
  const activePanel = sidePanelOpen
    ? visiblePanels.find((item) => item.id === sidePanelTab) || visiblePanels[0]
    : null;
  const ActiveIcon = activePanel?.icon || Subtitles;
  const isActive = sidePanelOpen && (sidePanelTab !== 'captions' || translationEnabled);

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

  const selectPanel = (panelId) => {
    if (sidePanelOpen && sidePanelTab === panelId) {
      closeSidePanel();
    } else {
      openSidePanel(panelId);
    }
    setIsOpen(false);
  };

  const handleLanguageSelect = (code) => {
    onChange(code);
    if (!translationEnabled) {
      onTranslationToggle();
    } else if (!sidePanelOpen || sidePanelTab !== 'captions') {
      openSidePanel('captions');
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef} data-no-translate="true">
      <Button
        type="button"
        variant={isActive ? 'success' : 'secondary'}
        onClick={() => setIsOpen((v) => !v)}
        className={cn(barBtnClass, 'relative gap-0')}
        aria-label="Open panel menu"
        aria-expanded={isOpen}
        data-no-translate="true"
      >
        <ActiveIcon className="h-5 w-5" />
        <ChevronDown className={cn('absolute bottom-1 right-1 h-2.5 w-2.5 transition-transform', isOpen && 'rotate-180')} />
        {sidePanelTab === 'chat' && unreadCount > 0 && !sidePanelOpen && (
          <span className="absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div
          className="absolute bottom-full right-0 z-[9999] mb-2 w-56 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
          data-no-translate="true"
        >
          <div className="border-b border-border p-1">
            {visiblePanels.map((item) => {
              const Icon = item.icon;
              const isSelected = sidePanelOpen && sidePanelTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectPanel(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                    isSelected && 'bg-accent'
                  )}
                  data-no-translate="true"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.id === 'chat' && unreadCount > 0 && sidePanelTab !== 'chat' && (
                    <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onTranslationToggle()}
            className={cn(
              'flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
              translationEnabled && 'bg-primary/10'
            )}
            data-no-translate="true"
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-sm">Show captions</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                translationEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {translationEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <MeetingLanguageList
            value={normalizedValue}
            onChange={handleLanguageSelect}
            disabled={!translationEnabled}
            maxHeightClass="max-h-48"
          />

          {isHost && onCaptionModeChange && (
            <div className="border-t border-border p-2">
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
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                    captionMode === mode.value && 'bg-accent'
                  )}
                >
                  <span>{mode.label}</span>
                  {captionMode === mode.value && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}

              {captionMode !== 'off' && onToggleCaptionLanguage && (
                <div className="mt-1 border-t border-border pt-1">
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Broadcast languages
                  </p>
                  <MeetingLanguageList
                    mode="multi"
                    values={captionLanguages}
                    onToggle={onToggleCaptionLanguage}
                    maxHeightClass="max-h-36"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

}
