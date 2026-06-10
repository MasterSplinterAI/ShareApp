import { MessageSquare, MessageCircle, Users, X, Download, ChevronDown } from 'lucide-react';
import { useMeeting } from '../context/MeetingContext';

/**
 * Shared tab header used by TranscriptionPanel and ChatPanel so both tabs are
 * reachable from either panel. Renders: [Captions] [Chat (unread)] [Participants?] ... [Download?] [Minimize?] [X]
 * When `onMinimize` is provided (mobile bottom sheet), a chevron-down collapses
 * the sheet back to its compact bar instead of closing the panel entirely.
 */
export default function PanelTabs({ onDownload, canDownload = false, compact = false, onMinimize }) {
  const { sidePanelTab, setSidePanelTab, closeSidePanel, unreadCount, isHost } = useMeeting();

  const padding = compact ? 'px-3 py-2' : 'px-3 py-2 sm:px-4 sm:py-3';
  const tabText = compact ? 'text-xs' : 'text-sm';

  const tabBtn = (active) =>
    `flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tabText} font-medium ${
      active
        ? 'meeting-tab-pill-active text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
    }`;

  return (
    <div
      className={`flex items-center justify-between ${padding} meeting-tab-strip border-b flex-shrink-0 rounded-t-xl sm:rounded-none`}
    >
      <div className="flex items-center gap-1" role="tablist">
        <button
          type="button"
          onClick={() => setSidePanelTab('captions')}
          className={tabBtn(sidePanelTab === 'captions')}
          aria-label="Captions tab"
          aria-selected={sidePanelTab === 'captions'}
          role="tab"
        >
          <MessageSquare className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          <span>Captions</span>
        </button>
        <button
          type="button"
          onClick={() => setSidePanelTab('chat')}
          className={`${tabBtn(sidePanelTab === 'chat')} relative`}
          aria-label="Chat tab"
          aria-selected={sidePanelTab === 'chat'}
          role="tab"
        >
          <MessageCircle className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          <span>Chat</span>
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
            <Users className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
            <span>People</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={!canDownload}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Minimize panel"
            title="Minimize"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={closeSidePanel}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
