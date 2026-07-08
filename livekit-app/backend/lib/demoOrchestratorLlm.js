const axios = require('axios');
const { getAgentsForScenario, getScenarioContext } = require('./demoLabAgents');

function llmConfig() {
  const provider = (process.env.DEMO_LLM_PROVIDER || process.env.TRANSLATION_API_PROVIDER || 'openai').toLowerCase();
  const useOpenai = provider === 'openai' || Boolean(process.env.OPENAI_API_KEY);
  if (useOpenai) {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      model: process.env.DEMO_LLM_MODEL || 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY || process.env.TRANSLATION_API_KEY,
    };
  }
  return {
    url: process.env.TRANSLATION_API_URL || 'https://api.x.ai/v1/chat/completions',
    model: process.env.DEMO_LLM_MODEL || process.env.TRANSLATION_MODEL || 'grok-4.20-non-reasoning',
    apiKey: process.env.TRANSLATION_API_KEY,
  };
}

function buildSystemPrompt({ scenarioId, agents, participantLangs }) {
  const context = getScenarioContext(scenarioId);
  const roster = agents
    .map(
      (a) =>
        `- ${a.name} (${a.role}): speaks ${a.speakLang || a.nativeLang} only. Traits: ${a.traits.join(', ')}.`
    )
    .join('\n');

  return `You orchestrate a realistic multilingual video meeting demo for Lalia (live meeting translation).

Scenario: ${context}

Teammates (AI agents — NOT the human visitor):
${roster}

Rules:
1. Reply ONLY as JSON — no markdown, no prose outside JSON.
2. Each agent line MUST be written in that agent's native language (${agents.map((a) => `${a.name}=${a.speakLang || a.nativeLang}`).join(', ')}).
3. Keep each line 1-3 sentences, conversational, under 220 characters.
4. Primary agent responds first; a second agent may chime in only when clearly relevant (max 2 lines total).
5. Stay in character. Mention Lalia naturally when discussing translation/tools.
6. Never speak as "You" or the visitor.
7. Opening: primary agent welcomes and sets up the scenario (no user input yet).

Output schema:
{"lines":[{"speaker":"Name","text":"..."}]}`;
}

function formatHistory(history) {
  if (!history?.length) return '(meeting just started)';
  return history
    .slice(-12)
    .map((h) => `${h.speaker}: ${h.text}`)
    .join('\n');
}

function parseLlmJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function validateLines(parsed, agents) {
  const names = new Set(agents.map((a) => a.name));
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  return lines
    .filter((l) => l && names.has(l.speaker) && typeof l.text === 'string' && l.text.trim())
    .slice(0, 2)
    .map((l) => {
      const agent = agents.find((a) => a.name === l.speaker);
      return {
        speaker: l.speaker,
        originalText: l.text.trim().slice(0, 280),
        sourceLang: agent?.speakLang || agent?.nativeLang || 'en',
      };
    });
}

async function callLlm(messages) {
  const cfg = llmConfig();
  if (!cfg.apiKey) throw new Error('LLM API key not configured for demo orchestrator');

  const response = await axios.post(
    cfg.url,
    {
      model: cfg.model,
      messages,
      temperature: 0.65,
      max_tokens: 450,
    },
    {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 25000,
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
}

async function generateDemoAgentTurns({
  scenarioId,
  participantLangs,
  history,
  userText,
  isOpening = false,
}) {
  const agents = getAgentsForScenario(scenarioId, participantLangs);
  if (!agents.length) return { lines: [] };

  const system = buildSystemPrompt({ scenarioId, agents, participantLangs });
  const userPayload = isOpening
    ? 'Generate the opening line(s) to start the meeting. Primary agent speaks first.'
    : `Recent transcript:\n${formatHistory(history)}\n\nThe visitor just said: "${userText}"\n\nGenerate agent response line(s).`;

  let raw;
  try {
    raw = await callLlm([
      { role: 'system', content: system },
      { role: 'user', content: userPayload },
    ]);
  } catch (e) {
    console.error('[demoOrchestratorLlm]', e.message);
    const primary = agents[0];
    return {
      lines: [
        {
          speaker: primary.name,
          originalText:
            primary.nativeLang === 'es'
              ? 'Gracias — sigamos con la reunión.'
              : primary.nativeLang === 'fr'
                ? 'Merci — continuons la réunion.'
                : 'Thanks — let us continue the meeting.',
          sourceLang: primary.speakLang || primary.nativeLang,
        },
      ],
      fallback: true,
    };
  }

  const parsed = parseLlmJson(raw);
  const lines = validateLines(parsed, agents);
  if (lines.length) return { lines, fallback: false };

  const primary = agents[0];
  return {
    lines: [
      {
        speaker: primary.name,
        originalText:
          primary.nativeLang === 'es'
            ? 'Entendido — gracias por compartir.'
            : 'Understood — thank you for sharing.',
        sourceLang: primary.speakLang || primary.nativeLang,
      },
    ],
    fallback: true,
  };
}

module.exports = {
  generateDemoAgentTurns,
};
