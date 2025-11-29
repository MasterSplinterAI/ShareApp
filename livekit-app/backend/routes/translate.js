const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

/**
 * Translation endpoint for Autopilot Translator SDK
 * Compatible with autopilot-translator-sdk frontend
 * 
 * Uses Grok API (X.AI) for translations with database caching
 * 
 * Configure via environment variables:
 * - TRANSLATION_API_PROVIDER: 'grok' or 'openai' (default: 'grok')
 * - TRANSLATION_API_KEY: Your Grok/OpenAI API key
 * - TRANSLATION_API_URL: API endpoint (default: https://api.x.ai/v1/chat/completions)
 * - TRANSLATION_MODEL: Model name (default: grok-4-1-fast-non-reasoning)
 * - USE_DATABASE_CACHE: 'true' to enable SQLite caching (default: 'false')
 */

// Database cache (SQLite) - optional
let db = null;
let dbInitialized = false;

/**
 * Initialize SQLite database for caching (optional)
 */
function initDatabase() {
  if (dbInitialized) return;
  
  const useDb = process.env.USE_DATABASE_CACHE === 'true';
  if (!useDb) {
    console.log('📦 Database caching disabled (USE_DATABASE_CACHE=false)');
    dbInitialized = true;
    return;
  }

  try {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '../translations.db');
    
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Failed to initialize database:', err.message);
        db = null;
        dbInitialized = true;
        return;
      }
      
      console.log('✅ Translation database initialized:', dbPath);
      
      // Create translations table (synchronous, wait for completion)
      db.serialize(() => {
        db.run(`
          CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_text TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            target_language TEXT NOT NULL,
            translated_text TEXT NOT NULL,
            source TEXT DEFAULT 'grok',
            usage_count INTEGER DEFAULT 0,
            last_used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_hash, target_language)
          )
        `, (err) => {
          if (err) {
            console.error('Failed to create translations table:', err);
          }
        });
        
        db.run(`CREATE INDEX IF NOT EXISTS idx_source_hash ON translations(source_hash)`, (err) => {
          if (err) console.error('Failed to create index:', err);
        });
        
        db.run(`CREATE INDEX IF NOT EXISTS idx_target_language ON translations(target_language)`, (err) => {
          if (err) console.error('Failed to create index:', err);
        });
        
        db.run(`CREATE INDEX IF NOT EXISTS idx_last_used_at ON translations(last_used_at)`, (err) => {
          if (err) console.error('Failed to create index:', err);
          dbInitialized = true;
        });
      });
    });
  } catch (error) {
    console.warn('⚠️ Database not available, using in-memory cache only:', error.message);
    db = null;
    dbInitialized = true;
  }
}

// Initialize database on module load
initDatabase();

/**
 * Get cached translation from database
 */
