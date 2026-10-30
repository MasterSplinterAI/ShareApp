const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');

const ALLOWED_TYPES = new Set(['meeting_participant_minute', 'translation_minute', 'storage_byte_day']);

/** POST body may include optional `idempotency_key` (string, max 128) for deduplicated inserts per org. */
router.post('/events', requireV2Auth, async (req, res) => {
  try {
    const { event_type, quantity, unit, meeting_id, meta, idempotency_key } = req.body || {};
    if (!ALLOWED_TYPES.has(event_type)) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    if (meeting_id) {
      const m = await db.get(`SELECT id FROM v2_meetings WHERE id = ? AND org_id = ?`, [meeting_id, req.v2Auth.orgId]);
      if (!m) return res.status(404).json({ error: 'Meeting not found' });
    }
    let idem = null;
    if (idempotency_key != null && String(idempotency_key).trim()) {
      idem = String(idempotency_key).trim().slice(0, 128);
      const prev = await db.get(`SELECT id FROM v2_usage_events WHERE org_id = ? AND idempotency_key = ?`, [
        req.v2Auth.orgId,
        idem,
      ]);
      if (prev) return res.status(200).json({ id: prev.id, ok: true, deduped: true });
    }
    const id = db.uuid();
    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, unit_cost_micros, meta_json, idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        req.v2Auth.orgId,
        meeting_id || null,
        event_type,
        q,
        unit || 'unit',
        null,
        meta ? JSON.stringify(meta) : null,
        idem,
      ]
    );
    res.status(201).json({ id, ok: true });
  } catch (e) {
    const idemRetry =
      req.body && req.body.idempotency_key != null ? String(req.body.idempotency_key).trim().slice(0, 128) : '';
    if (idemRetry && String(e.message || '').includes('SQLITE_CONSTRAINT')) {
      const prev = await db.get(`SELECT id FROM v2_usage_events WHERE org_id = ? AND idempotency_key = ?`, [
        req.v2Auth.orgId,
        idemRetry,
      ]);
      if (prev) return res.status(200).json({ id: prev.id, ok: true, deduped: true });
    }
    console.error('[v2/usage/events]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/summary', requireV2Auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT event_type, SUM(quantity) AS total
       FROM v2_usage_events
       WHERE org_id = ? AND created_at >= datetime('now', 'start of month')
       GROUP BY event_type`,
      [req.v2Auth.orgId]
    );
    res.json({ byType: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

/**
 * Rollup stub — aggregates into v2_usage_rollups for a cycle (manual trigger for now).
 */
router.post('/rollup', requireV2Auth, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { cycleId } = req.body || {};
    const cycle = cycleId
      ? await db.get(`SELECT * FROM v2_billing_cycles WHERE id = ? AND org_id = ?`, [cycleId, req.v2Auth.orgId])
      : await db.get(
          `SELECT * FROM v2_billing_cycles WHERE org_id = ? ORDER BY datetime(period_start) DESC LIMIT 1`,
          [req.v2Auth.orgId]
        );
    if (!cycle) return res.status(404).json({ error: 'No cycle' });
    const rows = await db.all(
      `SELECT event_type, SUM(quantity) AS total
       FROM v2_usage_events
       WHERE org_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY event_type`,
      [req.v2Auth.orgId, cycle.period_start, cycle.period_end]
    );
    for (const r of rows) {
      const metric = r.event_type;
      await db.run(
        `INSERT INTO v2_usage_rollups (org_id, cycle_id, metric, quantity) VALUES (?,?,?,?)
         ON CONFLICT(org_id, cycle_id, metric) DO UPDATE SET quantity = excluded.quantity`,
        [req.v2Auth.orgId, cycle.id, metric, r.total]
      );
    }
    await db.run(`UPDATE v2_billing_cycles SET rolled_up_at = datetime('now') WHERE id = ?`, [cycle.id]);
    res.json({ ok: true, cycleId: cycle.id, rollups: rows });
  } catch (e) {
    console.error('[v2/usage/rollup]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
