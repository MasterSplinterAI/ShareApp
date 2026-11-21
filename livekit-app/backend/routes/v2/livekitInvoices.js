const express = require('express');
const multer = require('multer');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { requireSuperadmin } = require('../../lib/v2Superadmin');
const {
  MAX_DOCUMENT_BYTES, importLiveKitInvoice, listLiveKitInvoices, getLiveKitInvoicePdf, retryLiveKitInvoice, liveKitEstimate,
} = require('../../lib/livekitInvoices');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: {
  files: 1, fields: 5, parts: 6, fileSize: MAX_DOCUMENT_BYTES, fieldSize: 128,
} }).single('invoice');
const handle = fn => async (req,res) => {
  try { await fn(req,res); }
  catch (error) {
    if (!error.status) console.error('[admin/livekit-costs]', error.message);
    res.status(error.status || 503).json({ error: error.status ? error.message : 'LiveKit costs are temporarily unavailable' });
  }
};
router.use(requireV2Auth, requireSuperadmin, (_req,res,next) => {
  res.set('Cache-Control','no-store');
  next();
});
router.get('/',handle(async (req,res) => {
  const month = req.query.month ?? new Date().toISOString().slice(0,7);
  const [estimate,invoices] = await Promise.all([liveKitEstimate(month), listLiveKitInvoices()]);
  res.json({ estimate, invoices });
}));
router.post('/', (req,res,next) => upload(req,res,error => {
  if (error) return res.status(400).json({ error: 'Upload one LiveKit invoice PDF under 4 MB' });
  next();
}), handle(async (req,res) => {
  if (req.body?.confirmed !== 'true') return res.status(400).json({ error: 'Confirm the invoice details before importing' });
  const result = await importLiveKitInvoice(req.body,req.file?.buffer,req.v2Auth.email);
  res.status(result.alreadyImported ? 200 : 201).json(result);
}));
router.get('/:month/pdf',handle(async (req,res) => {
  const invoice = await getLiveKitInvoicePdf(req.params.month);
  if (!invoice) return res.sendStatus(404);
  res.attachment(invoice.invoiceNumber + '.pdf').type('application/pdf').send(invoice.document);
}));
router.post('/:month/retry',handle(async (req,res) => {
  await retryLiveKitInvoice(req.params.month);
  res.sendStatus(202);
}));
module.exports = router;
