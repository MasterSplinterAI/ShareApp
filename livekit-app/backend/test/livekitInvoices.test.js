const assert = require('node:assert/strict');
const test = require('node:test');
require('./supportIsolation').prepareSupportTest();

test('reviewed LiveKit invoices commit one durable event and reject a changed month or document', async t => {
  const db = require('../db/v2Database');
  const service = await import('../lib/livekitInvoices.js').catch(() => null);
  assert.ok(service, 'Lalia LiveKit invoice service exists');
  const { ensureLiveKitInvoiceSchema, importLiveKitInvoice, listLiveKitInvoices } = service.default;
  await db.initDatabase();
  await ensureLiveKitInvoiceSchema();
  t.after(async () => {
    await db.run("DELETE FROM ops_business_outbox WHERE event_type='vendor.invoice.recorded' AND event_id='livekit-invoice:2025-02'");
    await db.run("DELETE FROM v2_livekit_invoices WHERE billing_month='2025-02'");
    await db.close();
  });
  const invoice = { invoiceNumber: 'LK-FIXTURE', billingMonth: '2025-02', issuedOn: '2025-02-28', totalUsd: '42.91' };
  const pdf = Buffer.from('%PDF-1.4\nFixture source evidence\n%%EOF');
  const results = await Promise.all(Array.from({ length: 6 }, () => importLiveKitInvoice(invoice, pdf, 'fixture@example.test')));
  assert.equal(new Set(results.map(row => row.invoiceNumber)).size, 1);
  const stored = (await listLiveKitInvoices()).find(row => row.billingMonth === '2025-02');
  assert.equal(stored.amountMinor, '4291');
  assert.equal(stored.syncStatus, 'pending');
  assert.equal(Object.hasOwn(stored, 'document'), false);
  const rows = await db.all("SELECT envelope FROM ops_business_outbox WHERE event_type='vendor.invoice.recorded' AND event_id='livekit-invoice:2025-02'");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].envelope).payload.amountMinor, '4291');
  await assert.rejects(importLiveKitInvoice({ ...invoice, totalUsd: '42.92' }, pdf, 'fixture@example.test'), /already imported/);
  await assert.rejects(importLiveKitInvoice({ ...invoice, billingMonth: '2025-03', issuedOn: '2025-03-31' }, pdf, 'fixture@example.test'), /already imported/);
  await assert.rejects(importLiveKitInvoice(invoice, Buffer.from('not pdf'), 'fixture@example.test'), /PDF/);
});
