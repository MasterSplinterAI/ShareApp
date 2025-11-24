import { useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'es-CO', name: 'Colombian Spanish', flag: '🇨🇴' },
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
  { code: 'tiv', name: 'Tiv', flag: '🇳🇬' },
];

function LanguageSelector({ value, onChange, onTranslationToggle, translationEnabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLanguage = SUPPORTED_LANGUAGES.find(lang => lang.code === value) || SUPPORTED_LANGUAGES[0];

  const handleLanguageSelect = (language) => {
    onChange(language.code);
    setIsOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Translation Toggle */}
      <button
        onClick={onTranslationToggle}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
          translationEnabled 
            ? 'bg-green-600 hover:bg-green-700 text-white' 
            : 'bg-white/10 hover:bg-white/15 text-white'
        }`}
        title={translationEnabled ? 'Translation ON' : 'Translation OFF'}
        aria-label={translationEnabled ? 'Disable translation' : 'Enable translation'}
      >
        <Globe className="w-5 h-5" />
        <span className="text-sm font-medium hidden sm:inline">Translation</span>
      </button>

      {/* Language Selector */}
      <div className="relative">
        <button
          onClick={() => translationEnabled && setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
            translationEnabled
              ? 'bg-white/10 hover:bg-white/15 text-white'
              : 'bg-white/5 text-white/50 cursor-not-allowed'
          }`}
          disabled={!translationEnabled}
          aria-label="Select language"
        >
          <span className="text-base">{selectedLanguage.flag}</span>
          <span className="text-sm font-medium hidden sm:inline">{selectedLanguage.name}</span>
          {translationEnabled && (
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          )}
        </button>

        {/* Dropdown Menu - Positioned above button */}
        {isOpen && translationEnabled && (
          <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-[9999] max-h-80 overflow-y-auto">
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
    </div>
  );
}

export default LanguageSelector;
