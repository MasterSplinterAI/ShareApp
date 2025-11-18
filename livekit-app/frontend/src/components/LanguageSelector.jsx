import { useState } from 'react';
import { Globe, Check } from 'lucide-react';

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
];

function LanguageSelector({ value, onChange, onTranslationToggle, translationEnabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLanguage = SUPPORTED_LANGUAGES.find(lang => lang.code === value) || SUPPORTED_LANGUAGES[0];

  const handleLanguageSelect = (language) => {
    onChange(language.code);
    setIsOpen(false);
  };

  return (
    <div className="relative lk-language-selector">
      <div className="flex items-center gap-2">
        {/* Translation Toggle */}
        <button
          onClick={onTranslationToggle}
          className={`lk-translation-toggle p-2 rounded-lg transition-all min-w-[44px] min-h-[44px] md:min-w-[48px] md:min-h-[48px] flex items-center justify-center ${
            translationEnabled 
              ? 'bg-green-600 hover:bg-green-700 text-white' 
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          title={translationEnabled ? 'Translation ON' : 'Translation OFF'}
          aria-label={translationEnabled ? 'Disable translation' : 'Enable translation'}
        >
          <Globe className="w-5 h-5 md:w-6 md:h-6" />
        </button>

        {/* Language Selector */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="lk-language-button bg-gray-700 hover:bg-gray-600 text-white px-2 py-2 md:px-3 md:py-2 rounded-lg transition-colors flex items-center gap-2 text-sm min-h-[44px] md:min-h-[48px]"
          disabled={!translationEnabled}
          aria-label="Select language"
        >
          <span className="text-base md:text-lg">{selectedLanguage.flag}</span>
          <span className="hidden sm:inline">{selectedLanguage.name}</span>
        </button>
      </div>

      {/* Dropdown Menu - Positioned above on mobile, below on desktop */}
      {isOpen && translationEnabled && (
        <div className="lk-language-dropdown absolute bottom-full right-0 mb-2 md:bottom-full md:mb-2 w-48 bg-gray-800 rounded-lg shadow-lg border border-gray-700 z-50 max-h-80 overflow-y-auto">
          {SUPPORTED_LANGUAGES.map((language) => (
            <button
              key={language.code}
              onClick={() => handleLanguageSelect(language)}
              className={`w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors flex items-center justify-between ${
                language.code === value ? 'bg-gray-700' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-base">{language.flag}</span>
                <span className="text-sm text-white">{language.name}</span>
              </span>
              {language.code === value && (
                <Check className="w-4 h-4 text-green-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
