const express = require('express');
const db = require('../../db/v2Database');
const { streamOrgObject, pipeObjectToResponse } = require('../../lib/objectStorage');
const { brandingRelativePath } = require('../../lib/v2Branding');

const router = express.Router();

/** Public logo asset for guest join / prejoin (org id is not secret). */
router.get('/:orgId/logo', async (req, res) => {
  try {
    const org = await db.get(
      `SELECT brand_logo_file FROM v2_organizations WHERE id = ?`,
      [req.params.orgId]
    );
    if (!org?.brand_logo_file) {
      return res.status(404).end();
    }
    const rel = brandingRelativePath(org.brand_logo_file);
    const stream = await streamOrgObject(req.params.orgId, rel);
    if (!stream) {
      return res.status(404).end();
    }
    const ext = (org.brand_logo_file.split('.').pop() || '').toLowerCase();
    const types = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
    };
    const ok = await pipeObjectToResponse(stream, res, {
      contentType: types[ext] || 'application/octet-stream',
      cacheControl: 'public, max-age=3600',
    });
    if (!ok) res.status(404).end();
  } catch (e) {
    console.error('[v2/branding/logo]', e);
    res.status(500).end();
  }
});

module.exports = router;
