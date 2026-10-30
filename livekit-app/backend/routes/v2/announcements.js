const express = require('express');
const db = require('../../db/v2Database');

const router = express.Router();

router.get('/active', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, message, level, starts_at, ends_at
       FROM v2_announcements
       WHERE disabled_at IS NULL
         AND datetime(starts_at) <= datetime('now')
         AND (ends_at IS NULL OR datetime(ends_at) >= datetime('now'))
       ORDER BY datetime(starts_at) DESC
       LIMIT 5`
    );
    res.json({ announcements: rows });
  } catch (e) {
    console.error('[announcements/active]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
