/** Publish demo agent captions on the LiveKit data channel (same schema as translation agent). */

function encodePayload(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

export function publishDemoCaption(localParticipant, message, { reliable = false } = {}) {
  if (!localParticipant?.publishData) return Promise.resolve();
  return localParticipant.publishData(encodePayload(message), {
    topic: 'transcription',
    reliable,
  });
}

function splitPartials(text, steps = 3) {
  if (!text || text.length < 12) return [text];
  const words = text.split(/\s+/);
  if (words.length <= steps) return words.map((_, i) => words.slice(0, i + 1).join(' '));
  const chunk = Math.ceil(words.length / steps);
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    out.push(words.slice(0, i * chunk).join(' '));
  }
  return [...new Set(out)];
}

export async function publishAgentCaptionSequence(
  localParticipant,
  {
    speakerId,
    originalText,
    translatedText,
    sourceLang,
    targetLang,
    onPartial,
  },
  { delayMs = 160 } = {}
) {
  const transcriptionId = `${speakerId}-demo-${Date.now()}`;
  const timestamp = () => performance.now() / 1000;
  const hasTranslation =
    sourceLang !== targetLang && originalText && translatedText && originalText !== translatedText;

  const origSteps = splitPartials(originalText, 4);
  const transSteps = hasTranslation ? splitPartials(translatedText, 4) : origSteps;

  for (let i = 0; i < origSteps.length; i += 1) {
    const partial = {
      type: 'transcription',
      participant_id: speakerId,
      originalText: origSteps[i],
      text: hasTranslation ? transSteps[i] || transSteps[transSteps.length - 1] : origSteps[i],
      language: targetLang,
      sourceLanguage: sourceLang,
      partial: true,
      final: false,
      timestamp: timestamp(),
      transcriptionId,
      sttProvider: 'demo',
    };
    onPartial?.(speakerId);
    await publishDemoCaption(localParticipant, partial, { reliable: false });
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const finalMsg = {
    type: 'transcription',
    participant_id: speakerId,
    originalText,
    text: hasTranslation ? translatedText : originalText,
    language: targetLang,
    sourceLanguage: sourceLang,
    partial: false,
    final: true,
    hasTranslation,
    timestamp: timestamp(),
    transcriptionId,
    sttProvider: 'demo',
  };
  await publishDemoCaption(localParticipant, finalMsg, { reliable: true });
  return transcriptionId;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
