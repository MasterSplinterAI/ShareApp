const express = require('express');
const fs = require('fs');
const db = require('../../db/v2Database');
const { brandingLogoPath } = require('../../lib/v2Branding');

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
    const full = brandingLogoPath(req.params.orgId, org.brand_logo_file);
    if (!full || !fs.existsSync(full)) {
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
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error('[v2/branding/logo]', e);
    res.status(500).end();
  }
});

module.exports = router;
