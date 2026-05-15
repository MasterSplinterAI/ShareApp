const express = require('express');
const router = express.Router();
const { computeCost } = require('../lib/costConstants');
const { run } = require('../db/v2Database');

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await run(`
    CREATE TABLE IF NOT EXISTS meeting_cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      org_id TEXT,
      event_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      units REAL NOT NULL,
      unit_cost_usd REAL NOT NULL,
      total_cost_usd REAL NOT NULL,
      ts INTEGER NOT NULL,
      meta_json TEXT
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_cost_events_meeting ON meeting_cost_events(meeting_id)`);
  tableReady = true;
}

const COST_EVENT_SECRET = process.env.COST_EVENT_SECRET || '';

router.post('/', async (req, res) => {
  try {
    const provided = req.get('X-Cost-Secret') || '';
    if (!COST_EVENT_SECRET || provided !== COST_EVENT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { meeting_id, org_id, event_type, units, meta } = req.body;
    if (!meeting_id || !event_type || typeof units !== 'number') {
      return res.status(400).json({ error: 'meeting_id, event_type, and units (number) are required' });
    }

    let costInfo;
    try {
      costInfo = computeCost(event_type, units);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    await ensureTable();
    await run(
      `INSERT INTO meeting_cost_events (meeting_id, org_id, event_type, provider, units, unit_cost_usd, total_cost_usd, ts, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meeting_id,
        org_id || null,
        event_type,
        costInfo.provider,
        units,
        costInfo.unit_cost_usd,
        costInfo.total_cost_usd,
        Date.now(),
        meta ? JSON.stringify(meta) : null,
      ]
    );

    res.json({ ok: true, total_cost_usd: costInfo.total_cost_usd });
  } catch (err) {
    console.error('[cost-events] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
