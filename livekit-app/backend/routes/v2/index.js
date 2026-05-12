const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'livekit-backend-v2' });
});

router.use('/auth', require('./auth'));
router.use('/orgs', require('./orgs'));
router.use('/meetings', require('./meetings'));
router.use('/host/meetings', require('./host'));
router.use('/billing', require('./billing'));
router.use('/usage', require('./usage'));
router.use('/files', require('./files'));

module.exports = router;
