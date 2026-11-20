export const DEFAULT_TTS_VOICE_ID = 'voice-sarah';

const TTS_VOICE_STORAGE_KEY = 'lalia_tts_voice';

export const TTS_VOICES = [
  { id: 'voice-sarah', label: 'Sarah — Warm & clear', shortLabel: 'Sarah', description: 'Warm and clear, great for conversations' },
  { id: 'voice-marcus', label: 'Marcus — Deep & steady', shortLabel: 'Marcus', description: 'Deep and authoritative' },
  { id: 'voice-elena', label: 'Elena — Friendly & expressive', shortLabel: 'Elena', description: 'Friendly and expressive' },
  { id: 'voice-daniel', label: 'Daniel — Calm & natural', shortLabel: 'Daniel', description: 'Calm and professional' },
  { id: 'voice-lily', label: 'Lily — Bright & articulate', shortLabel: 'Lily', description: 'Bright and natural' },
  { id: 'voice-lucas', label: 'Lucas — Smooth & composed', shortLabel: 'Lucas', description: 'Smooth and composed' },
  { id: 'voice-maya', label: 'Maya — Poised & gentle', shortLabel: 'Maya', description: 'Clear and poised' },
  { id: 'voice-david', label: 'David — Confident & warm', shortLabel: 'David', description: 'Steady and confident' },
];

const voiceLabelMap = new Map(TTS_VOICES.map((v) => [v.id, v.label]));
const voiceIdSet = new Set(TTS_VOICES.map((v) => v.id));

export function getTtsVoiceLabel(id) {
  return voiceLabelMap.get(id) ?? 'Unknown';
}

export function isValidTtsVoiceId(id) {
  return voiceIdSet.has(id);
}

/** Prefer a known curated voice; otherwise fall back to Sarah. */
export function sanitizeTtsVoiceId(id) {
  return isValidTtsVoiceId(id) ? id : DEFAULT_TTS_VOICE_ID;
}

export function readStoredTtsVoiceId() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TTS_VOICE_ID;
    const saved = localStorage.getItem(TTS_VOICE_STORAGE_KEY);
    return sanitizeTtsVoiceId(saved);
  } catch {
    return DEFAULT_TTS_VOICE_ID;
  }
}

export function writeStoredTtsVoiceId(id) {
  const clean = sanitizeTtsVoiceId(id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TTS_VOICE_STORAGE_KEY, clean);
    }
  } catch {
    /* storage unavailable */
  }
  return clean;
}
