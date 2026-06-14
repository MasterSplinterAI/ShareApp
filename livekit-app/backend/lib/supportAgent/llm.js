const axios = require('axios');

function aiEnabled() {
  if (process.env.SUPPORT_AI_ENABLED === 'false') return false;
  if (process.env.OPENAI_API_KEY) return true;
  return Boolean(process.env.TRANSLATION_API_KEY);
}

function resolveLlmConfig() {
  const provider = (process.env.TRANSLATION_API_PROVIDER || 'openai').toLowerCase();
  const useOpenai = Boolean(process.env.OPENAI_API_KEY) || provider === 'openai';
  if (useOpenai) {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: process.env.OPENAI_API_KEY || process.env.TRANSLATION_API_KEY,
      model: process.env.SUPPORT_AI_MODEL || 'gpt-4o-mini',
    };
  }
  return {
    url: process.env.TRANSLATION_API_URL || 'https://api.x.ai/v1/chat/completions',
    apiKey: process.env.TRANSLATION_API_KEY,
    model: process.env.SUPPORT_AI_MODEL || process.env.TRANSLATION_MODEL || 'grok-4-20-non-reasoning',
  };
}

async function callSupportLlm(systemPrompt, userContent, { json = true } = {}) {
  const { url, apiKey, model } = resolveLlmConfig();
  if (!apiKey) throw new Error('No LLM API key configured');

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 2500,
  };
  if (json) payload.response_format = { type: 'json_object' };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 90000,
  });
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  return json ? JSON.parse(content) : content;
}

module.exports = {
  aiEnabled,
  resolveLlmConfig,
  callSupportLlm,
};
