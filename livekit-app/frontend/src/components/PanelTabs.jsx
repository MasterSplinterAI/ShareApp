import { MessageSquare, MessageCircle, Users, X, Download } from 'lucide-react';
import { useMeeting } from '../context/MeetingContext';

/**
 * Shared tab header used by TranscriptionPanel and ChatPanel so both tabs are
 * reachable from either panel. Renders: [Captions] [Chat (unread)] [Participants?] ... [Download?] [X]
 */
export default function PanelTabs({ onDownload, canDownload = false, compact = false }) {
  const { sidePanelTab, setSidePanelTab, closeSidePanel, unreadCount, isHost } = useMeeting();

  const padding = compact ? 'px-3 py-2' : 'px-3 py-2 sm:px-4 sm:py-3';
  const tabText = compact ? 'text-xs' : 'text-sm';

  const tabBtn = (active) =>
    `flex items-center gap-1.5 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} rounded-md transition-colors ${tabText} font-medium ${
      active
        ? 'meeting-tab-pill-active text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
    }`;

  return (
    <div
      className={`flex items-center justify-between ${padding} meeting-tab-strip border-b flex-shrink-0 rounded-t-xl sm:rounded-none`}
    >
      <div className="flex items-center gap-1">
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
            <span className="absolute -top-1 -right-1 min-w-[1.125rem] h-[1.125rem] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold">
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
            className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Download transcript"
            title="Download transcript"
          >
            <Download className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </button>
        )}
        <button
          type="button"
          onClick={closeSidePanel}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
