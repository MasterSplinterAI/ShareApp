import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { normalizeMeetingLanguageCode } from '../lib/languages';

const MeetingContext = createContext(null);

export function MeetingProvider({ children, initialState = {} }) {
  const [selectedLanguage, setSelectedLanguageState] = useState(() =>
    normalizeMeetingLanguageCode(initialState.selectedLanguage || 'en')
  );

  const setSelectedLanguage = useCallback((code) => {
    setSelectedLanguageState(normalizeMeetingLanguageCode(code || 'en'));
  }, []);

  const [translationEnabled, setTranslationEnabled] = useState(initialState.translationEnabled ?? true);

  // Unified side panel: one panel, two tabs.
  const [sidePanelOpen, setSidePanelOpen] = useState(initialState.translationEnabled ?? true);
  const [sidePanelTab, setSidePanelTabState] = useState('captions'); // 'captions' | 'chat'
  const [unreadCount, setUnreadCount] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const setSidePanelTab = useCallback((tab) => {
    setSidePanelTabState(tab);
    if (tab === 'chat') setUnreadCount(0);
  }, []);

  const openSidePanel = useCallback((tab) => {
    setSidePanelOpen(true);
    if (tab) {
      setSidePanelTabState(tab);
      if (tab === 'chat') setUnreadCount(0);
    }
  }, []);

  const closeSidePanel = useCallback(() => {
    setSidePanelOpen(false);
  }, []);

  const toggleSidePanel = useCallback(() => {
    setSidePanelOpen((prev) => !prev);
  }, []);

  // Legacy API kept so existing panels keep working without rewrites.
  const isPanelOpen = sidePanelOpen && sidePanelTab === 'captions';
  const isChatOpen = sidePanelOpen && sidePanelTab === 'chat';

  const setIsPanelOpen = useCallback((val) => {
    if (val) {
      setSidePanelOpen(true);
      setSidePanelTabState('captions');
    } else {
      setSidePanelOpen(false);
    }
  }, []);

  const setIsChatOpen = useCallback((val) => {
    if (val) {
      setSidePanelOpen(true);
      setSidePanelTabState('chat');
      setUnreadCount(0);
    } else {
      setSidePanelOpen(false);
    }
  }, []);

  const togglePanel = useCallback(() => {
    // Clicking the captions entry point: go to captions tab; if already there, close.
    if (sidePanelOpen && sidePanelTab === 'captions') {
      setSidePanelOpen(false);
    } else {
      setSidePanelOpen(true);
      setSidePanelTabState('captions');
    }
  }, [sidePanelOpen, sidePanelTab]);

  const toggleChat = useCallback(() => {
    if (sidePanelOpen && sidePanelTab === 'chat') {
      setSidePanelOpen(false);
    } else {
      setSidePanelOpen(true);
      setSidePanelTabState('chat');
      setUnreadCount(0);
    }
  }, [sidePanelOpen, sidePanelTab]);

  const markChatRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const incrementChatUnread = useCallback(() => {
    setUnreadCount((c) => c + 1);
  }, []);

  const value = useMemo(() => ({
    // Room info
    roomName: initialState.roomName || '',
    isHost: initialState.isHost || false,
    participantName: initialState.participantName || '',
    spokenLanguage: selectedLanguage,

    // Language
    selectedLanguage,
    setSelectedLanguage,
    translationEnabled,
    setTranslationEnabled,

    // Unified side panel
    sidePanelOpen,
    sidePanelTab,
    setSidePanelTab,
    openSidePanel,
    closeSidePanel,
    toggleSidePanel,

    // Legacy-compatible flags derived from the unified state
    isPanelOpen,
    setIsPanelOpen,
    togglePanel,
    isChatOpen,
    setIsChatOpen,
    toggleChat,

    // Chat unread
    unreadCount,
    markChatRead,
    incrementChatUnread,

    // Full screen
    isFullScreen,
    setIsFullScreen,

    // Mode
    meetingMode: initialState.meetingMode || 'translation',
  }), [
    initialState.roomName,
    initialState.isHost,
    initialState.participantName,
    initialState.meetingMode,
    selectedLanguage,
    setSelectedLanguage,
    translationEnabled,
    sidePanelOpen,
    sidePanelTab,
    setSidePanelTab,
    openSidePanel,
    closeSidePanel,
    toggleSidePanel,
    isPanelOpen,
    setIsPanelOpen,
    togglePanel,
    isChatOpen,
    setIsChatOpen,
    toggleChat,
    unreadCount,
    markChatRead,
    incrementChatUnread,
    isFullScreen,
  ]);

  return (
    <MeetingContext.Provider value={value}>
      {children}
    </MeetingContext.Provider>
  );
}

export function useMeeting() {
  const context = useContext(MeetingContext);
  if (!context) {
    throw new Error('useMeeting must be used within a MeetingProvider');
  }
  return context;
}
