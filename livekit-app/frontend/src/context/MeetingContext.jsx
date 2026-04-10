import { createContext, useContext, useState, useCallback } from 'react';
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
  const [isPanelOpen, setIsPanelOpen] = useState(initialState.translationEnabled ?? true);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const togglePanel = useCallback(() => {
    setIsPanelOpen(prev => !prev);
  }, []);

  const value = {
    // Room info
    roomName: initialState.roomName || '',
    isHost: initialState.isHost || false,
    participantName: initialState.participantName || '',
    // Same as selectedLanguage: one user language for STT (speak) and captions (read).
    spokenLanguage: selectedLanguage,

    // Language
    selectedLanguage,
    setSelectedLanguage,
    translationEnabled,
    setTranslationEnabled,

    // Panel
    isPanelOpen,
    setIsPanelOpen,
    togglePanel,

    // Full screen
    isFullScreen,
    setIsFullScreen,

    // Future: meeting mode
    meetingMode: initialState.meetingMode || 'translation', // 'translation' | 'transcription-only'
  };

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
