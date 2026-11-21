const { createHash } = require('node:crypto');
const { enqueueBusinessEvent, liveKitInvoiceEventId, validateLiveKitInvoiceFact } = require('@rhule/ops-sdk');
const db = require('../db/v2Database');
const { writeAdminAudit } = require('./v2Superadmin');

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const businessId = () => process.env.OPS_HUB_BUSINESS_ID || 'lalia';
const inputError = (message, status = 400) => Object.assign(new Error(message), { status });

async function ensureLiveKitInvoiceSchema() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS v2_livekit_invoices (
      billing_month TEXT PRIMARY KEY, invoice_number TEXT UNIQUE NOT NULL, issued_on TEXT NOT NULL,
      amount_minor TEXT NOT NULL, document_sha256 TEXT UNIQUE NOT NULL, document_base64 TEXT NOT NULL,
      imported_by TEXT NOT NULL, imported_at TEXT NOT NULL
    )
  `);
}

function details(input, document, now = new Date()) {
  if (!Buffer.isBuffer(document) || document.length > MAX_DOCUMENT_BYTES ||
      !document.subarray(0,5).equals(Buffer.from('%PDF-'))) throw inputError('Attach the original LiveKit invoice PDF, up to 4 MB');
  const match = typeof input.totalUsd === 'string' && /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(input.totalUsd.trim());
  if (!match) throw inputError('Enter the USD invoice total with at most two decimal places');
  const amountMinor = String(Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2,'0')));
  const issuedOn = typeof input.issuedOn === 'string' ? input.issuedOn : '';
  const billingMonth = typeof input.billingMonth === 'string' ? input.billingMonth : '';
  const date = new Date(issuedOn + 'T00:00:00Z');
  const today = now.toISOString().slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0,10) !== issuedOn || issuedOn > today || issuedOn.slice(0,7) < billingMonth ||
      billingMonth >= today.slice(0,7)) throw inputError('Use a closed service month and the invoice’s issue date');
  const fact = {
    provider: 'livekit', currency: 'USD', billingMonth, amountMinor,
    invoiceNumber: typeof input.invoiceNumber === 'string' ? input.invoiceNumber.trim().toUpperCase() : '',
    documentSha256: createHash('sha256').update(document).digest('hex'),
  };
  try { validateLiveKitInvoiceFact(fact); }
  catch { throw inputError('Enter a valid invoice number, service month, and positive USD total'); }
  return { fact, issuedOn };
}

async function importLiveKitInvoice(input, document, actor) {
  const { fact, issuedOn } = details(input,document);
  if (businessId() !== 'lalia') throw inputError('LiveKit invoice import requires the Lalia business', 409);
  const event = {
    schemaVersion: 1, businessId: businessId(), environment: 'live',
    type: 'vendor.invoice.recorded', eventId: liveKitInvoiceEventId(fact.billingMonth),
    sourceRevision: '1', occurredAt: issuedOn + 'T00:00:00.000Z', payload: fact,
  };
  return db.transaction(async tx => {
    const insert = await tx.run(`INSERT INTO v2_livekit_invoices(billing_month,invoice_number,issued_on,amount_minor,
      document_sha256,document_base64,imported_by,imported_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, [
      fact.billingMonth, fact.invoiceNumber, issuedOn, fact.amountMinor, fact.documentSha256,
      document.toString('base64'), actor, new Date().toISOString(),
    ]);
    const current = await tx.get(`SELECT billing_month,invoice_number,issued_on,amount_minor,document_sha256
      FROM v2_livekit_invoices WHERE billing_month=?`,[fact.billingMonth]);
    if (!current || current.invoice_number !== fact.invoiceNumber || current.issued_on !== issuedOn ||
        current.amount_minor !== fact.amountMinor || current.document_sha256 !== fact.documentSha256) {
      throw inputError('This invoice, PDF, or service month is already imported with different details', 409);
    }
    await enqueueBusinessEvent(tx,event);
    if (insert.changes) await writeAdminAudit(db,actor,'livekit_invoice_imported',fact);
    return { invoiceNumber: fact.invoiceNumber, billingMonth: fact.billingMonth, alreadyImported: !insert.changes };
  });
}

async function listLiveKitInvoices() {
  const rows = await db.all(`SELECT i.billing_month,i.invoice_number,i.issued_on,i.amount_minor,i.imported_at,o.status,o.result
    FROM v2_livekit_invoices i LEFT JOIN ops_business_outbox o
    ON o.business_id=? AND o.environment='live' AND o.event_type='vendor.invoice.recorded'
      AND o.event_id='livekit-invoice:' || i.billing_month
    ORDER BY i.billing_month DESC`,[businessId()]);
  return rows.map(row => {
    const receipt = row.result ? JSON.parse(row.result) : null;
    return {
      billingMonth: row.billing_month, invoiceNumber: row.invoice_number, issuedOn: row.issued_on,
      amountMinor: row.amount_minor, importedAt: row.imported_at,
      syncStatus: row.status === 'delivered' ? receipt?.status ?? 'unknown' : row.status ?? 'pending',
      reason: receipt?.reason ?? null,
    };
  });
}

async function getLiveKitInvoicePdf(month) {
  const row = await db.get('SELECT invoice_number,document_base64 FROM v2_livekit_invoices WHERE billing_month=?',[month]);
  return row && { invoiceNumber: row.invoice_number, document: Buffer.from(row.document_base64,'base64') };
}

async function retryLiveKitInvoice(month) {
  const eventId = liveKitInvoiceEventId(month);
  const updated = await db.run(`UPDATE ops_business_outbox SET status='pending',attempts=0,next_attempt_at=0,last_error=NULL
    WHERE business_id=? AND environment='live' AND event_type='vendor.invoice.recorded' AND event_id=?
    AND (status='dead_letter' OR (status='delivered' AND result LIKE '%needs_reconciliation%'))
    AND lease_until<=?`,[businessId(),eventId,Date.now()]);
  if (!updated.changes) throw inputError('This invoice is not waiting for a retry',409);
}

async function liveKitEstimate(month) {
  if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw inputError('Choose a valid month');
  const start = new Date(month + '-01T00:00:00Z');
  const end = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1));
  const rows = await db.all(`SELECT breakdown_json,computed_at FROM meeting_cost_rollups
    WHERE computed_at>=? AND computed_at<?`,[start.getTime(),end.getTime()]);
  let amountUsd = 0;
  let meetings = 0;
  let lastComputedAt = 0;
  for (const row of rows) {
    let value;
    try { value = Number(JSON.parse(row.breakdown_json || '{}').livekit); } catch { continue; }
    if (!Number.isFinite(value) || value <= 0) continue;
    amountUsd += value;
    meetings++;
    lastComputedAt = Math.max(lastComputedAt, Number(row.computed_at));
  }
  return { month, amountUsd, meetings, lastComputedAt: lastComputedAt ? new Date(lastComputedAt).toISOString() : null };
}

module.exports = { MAX_DOCUMENT_BYTES, ensureLiveKitInvoiceSchema, importLiveKitInvoice, listLiveKitInvoices,
  getLiveKitInvoicePdf, retryLiveKitInvoice, liveKitEstimate };
