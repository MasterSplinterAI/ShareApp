const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'livekit-backend-v2' });
});

router.use('/', require('./joinPublic'));
router.use('/auth', require('./auth'));
router.use('/orgs', require('./orgs'));
router.use('/meetings', require('./meetings'));
router.use('/host/meetings', require('./host'));
router.use('/billing', require('./billing'));
router.use('/usage', require('./usage'));
// Org-scoped file uploads disabled for product UX; in-meeting chat file share (e.g. S3) is planned separately.
// router.use('/files', require('./files'));

module.exports = router;
