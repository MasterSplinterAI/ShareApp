const axios = require('axios');
const { getAgentsForScenario, getScenarioContext } = require('./demoLabAgents');
const {
  guardrailPromptSection,
  filterGuardedLines,
  GUARDRAIL_RETRY_USER,
  onBrandFallbackLine,
} = require('./demoGuardrails');

const MAX_AGENT_LINES = 3;
const MAX_LINE_CHARS = 400;

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

function buildSystemPrompt({ scenarioId, agents }) {
  const context = getScenarioContext(scenarioId);
  const roster = agents
    .map(
      (a) =>
        `- ${a.name} (${a.role}): speaks ${a.speakLang || a.nativeLang} only. Traits: ${a.traits.join(', ')}.`
    )
    .join('\n');

  return `You orchestrate a realistic multilingual video meeting demo for Lalia (live meeting translation).

${guardrailPromptSection()}

Meeting backdrop (situation only — do NOT force these topics every turn):
${context}

Teammates (AI agents — NOT the human visitor):
${roster}

Primary job: answer what the visitor just said. Stay in character. Have a natural conversation.
The scenario is backdrop — do not force agenda topics, scripted beats, or laundry-list updates unless the visitor asks about them.

Rules:
1. Reply ONLY as JSON — no markdown, no prose outside JSON.
2. Each agent line MUST be written in that agent's native language (${agents.map((a) => `${a.name}=${a.speakLang || a.nativeLang}`).join(', ')}).
3. Keep each line 1-4 sentences, conversational, under ${MAX_LINE_CHARS} characters. Prefer a substantive answer over a short slogan.
4. Primary agent responds first. A second (or third) agent may chime in when they add value (max ${MAX_AGENT_LINES} lines total).
5. Stay in character as a colleague who uses Lalia daily — reference Lalia features naturally when tools or translation come up.
6. Never speak as "You" or the visitor.
7. Opening: primary agent welcomes briefly and invites the visitor to speak (no user input yet). Do not mention non-Lalia video tools.
8. If the visitor asks a question (product, process, opinion, clarification), answer it directly first; only then continue the meeting naturally.
9. Vary phrasing and do not repeat the same stock lines.

Output schema:
{"lines":[{"speaker":"Name","text":"..."}]}`;
}

function formatHistory(history) {
  if (!history?.length) return '(meeting just started)';
  return history
    .slice(-16)
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
    .slice(0, MAX_AGENT_LINES)
    .map((l) => {
      const agent = agents.find((a) => a.name === l.speaker);
      return {
        speaker: l.speaker,
        originalText: l.text.trim().slice(0, MAX_LINE_CHARS),
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
      temperature: 0.8,
      max_tokens: 700,
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

  const system = buildSystemPrompt({ scenarioId, agents });
  const userPayload = isOpening
    ? 'Generate the opening line(s) to start the meeting. Primary agent speaks first — welcome briefly and invite the visitor to jump in with any question.'
    : `Recent transcript:\n${formatHistory(history)}\n\nThe visitor just said: "${userText}"\n\nAnswer their question or comment first (directly, in character). Only then continue the meeting naturally if needed. Generate agent response line(s).`;

  let raw;
  const baseMessages = [
    { role: 'system', content: system },
    { role: 'user', content: userPayload },
  ];
  try {
    raw = await callLlm(baseMessages);
    let parsed = parseLlmJson(raw);
    let lines = filterGuardedLines(validateLines(parsed, agents));

    if (!lines.length && parsed?.lines?.length) {
      const retryRaw = await callLlm([
        ...baseMessages,
        { role: 'assistant', content: raw },
        { role: 'user', content: GUARDRAIL_RETRY_USER },
      ]);
      parsed = parseLlmJson(retryRaw);
      lines = filterGuardedLines(validateLines(parsed, agents));
    }

    if (lines.length) return { lines, fallback: false };
  } catch (e) {
    console.error('[demoOrchestratorLlm]', e.message);
    const primary = agents[0];
    return {
      lines: [
        {
          speaker: primary.name,
          originalText: onBrandFallbackLine(primary),
          sourceLang: primary.speakLang || primary.nativeLang,
        },
      ],
      fallback: true,
    };
  }

  const primary = agents[0];
  return {
    lines: [
      {
        speaker: primary.name,
        originalText: onBrandFallbackLine(primary),
        sourceLang: primary.speakLang || primary.nativeLang,
      },
    ],
    fallback: true,
  };
}

module.exports = {
  generateDemoAgentTurns,
};
