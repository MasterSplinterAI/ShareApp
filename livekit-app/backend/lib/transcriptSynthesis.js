const axios = require('axios');
const crypto = require('crypto');

const TEMPLATES = {
  executive_summary: {
    id: 'executive_summary',
    label: 'Executive summary',
    system:
      'You produce concise executive summaries of meeting transcripts. Use markdown with clear sections: Overview, Key points, Decisions, Risks, Next steps. Cite speakers when attributing statements. If something is not in the transcript, say "Not stated."',
  },
  action_items: {
    id: 'action_items',
    label: 'Action items',
    system:
      'Extract action items from the meeting transcript. Output markdown as a table or bullet list with columns: Owner (or "Unassigned"), Action, Due date (or "Not stated"). Only include items clearly implied or stated in the transcript.',
  },
  decisions: {
    id: 'decisions',
    label: 'Decisions & open questions',
    system:
      'Summarize what was decided vs what remains open. Use markdown sections: Decisions made, Open questions, Parking lot. Quote or paraphrase with speaker attribution when possible.',
  },
  timeline: {
    id: 'timeline',
    label: 'Timeline',
    system:
      'Produce a chronological timeline of the meeting highlights. Use markdown bullets with timestamps when available in the transcript. Group by topic when helpful.',
  },
  custom: {
    id: 'custom',
    label: 'Custom instructions',
    system:
      'Follow the user instructions below to synthesize the meeting transcript. Output well-structured markdown. Base answers only on the transcript; note gaps explicitly.',
  },
};

const MAX_LINES = 800;
const MAX_CHARS = 120000;
const MAX_CUSTOM_INSTRUCTIONS = 1000;

function listTemplates() {
  return Object.values(TEMPLATES).map((t) => ({ id: t.id, label: t.label }));
}

function instructionsHash(templateId, customInstructions, lineCount) {
  const payload = `${templateId}|${(customInstructions || '').trim()}|${lineCount}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function formatTranscriptForLlm(lines) {
  const sliced = lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
  const truncated = lines.length > MAX_LINES;
  const parts = sliced.map((l) => {
    const ts = l.recorded_at || '';
    const who = l.participant_identity || 'Unknown';
    const orig = l.original_text || '';
    const tr = l.translated_text && l.translated_text !== orig ? ` [translation: ${l.translated_text}]` : '';
    return `[${ts}] ${who}: ${orig}${tr}`;
  });
  let body = parts.join('\n');
  if (body.length > MAX_CHARS) {
    body = body.slice(-MAX_CHARS);
  }
  const preamble = truncated
    ? `Note: transcript truncated to the most recent ${MAX_LINES} lines for analysis.\n\n`
    : '';
  return preamble + body;
}

async function callLlm(systemPrompt, userContent) {
  const apiKey = process.env.TRANSLATION_API_KEY;
  if (!apiKey) {
    throw new Error('TRANSLATION_API_KEY not configured');
  }
  const provider = (process.env.TRANSLATION_API_PROVIDER || 'grok').toLowerCase();
  const isOpenai = provider === 'openai';
  const url = isOpenai
    ? 'https://api.openai.com/v1/chat/completions'
    : process.env.TRANSLATION_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model = isOpenai ? 'gpt-4o-mini' : process.env.TRANSLATION_MODEL || 'grok-4.20-non-reasoning';

  const response = await axios.post(
    url,
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM returned empty response');
  }
  const usage = response.data?.usage || {};
  return {
    markdown: content.trim(),
    model,
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
  };
}

async function synthesizeTranscript({ templateId, customInstructions, lines, meetingTitle }) {
  const template = TEMPLATES[templateId] || TEMPLATES.executive_summary;
  const custom = String(customInstructions || '')
    .trim()
    .slice(0, MAX_CUSTOM_INSTRUCTIONS);
  if (templateId === 'custom' && !custom) {
    throw new Error('Custom instructions required for custom template');
  }

  const transcriptBody = formatTranscriptForLlm(lines);
  if (!transcriptBody.trim()) {
    throw new Error('No transcript content to analyze');
  }

  let systemPrompt = template.system;
  if (custom) {
    systemPrompt += `\n\nUser instructions (apply within transcript bounds only):\n${custom}`;
  }

  const userContent = `Meeting title: ${meetingTitle || 'Untitled'}\nTranscript line count: ${lines.length}\n\n--- TRANSCRIPT ---\n${transcriptBody}`;

  return callLlm(systemPrompt, userContent);
}

module.exports = {
  TEMPLATES,
  listTemplates,
  instructionsHash,
  synthesizeTranscript,
};
