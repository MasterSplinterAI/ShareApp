const express = require('express');
const router = express.Router();
const { run } = require('../db/v2Database');

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await run(`
    CREATE TABLE IF NOT EXISTS screen_share_quality_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      participant_identity TEXT,
      from_layer TEXT,
      to_layer TEXT,
      ts INTEGER NOT NULL
    )
  `);
  tableReady = true;
}

// Naive rate-limit: one insert per participant per 10s window (skip-if-duplicate)
const recentKeys = new Map();
const WINDOW_MS = 10_000;

router.post('/', async (req, res) => {
  try {
    const { meeting_id, participant_identity, from_layer, to_layer } = req.body;
    if (!meeting_id) {
      return res.status(400).json({ error: 'meeting_id required' });
    }

    const key = `${meeting_id}:${participant_identity}:${from_layer}:${to_layer}`;
    const lastTs = recentKeys.get(key) || 0;
    if (Date.now() - lastTs < WINDOW_MS) {
      return res.json({ ok: true, skipped: true });
    }
    recentKeys.set(key, Date.now());

    await ensureTable();
    await run(
      `INSERT INTO screen_share_quality_events (meeting_id, participant_identity, from_layer, to_layer, ts)
       VALUES (?, ?, ?, ?, ?)`,
      [meeting_id, participant_identity || null, from_layer || null, to_layer || null, Date.now()]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[quality-events] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
