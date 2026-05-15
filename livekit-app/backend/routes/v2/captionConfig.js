const express = require('express');
const router = express.Router();
const { requireV2Auth } = require('../../middleware/v2Auth');
const { getRoomService } = require('../../lib/livekitService');

// POST /api/v2/rooms/:name/caption-config
router.post('/:name/caption-config', requireV2Auth, async (req, res) => {
  try {
    const { name } = req.params;
    const { mode, languages } = req.body;

    const validModes = ['off', 'transcription_only', 'transcription_translation'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
    }
    if (!Array.isArray(languages)) {
      return res.status(400).json({ error: 'languages must be an array' });
    }

    const svc = getRoomService();

    // Fetch current metadata and merge
    let existingMeta = {};
    try {
      const rooms = await svc.listRooms([name]);
      if (rooms.length > 0 && rooms[0].metadata) {
        existingMeta = JSON.parse(rooms[0].metadata);
      }
    } catch {
      // Room may not exist yet or metadata may be empty — continue
    }

    const newMeta = { ...existingMeta, caption_config: { mode, languages } };
    await svc.updateRoomMetadata(name, JSON.stringify(newMeta));

    res.json({ ok: true });
  } catch (err) {
    console.error('[caption-config] error:', err.message);
    res.status(500).json({ error: 'Failed to update room metadata' });
  }
});

module.exports = router;
