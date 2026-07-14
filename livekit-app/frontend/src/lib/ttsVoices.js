export const DEFAULT_TTS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export const TTS_VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', description: 'Warm and clear, great for conversations' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', description: 'Deep and authoritative' },
  { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte', description: 'Friendly and expressive' },
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel', description: 'Calm and professional' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', label: 'Lily', description: 'Bright and natural' },
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
