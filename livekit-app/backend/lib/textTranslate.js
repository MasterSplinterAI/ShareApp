const axios = require('axios');

function trim(str) {
  return typeof str === 'string' ? str.trim() : str;
}

async function translateWithGrok(text, targetLanguage, sourceLanguage = 'en', systemPrompt = null) {
  const apiKey = process.env.TRANSLATION_API_KEY;
  if (!apiKey) throw new Error('TRANSLATION_API_KEY not configured');

  const response = await axios.post(
    process.env.TRANSLATION_API_URL || 'https://api.x.ai/v1/chat/completions',
    {
      model: process.env.TRANSLATION_MODEL || 'grok-4.20-non-reasoning',
      messages: [
        {
          role: 'system',
          content:
            systemPrompt ||
            `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translation, no explanations.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 500,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  const translated = response.data?.choices?.[0]?.message?.content;
  if (!translated || typeof translated !== 'string') return text;
  return trim(translated);
}

async function translateWithOpenAI(text, targetLanguage, sourceLanguage = 'en', systemPrompt = null) {
  const apiKey = process.env.TRANSLATION_API_KEY;
  if (!apiKey) throw new Error('TRANSLATION_API_KEY not configured');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            systemPrompt ||
            `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translation, no explanations.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 500,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  const translated = response.data?.choices?.[0]?.message?.content;
  if (!translated || typeof translated !== 'string') return text;
  return trim(translated);
}

/** Translate text between languages (no DB cache — for ephemeral demo/chat). */
async function translateText(text, sourceLanguage, targetLanguage) {
  if (!text || sourceLanguage === targetLanguage) return text;
  const provider = (process.env.TRANSLATION_API_PROVIDER || 'grok').toLowerCase();
  try {
    if (provider === 'openai') {
      return await translateWithOpenAI(text, targetLanguage, sourceLanguage);
    }
    return await translateWithGrok(text, targetLanguage, sourceLanguage);
  } catch (err) {
    console.warn('[textTranslate]', err.message);
    return text;
  }
}

module.exports = { translateText, translateWithGrok, translateWithOpenAI };
