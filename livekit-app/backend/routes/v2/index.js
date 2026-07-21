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
router.use('/admin', require('./admin'));
router.use('/announcements', require('./announcements'));
if (require('../../lib/supportKit').supportKitEnabled()) {
  const { createShareAppSupportRouter } = require('../../lib/supportKit');
  const kit = createShareAppSupportRouter();
  console.log(
    `[support] kit mounted at /api/v2/support (tenant=${kit.meta.tenantId}, ${kit.meta.kitVersion})`
  );
  router.use('/support', (req, res, next) => kit.handler(req, res, next));
} else {
  router.use('/support', require('./support'));
}
router.use('/branding', require('./brandingPublic'));
router.use('/rooms', require('./captionConfig'));
// Org-scoped file uploads disabled for product UX; in-meeting chat file share (e.g. S3) is planned separately.
// router.use('/files', require('./files'));

module.exports = router;
