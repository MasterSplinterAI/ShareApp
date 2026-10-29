import { MessageSquare, MessageCircle, Users, X, Download, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useMeeting } from '../context/MeetingContext';
import { useRoomControlLabels } from '../hooks/useRoomControlLabels';

/**
 * Shared tab header used by TranscriptionPanel, ChatPanel, and ParticipantsPanel.
 * Renders a mobile grab-handle bar on top to cycle sheet height ('sm' | 'md' | 'lg'),
 * plus [Captions] [Chat (unread)] [Participants?] ... [Resize?] [Download?] [Minimize?] [X].
 */
export default function PanelTabs({ onDownload, canDownload = false, compact = false, onMinimize }) {
  const {
    sidePanelTab,
    setSidePanelTab,
    closeSidePanel,
    unreadCount,
    isHost,
    selectedLanguage,
    mobileSheetSize,
    cycleMobileSheetSize,
  } = useMeeting();
  const t = useRoomControlLabels(selectedLanguage);

  const padding = compact ? 'px-2.5 py-1.5' : 'px-3 py-2 sm:px-4 sm:py-3';
  const tabText = compact ? 'text-xs' : 'text-sm';

  const tabBtn = (active) =>
    `flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tabText} font-medium ${
      active
        ? 'meeting-tab-pill-active text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
    }`;

  const sizeLabel =
    mobileSheetSize === 'lg' ? 'Large' : mobileSheetSize === 'sm' ? 'Compact' : 'Medium';

  return (
    <div className="meeting-tab-strip border-b flex-shrink-0 rounded-t-xl sm:rounded-none">
      {/* Mobile grab handle: tap to cycle sheet height (Compact -> Medium -> Large) */}
      <button
        type="button"
        onClick={cycleMobileSheetSize}
        className="flex w-full items-center justify-center pt-1.5 pb-0.5 sm:hidden focus-visible:outline-none"
        aria-label={`Resize panel (current: ${sizeLabel})`}
        title={`Tap to resize panel (${sizeLabel})`}
      >
        <span className="h-1 w-9 rounded-full bg-muted-foreground/30 transition-colors hover:bg-muted-foreground/50" />
      </button>

      <div className={`flex items-center justify-between ${padding}`}>
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide" role="tablist">
          <button
            type="button"
            onClick={() => setSidePanelTab('captions')}
            className={tabBtn(sidePanelTab === 'captions')}
            aria-label="Captions tab"
            aria-selected={sidePanelTab === 'captions'}
            role="tab"
          >
            <MessageSquare className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
            <span className="truncate">{t('captions')}</span>
          </button>
          <button
            type="button"
            onClick={() => setSidePanelTab('chat')}
            className={`${tabBtn(sidePanelTab === 'chat')} relative`}
            aria-label="Chat tab"
            aria-selected={sidePanelTab === 'chat'}
            role="tab"
          >
            <MessageCircle className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
            <span className="truncate">{t('chat')}</span>
            {sidePanelTab !== 'chat' && unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => setSidePanelTab('participants')}
              className={tabBtn(sidePanelTab === 'participants')}
              aria-label="Participants tab"
              aria-selected={sidePanelTab === 'participants'}
              role="tab"
            >
              <Users className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'} />
              <span className="truncate">{t('people')}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={cycleMobileSheetSize}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
            aria-label={`Resize panel (${sizeLabel})`}
            title={`Resize panel (${sizeLabel})`}
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
          </button>
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={!canDownload}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Download transcript"
              title="Download transcript"
            >
              <Download className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
            </button>
          )}
          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Minimize panel"
              title="Minimize"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={closeSidePanel}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
