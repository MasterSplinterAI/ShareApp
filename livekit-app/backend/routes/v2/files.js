const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

function uploadDir(orgId) {
  const base = path.join(__dirname, '..', '..', 'uploads', 'v2', orgId);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      cb(null, uploadDir(req.v2Auth.orgId));
    } catch (e) {
      cb(e);
    }
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    cb(null, `${db.uuid()}${ext || ''}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('File type not allowed'));
    }
    cb(null, true);
  },
});

router.post('/', requireV2Auth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'file field required' });
    }
    try {
      const { meeting_id } = req.body || {};
      let roomName = null;
      if (meeting_id) {
        const m = await db.get(
          `SELECT livekit_room_name FROM v2_meetings WHERE id = ? AND org_id = ?`,
          [meeting_id, req.v2Auth.orgId]
        );
        if (!m) return res.status(404).json({ error: 'Meeting not found' });
        roomName = m.livekit_room_name;
      }
      const id = db.uuid();
      await db.run(
        `INSERT INTO v2_files (id, org_id, meeting_id, room_name, stored_name, original_name, mime, size_bytes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          id,
          req.v2Auth.orgId,
          meeting_id || null,
          roomName,
          req.file.filename,
          req.file.originalname || req.file.filename,
          req.file.mimetype,
          req.file.size,
          req.v2Auth.userId,
        ]
      );
      await db.run(
        `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, meta_json)
         VALUES (?,?,?,?,?,?,?)`,
        [
          db.uuid(),
          req.v2Auth.orgId,
          meeting_id || null,
          'storage_byte_day',
          req.file.size,
          'bytes',
          JSON.stringify({ fileId: id, action: 'upload' }),
        ]
      );
      res.status(201).json({
        id,
        originalName: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype,
      });
    } catch (e) {
      console.error('[v2/files]', e);
      res.status(500).json({ error: 'Save failed' });
    }
  });
});

router.get('/', requireV2Auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, original_name, mime, size_bytes, meeting_id, created_at FROM v2_files WHERE org_id = ? ORDER BY datetime(created_at) DESC LIMIT 200`,
      [req.v2Auth.orgId]
    );
    res.json({ files: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/:id/download', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_files WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const dir = uploadDir(req.v2Auth.orgId);
    const full = path.join(dir, row.stored_name);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.original_name)}"`);
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