function getCachedTranslation(sourceHash, targetLanguage) {
  return new Promise((resolve) => {
    if (!db) {
      resolve(null);
      return;
    }
    
    db.get(
      'SELECT translated_text FROM translations WHERE source_hash = ? AND target_language = ?',
      [sourceHash, targetLanguage],
      (err, row) => {
        if (err) {
          console.error('Database query error:', err);
          resolve(null);
        } else if (row) {
          // Update usage stats
          db.run(
            'UPDATE translations SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE source_hash = ? AND target_language = ?',
            [sourceHash, targetLanguage]
          );
          resolve(row.translated_text);
        } else {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Save translation to database cache
 */
function saveTranslation(sourceText, sourceHash, targetLanguage, translatedText, provider = 'grok') {
  if (!db) return;
  
  db.run(
    `INSERT INTO translations (source_text, source_hash, target_language, translated_text, source, usage_count, last_used_at)
     VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(source_hash, target_language) DO UPDATE SET
       translated_text = excluded.translated_text,
       usage_count = usage_count + 1,
       last_used_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [sourceText, sourceHash, targetLanguage, translatedText, provider],
    (err) => {
      if (err) {
        console.error('Failed to save translation to database:', err);
      }
    }
  );
}

/**
 * Translate using Grok API (X.AI)
 */
async function translateWithGrok(text, targetLanguage, sourceLanguage = 'en') {
  const apiKey = process.env.TRANSLATION_API_KEY;
  const apiUrl = process.env.TRANSLATION_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model = process.env.TRANSLATION_MODEL || 'grok-4-1-fast-non-reasoning';
  
  if (!apiKey) {
    throw new Error('TRANSLATION_API_KEY not configured');
  }

  const response = await axios.post(
    apiUrl,
    {
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translation, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      stream: false,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
    }
  );

  if (response.status !== 200) {
    const errorMsg = response.data?.error?.message || response.statusText || 'Unknown error';
    throw new Error(`Grok API error (${response.status}): ${errorMsg}`);
  }

  const result = response.data;
  const translated = result?.choices?.[0]?.message?.content;
  
  if (!translated || typeof translated !== 'string') {
    console.warn('Grok API returned invalid response:', JSON.stringify(result, null, 2));
    return text; // Return original text if translation is invalid
  }
  
  return trim(translated);
}

/**
 * Translate using OpenAI API
 */
async function translateWithOpenAI(text, targetLanguage, sourceLanguage = 'en') {
  const apiKey = process.env.TRANSLATION_API_KEY;
  
  if (!apiKey) {
    throw new Error('TRANSLATION_API_KEY not configured');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translation, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
    }
  );

  if (response.status !== 200) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const result = response.data;
  const translated = result?.choices?.[0]?.message?.content;
  
  if (!translated || typeof translated !== 'string') {
    console.warn('OpenAI API returned invalid response:', result);
    return text; // Return original text if translation is invalid
  }
  
  return trim(translated);
}

function trim(str) {
  return typeof str === 'string' ? str.trim() : str;
}

/**
 * POST /api/translate
 * Translate single text (Autopilot SDK compatible)
 */
router.post('/', async (req, res) => {
  try {
    const { text, target_language, source_language } = req.body;
    const targetLanguage = target_language || req.body.targetLanguage || 'en';
    const sourceLanguage = source_language || req.body.sourceLanguage || 'en';

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        error: 'Missing required field: text (must be a string)'
      });
    }

    // If target language is English, return original text
    if (targetLanguage === 'en' || targetLanguage === sourceLanguage) {
      return res.json({
        original: text,
        translated: text,
        target_language: targetLanguage
      });
    }

    // Create hash for caching
    const sourceHash = crypto.createHash('sha256')
      .update(text.toLowerCase().trim() + '|' + sourceLanguage)
      .digest('hex');

    // Check database cache first
    const cached = await getCachedTranslation(sourceHash, targetLanguage);
    if (cached) {
      return res.json({
        original: text,
        translated: cached,
        target_language: targetLanguage
      });
    }

    // Translate via API
    const provider = process.env.TRANSLATION_API_PROVIDER || 'grok';
    let translatedText;

    try {
      if (provider.toLowerCase() === 'openai') {
        translatedText = await translateWithOpenAI(text, targetLanguage, sourceLanguage);
      } else {
        // Default to Grok
        translatedText = await translateWithGrok(text, targetLanguage, sourceLanguage);
      }

      // Save to database cache
      saveTranslation(text, sourceHash, targetLanguage, translatedText, provider);

      res.json({
        original: text,
        translated: translatedText,
        target_language: targetLanguage
      });
    } catch (translateError) {
      console.error('Translation error:', translateError.message || translateError);
      console.error('Translation error stack:', translateError.stack);
      
      // Fallback: return original text if translation fails
      res.json({
        original: text,
        translated: text,
        target_language: targetLanguage,
        error: 'Translation service unavailable, returning original text'
      });
    }
  } catch (error) {
    console.error('Translation endpoint error:', error.message || error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/translate/batch
 * Batch translate multiple texts (Autopilot SDK compatible)
 */
router.post('/batch', async (req, res) => {
  try {
    const { texts, target_language, source_language } = req.body;
    const targetLanguage = target_language || req.body.targetLanguage || 'en';
    const sourceLanguage = source_language || req.body.sourceLanguage || 'en';

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({
        error: 'Missing required field: texts (array)'
      });
    }

    // If target language is English, return original texts
    if (targetLanguage === 'en' || targetLanguage === sourceLanguage) {
      return res.json({
        translations: texts,
        target_language: targetLanguage
      });
    }

    const results = [];
    const toTranslate = [];
    const indices = [];

    // Check cache for each text
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      
      if (!text || text.trim() === '') {
        results[i] = text;
        continue;
      }

      const sourceHash = crypto.createHash('sha256')
        .update(text.toLowerCase().trim() + '|' + sourceLanguage)
        .digest('hex');

      const cached = await getCachedTranslation(sourceHash, targetLanguage);
      if (cached) {
        results[i] = cached;
      } else {
        toTranslate.push(text);
        indices.push(i);
      }
    }

    // Translate remaining texts via API (batch)
    if (toTranslate.length > 0) {
      try {
        const provider = process.env.TRANSLATION_API_PROVIDER || 'grok';
        
        // Chunk large batches (50 per API call)
        const CHUNK_SIZE = 50;
        const chunks = [];
        for (let i = 0; i < toTranslate.length; i += CHUNK_SIZE) {
          chunks.push(toTranslate.slice(i, i + CHUNK_SIZE));
        }

        const allTranslations = [];
        for (const chunk of chunks) {
          // Combine texts with separator
          const combinedText = chunk.join('\n---SEPARATOR---\n');
          
          let translated;
          if (provider.toLowerCase() === 'openai') {
            translated = await translateWithOpenAI(combinedText, targetLanguage, sourceLanguage);
          } else {
            translated = await translateWithGrok(combinedText, targetLanguage, sourceLanguage);
          }
          
          // Split translations
          const chunkTranslations = translated.split('\n---SEPARATOR---\n');
          
          // Ensure we have same number of translations as inputs
          while (chunkTranslations.length < chunk.length) {
            chunkTranslations.push(chunk[chunkTranslations.length] || '');
          }
          
          allTranslations.push(...chunkTranslations.slice(0, chunk.length));
        }

        // Map translations back to original indices and cache them
        let translationIndex = 0;
        for (let i = 0; i < indices.length; i++) {
          const originalIndex = indices[i];
          const originalText = toTranslate[i];
          const translatedText = allTranslations[translationIndex] || originalText;
          
          results[originalIndex] = translatedText;
          
          // Save to database cache
          const sourceHash = crypto.createHash('sha256')
            .update(originalText.toLowerCase().trim() + '|' + sourceLanguage)
            .digest('hex');
          saveTranslation(originalText, sourceHash, targetLanguage, translatedText, provider);
          
          translationIndex++;
        }
      } catch (error) {
        console.error('Batch translation error:', error.message || error);
        console.error('Batch translation error stack:', error.stack);
        // Fill missing translations with original texts
        for (let i = 0; i < indices.length; i++) {
          if (!results[indices[i]]) {
            results[indices[i]] = toTranslate[i];
          }
        }
      }
    }

    // Ensure results array matches input order
    const orderedResults = texts.map((_, index) => results[index] || texts[index]);

    res.json({
      translations: orderedResults,
      target_language: targetLanguage
    });
  } catch (error) {
    console.error('Batch translation endpoint error:', error.message || error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

