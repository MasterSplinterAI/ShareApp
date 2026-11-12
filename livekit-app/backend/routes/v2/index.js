const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'livekit-backend-v2' });
});

router.use('/', require('./joinPublic'));
router.use('/public/meetings', require('./joinPublic'));
router.use('/auth', require('./auth'));
router.use('/orgs', require('./orgs'));
router.use('/meetings', require('./meetings'));
router.use('/', require('./calls'));
router.use('/host/meetings', require('./host'));
router.use('/billing', require('./billing'));
router.use('/usage', require('./usage'));
router.use('/admin', require('./admin'));
router.use('/announcements', require('./announcements'));
if (require('../../lib/supportKit').supportKitEnabled()) {
  const { createShareAppSupportRouter } = require('../../lib/supportKit');
  const kit = createShareAppSupportRouter();
  router.startSupportReplay=kit.startReplay;router.stopSupportReplay=kit.stopReplay;
  console.log(
    `[support] kit mounted at /api/v2/support (tenant=${kit.meta.tenantId}, ${kit.meta.kitVersion})`
  );
  router.use('/support', (req, res, next) => kit.handler(req, res, next));
} else {
  // The v2 writer is retained only for standalone installs. A configured integration cannot resurrect it.
  router.use('/support',async(req,res,next)=>{try{
    const {supportAuthorityHttp}=require('../../lib/supportAuthority');if(await supportAuthorityHttp(req,res))return;
    const cfg=require('../../lib/opsHubClient').getOpsHubConfig();
    if(cfg.baseUrl||cfg.secretKey||await require('../../lib/supportAuthority').hostSupportAuthority.read().then(s=>s.state!=='unmanaged').catch(()=>true))return res.status(503).json({error:'Legacy support writer retired. Enable the support-kit gateway.'});
    return next();
  }catch{return res.status(503).json({error:'Support authority unavailable',retryable:true});}},require('./support'));
}
router.use('/branding', require('./brandingPublic'));
router.use('/rooms', require('./captionConfig'));
// Org-scoped file uploads disabled for product UX; in-meeting chat file share (e.g. S3) is planned separately.
// router.use('/files', require('./files'));

module.exports = router;
