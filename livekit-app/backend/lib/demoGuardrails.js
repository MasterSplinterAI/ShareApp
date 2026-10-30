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
Answer the visitor directly if they asked something. Keep the same speakers; 1-4 sentences per line.`;

const FALLBACK_POOL = {
  es: [
    'Buena pregunta — en Lalia ya tenemos vídeo, pantalla compartida y traducción en vivo en esta misma llamada.',
    'Claro: esta reunión corre entera en Lalia, así que cada uno lee y oye en su idioma sin cambiar de herramienta.',
    'Exacto — aquí en Lalia las leyendas y la traducción van con el vídeo; dime qué quieres probar.',
  ],
  fr: [
    'Bonne question — sur Lalia, vidéo, partage d’écran et traduction live sont déjà dans cet appel.',
    'Oui: toute la réunion se passe dans Lalia, chacun lit et entend dans sa langue sans changer d’outil.',
    'Exact — ici dans Lalia les sous-titres et la traduction suivent la vidéo; dis-moi ce que tu veux tester.',
  ],
  de: [
    'Gute Frage — in Lalia laufen Video, Bildschirmfreigabe und Live-Übersetzung schon in diesem Call.',
    'Genau: Das Meeting ist komplett in Lalia — jeder liest und hört in seiner Sprache, ohne Tool-Wechsel.',
    'Stimmt — in Lalia gehören Captions und Übersetzung zum Video; sag mir, was du ausprobieren willst.',
  ],
  pt: [
    'Boa pergunta — no Lalia já temos vídeo, compartilhamento de tela e tradução ao vivo nesta mesma chamada.',
    'Isso: a reunião inteira é no Lalia, cada um lê e ouve no seu idioma sem trocar de ferramenta.',
    'Exato — aqui no Lalia legendas e tradução vêm com o vídeo; me diz o que você quer testar.',
  ],
  ja: [
    'いい質問です。この通話はすでにLalia上で、画面共有とライブ翻訳も同じ場所で使えます。',
    'はい、ミーティング全体がLaliaです。各自が自分の言語で読み聞きでき、別ツールは不要です。',
    'その通りです。Laliaでは字幕と翻訳が動画と一緒に動きます。何を試したいか教えてください。',
  ],
  en: [
    'Good question — this call is already on Lalia, with video, screen sharing, and live translation in the same room.',
    'Right: the whole meeting runs in Lalia, so everyone reads and hears in their language without switching tools.',
    'Exactly — on Lalia, captions and translation ride with the video. Tell me what you want to try next.',
  ],
};

function onBrandFallbackLine(agent) {
  const lang = agent?.speakLang || agent?.nativeLang || 'en';
  const pool = FALLBACK_POOL[lang] || FALLBACK_POOL.en;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  LALIA_PLATFORM_BRIEF,
  guardrailPromptSection,
  violatesDemoGuardrails,
  filterGuardedLines,
  GUARDRAIL_RETRY_USER,
  onBrandFallbackLine,
};
