const express = require('express');
const {
  createDemoSession,
  processDemoTurn,
  recordDemoEvent,
  getDemoConfig,
} = require('../lib/demoLabSession');

const router = express.Router();

const ALLOWED_EVENTS = new Set(['session_start', 'turn', 'complete', 'signup_click', 'tts_enabled']);

router.get('/config', (_req, res) => {
  res.json(getDemoConfig());
});

router.post('/session', async (req, res) => {
  try {
    const { scenarioId, speakLang, readLang } = req.body || {};
    const result = await createDemoSession({
      scenarioId: scenarioId || 'standup',
      speakLang: speakLang || 'en',
      readLang: readLang || 'en',
      ip: req.ip,
    });
    if (!result.ok) {
      const status = result.error === 'rate_limit_ip' || result.error === 'capacity' ? 429 : 400;
      return res.status(status).json({ error: result.message || result.error });
    }
    res.json(result);
  } catch (e) {
    console.error('[demo/session]', e);
    res.status(500).json({ error: 'Failed to start demo session' });
  }
});

router.post('/turn', async (req, res) => {
  try {
    const { sessionId, userText } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    const result = await processDemoTurn({
      sessionId: String(sessionId),
      userText,
      ip: req.ip,
    });
    if (!result.ok) {
      const status =
        result.error === 'turn_limit' || result.error === 'rate_limit_ip' ? 429 : 400;
      return res.status(status).json({ error: result.message || result.error });
    }
    res.json(result);
  } catch (e) {
    console.error('[demo/turn]', e);
    res.status(500).json({ error: 'Failed to process demo turn' });
  }
});

router.post('/event', (req, res) => {
  try {
    const { sessionId, event } = req.body || {};
    if (!sessionId || !event || !ALLOWED_EVENTS.has(event)) {
      return res.status(400).json({ error: 'Invalid analytics event' });
    }
    recordDemoEvent(String(sessionId), event, req.ip);
    res.json({ ok: true });
  } catch (e) {
    console.error('[demo/event]', e);
    res.status(500).json({ error: 'Failed to record event' });
  }
});

module.exports = router;
