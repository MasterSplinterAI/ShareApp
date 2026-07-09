/**
 * Guardrails for demo-room LLM agents — keep responses on-brand for Lalia.
 */

const LALIA_PLATFORM_BRIEF = `Lalia (this product) is a web-based video meeting platform with built-in live translation.
The visitor is IN a Lalia meeting right now — this call uses Lalia for video, audio, and screen sharing.

Lalia capabilities (accurate — do not contradict):
- Browser-based meetings (desktop and mobile-friendly), no Zoom/Meet install required
- Video, audio, screen sharing, host controls, guest links (no account needed for guests)
- Live speech-to-text captions per participant
- Real-time translation so each person reads/hears in their chosen language
- Global infrastructure (LiveKit SFU / STUN relays) for low-latency media
- Optional transcript persistence and meeting reports for hosts

Lalia is NOT a plugin, add-on, or sidecar for Zoom, Google Meet, or Microsoft Teams.`;

const GUARDRAIL_RULES = `Product guardrails (mandatory):
1. NEVER recommend, prefer, or mention Zoom, Google Meet, Microsoft Teams, or any competing video platform.
2. NEVER say Lalia is "only for translation" or that another tool is needed for video, screen sharing, or conferencing.
3. If the visitor asks about meeting tools, confirm they are already using Lalia for this call and describe relevant Lalia features.
4. If the visitor corrects you about Lalia, agree briefly and adjust — do not argue that competitors are still needed.
5. Stay factually accurate to the Lalia brief above; do not invent pricing, certifications, or features not listed.
6. Vary phrasing — do not start every line with "Thank you, [name]".`;

const COMPETITOR_TOOLS =
  /\b(zoom|google meet|microsoft teams|ms teams|meet\.google|webex|skype)\b/i;

const BAD_FRAMING =
  /\b(alongside|in addition to|our (main|base|primary) tools?|use (zoom|meet|teams)|integrat.*(zoom|meet|teams)|lalia (is )?(only|just|mainly) (for )?translation|translation (tool|plugin|add.?on))\b/i;

function guardrailPromptSection() {
  return `${LALIA_PLATFORM_BRIEF}\n\n${GUARDRAIL_RULES}`;
}

function violatesDemoGuardrails(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim();
  if (!t) return true;
  return COMPETITOR_TOOLS.test(t) || BAD_FRAMING.test(t);
}

function filterGuardedLines(lines) {
  return (lines || []).filter((l) => !violatesDemoGuardrails(l.originalText || l.text));
}

const GUARDRAIL_RETRY_USER = `Your previous JSON response violated demo guardrails (competitor tools or wrong framing about Lalia).
Regenerate ONLY valid JSON. Rules reminder:
- Do NOT mention Zoom, Google Meet, Microsoft Teams, or similar.
- This meeting IS on Lalia — video, screen share, and translation all happen here.
- Acknowledge the visitor's point if they corrected you.
Keep the same speakers and scenario; 1-3 sentences per line.`;

function onBrandFallbackLine(agent) {
  const lang = agent?.speakLang || agent?.nativeLang || 'en';
  const byLang = {
    es: 'Tienes razón — esta reunión ya es en Lalia, con vídeo, pantalla compartida y traducción en vivo.',
    fr: 'Vous avez raison — nous sommes déjà en réunion Lalia, avec vidéo, partage d’écran et traduction en direct.',
    de: 'Stimmt — dieses Meeting läuft bereits in Lalia, mit Video, Bildschirmfreigabe und Live-Übersetzung.',
    pt: 'Verdade — esta reunião já é no Lalia, com vídeo, compartilhamento de tela e tradução ao vivo.',
    ja: 'おっしゃる通りです。このミーティングはすでにLalia上で、画面共有とライブ翻訳もここで行っています。',
    en: 'You are right — we are already on Lalia for this call, with video, screen sharing, and live translation built in.',
  };
  return byLang[lang] || byLang.en;
}

module.exports = {
  LALIA_PLATFORM_BRIEF,
  guardrailPromptSection,
  violatesDemoGuardrails,
  filterGuardedLines,
  GUARDRAIL_RETRY_USER,
  onBrandFallbackLine,
};
