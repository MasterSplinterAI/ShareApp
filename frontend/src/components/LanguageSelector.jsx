import { useState, useEffect } from 'react';
import { translationService } from '../services/api';

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
];

const LanguageSelector = ({ meetingId, participantId, currentLanguage, onLanguageChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(currentLanguage || 'en');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedLanguage(currentLanguage || 'en');
  }, [currentLanguage]);

  const handleLanguageSelect = async (languageCode) => {
    if (languageCode === selectedLanguage) {
      setIsOpen(false);
      return;
    }

    setLoading(true);
    try {
      // Update language preference on backend
      await translationService.setLanguagePreference(meetingId, participantId, languageCode);
      setSelectedLanguage(languageCode);
      if (onLanguageChange) {
        onLanguageChange(languageCode);
      }
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to set language preference:', error);
      alert('Failed to update language preference. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedLang = LANGUAGES.find(lang => lang.code === selectedLanguage) || LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className="bg-white rounded-lg shadow-md px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors disabled:opacity-50"
        aria-label="Select language"
      >
        <span className="text-xl">{selectedLang.flag}</span>
        <span className="text-sm font-medium text-gray-700 hidden md:block">{selectedLang.name}</span>
        <svg className={`w-4 h-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-64 overflow-y-auto min-w-[200px]">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageSelect(lang.code)}
                className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-gray-100 transition-colors ${
                  lang.code === selectedLanguage ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className="text-xl">{lang.flag}</span>
                <span className="text-sm font-medium">{lang.name}</span>
                {lang.code === selectedLanguage && (
                  <svg className="w-4 h-4 ml-auto text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default LanguageSelector;

