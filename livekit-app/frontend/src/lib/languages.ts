/**
 * Supported languages for Autopilot Translator
 */

export interface Language {
    code: string;
    name: string;
    nativeName: string;
    flag?: string; // Emoji flag for display
}

/**
 * Default set of supported languages
 */
export const SUPPORTED_LANGUAGES: Language[] = [
    { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
    { code: 'es-CO', name: 'Spanish (Colombia)', nativeName: 'Español (Colombia)', flag: '🇨🇴' },
    { code: 'es-MX', name: 'Spanish (Mexico)', nativeName: 'Español (México)', flag: '🇲🇽' },
    { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', flag: '🇧🇷' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
    // Mandarin (Simplified) — STT/LLM use ISO-style zh / zh-CN; agent maps to Deepgram/OpenAI "Chinese"
    { code: 'zh-CN', name: 'Mandarin Chinese', nativeName: '中文（普通话，简体）', flag: '🇨🇳' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '中文 (繁體)', flag: '🇹🇼' },
    { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
    { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
    { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
];

/**
 * Get language by code
 */
export function getLanguage(code: string): Language | undefined {
    return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
}

/**
 * Get language name by code
 */
export function getLanguageName(code: string): string {
    const lang = getLanguage(code);
    return lang ? lang.name : code;
}

/**
 * Get native language name by code
 */
export function getNativeLanguageName(code: string): string {
    const lang = getLanguage(code);
    return lang ? lang.nativeName : code;
}

/**
 * Check if a language code is supported
 */
export function isLanguageSupported(code: string): boolean {
    if (!code || typeof code !== 'string' || !code.trim()) {
        return false;
    }
    const trimmed = code.trim();
    const normalized = trimmed === 'zh' ? 'zh-CN' : trimmed;
    return SUPPORTED_LANGUAGES.some((lang) => lang.code === normalized);
}

/**
 * Get all language codes
 */
export function getAllLanguageCodes(): string[] {
    return SUPPORTED_LANGUAGES.map(lang => lang.code);
}

/**
 * Ordered list for join modal + in-room language switcher (must stay identical).
 * Codes must exist in SUPPORTED_LANGUAGES.
 */
export const MEETING_LANGUAGE_CODES: readonly string[] = [
    'en',
    'es',
    'es-CO',
    'fr',
    'de',
    'it',
    'pt',
    'ru',
    'zh-CN',
    'zh-TW',
    'ja',
    'ko',
    'ar',
    'hi',
    'tiv',
];

/**
 * Languages shown in NameModal and LanguageSelector (same order, same labels).
 */
export function getMeetingLanguages(): Language[] {
    return MEETING_LANGUAGE_CODES.map((code) => {
        const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
        if (!lang) {
            throw new Error(`MEETING_LANGUAGE_CODES references missing language: ${code}`);
        }
        return lang;
    });
}

/** Map legacy stored codes to current meeting codes (e.g. old generic zh → Mandarin). */
export function normalizeMeetingLanguageCode(code: string | undefined | null): string {
    if (!code || typeof code !== 'string') {
        return 'en';
    }
    const trimmed = code.trim();
    if (trimmed === 'zh') {
        return 'zh-CN';
    }
    return trimmed;
}

