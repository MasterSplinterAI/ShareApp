import { useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
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
    <div data-no-translate="true">
      {/* Desktop: separate toggle + selector */}
      <div className="hidden sm:flex items-center gap-2">
        <button
          onClick={onTranslationToggle}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
            translationEnabled
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-white/10 hover:bg-white/15 text-white'
          }`}
          title={translationEnabled ? 'Translation ON' : 'Translation OFF'}
          aria-label={translationEnabled ? 'Disable translation' : 'Enable translation'}
          data-no-translate="true"
        >
          <Globe className="w-5 h-5" />
          <span className="text-sm font-medium" data-no-translate="true">Translation</span>
        </button>

        <div className="relative" data-no-translate="true">
          <button
            onClick={() => translationEnabled && setIsOpen(!isOpen)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              translationEnabled
                ? 'bg-white/10 hover:bg-white/15 text-white'
                : 'bg-white/5 text-white/50 cursor-not-allowed'
            }`}
            disabled={!translationEnabled}
            aria-label="Select language"
            data-no-translate="true"
          >
            <span className="text-base" data-no-translate="true">{selectedLanguage.flag}</span>
            <span className="text-sm font-medium" data-no-translate="true">{selectedLanguage.name}</span>
            {translationEnabled && (
              <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            )}
          </button>

          {isOpen && translationEnabled && (
            <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-[9999] max-h-80 overflow-y-auto" data-no-translate="true">
              {SUPPORTED_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  onClick={() => handleLanguageSelect(language)}
                  className={`w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors flex items-center justify-between ${
                    language.code === value ? 'bg-gray-700' : ''
                  }`}
                  data-no-translate="true"
                >
                  <span className="flex items-center gap-2" data-no-translate="true">
                    <span className="text-base" data-no-translate="true">{language.flag}</span>
                    <span className="text-sm text-white" data-no-translate="true">{language.name}</span>
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

      {/* Mobile: single compact button with combined popover */}
      <div className="sm:hidden relative" data-no-translate="true">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1 px-2 py-2 rounded-lg transition-all ${
            translationEnabled
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-white/10 hover:bg-white/15 text-white'
          }`}
          aria-label="Translation settings"
          data-no-translate="true"
        >
          <span className="text-sm" data-no-translate="true">{selectedLanguage.flag}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-52 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-[9999] overflow-hidden" data-no-translate="true">
            <button
              onClick={() => { onTranslationToggle(); }}
              className={`w-full text-left px-3 py-2.5 flex items-center gap-2 border-b border-gray-700 ${
                translationEnabled ? 'bg-green-600/20' : 'bg-white/5'
              }`}
              data-no-translate="true"
            >
              <Globe className="w-4 h-4" />
              <span className="text-sm text-white flex-1" data-no-translate="true">Translation</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${translationEnabled ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-300'}`}>
                {translationEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
            <div className="max-h-56 overflow-y-auto">
              {SUPPORTED_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  onClick={() => handleLanguageSelect(language)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors flex items-center justify-between ${
                    language.code === value ? 'bg-gray-700' : ''
                  } ${!translationEnabled ? 'opacity-50' : ''}`}
                  disabled={!translationEnabled}
                  data-no-translate="true"
                >
                  <span className="flex items-center gap-2" data-no-translate="true">
                    <span className="text-sm" data-no-translate="true">{language.flag}</span>
                    <span className="text-xs text-white" data-no-translate="true">{language.name}</span>
                  </span>
                  {language.code === value && (
                    <Check className="w-3.5 h-3.5 text-green-400" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LanguageSelector;
