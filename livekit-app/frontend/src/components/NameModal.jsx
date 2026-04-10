import { useState } from 'react';
import { X, Globe, ChevronDown, Check } from 'lucide-react';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../lib/languages';

const MEETING_LANGUAGES = getMeetingLanguages();

function NameModal({ onClose, onSubmit, title = "Enter Your Name", subtitle = "", showLanguageSelector = false, defaultLanguage = 'en' }) {
  const [name, setName] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    normalizeMeetingLanguageCode(defaultLanguage)
  );
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      // Single language = both speak and hear
      onSubmit(name.trim(), selectedLanguage, selectedLanguage);
      onClose();
    }
  };

  const selectedLang = MEETING_LANGUAGES.find(lang => lang.code === selectedLanguage) || MEETING_LANGUAGES[0];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto overflow-x-hidden" data-no-translate="true">
      {/* overflow-visible on card so the language popover is not clipped; outer layer scrolls if needed */}
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-visible my-auto shrink-0" data-no-translate="true">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {subtitle && (
          <p className="text-gray-400 mb-4">{subtitle}</p>
        )}

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            autoFocus
            required
          />

          {showLanguageSelector && (
            <div className="mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  <Globe className="w-4 h-4 inline mr-1" />
                  My language (speak & hear)
                </label>
                <div className="relative z-10">
                  <button
                    type="button"
                    onClick={() => setIsLanguageOpen(!isLanguageOpen)}
                    className="w-full bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between hover:bg-gray-600 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">{selectedLang.flag}</span>
                      <span className="text-sm">{selectedLang.name}</span>
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isLanguageOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isLanguageOpen && (
                    <div className="absolute z-[100] left-0 right-0 top-full mt-2 bg-gray-800 rounded-lg shadow-xl border border-gray-700 max-h-[min(16rem,45dvh)] overflow-y-auto overscroll-contain">
                      {MEETING_LANGUAGES.map((language) => (
                        <button
                          key={language.code}
                          type="button"
                          onClick={() => {
                            setSelectedLanguage(language.code);
                            setIsLanguageOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors flex items-center justify-between ${
                            language.code === selectedLanguage ? 'bg-gray-700' : ''
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-base">{language.flag}</span>
                            <span className="text-sm text-white">{language.name}</span>
                          </span>
                          {language.code === selectedLanguage && (
                            <Check className="w-4 h-4 text-green-400" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NameModal;
