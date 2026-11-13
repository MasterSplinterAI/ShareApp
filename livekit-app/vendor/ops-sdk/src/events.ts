/** Host-generated IDs and revisions are durable source identities, never transport timestamps. */
export const BUSINESS_EVENT_TYPES = ['contact.changed', 'consent.changed', 'billing.recorded', 'vendor.invoice.recorded', 'usage.accrued', 'metrics.snapshot'] as const;
export type BusinessEventType = typeof BUSINESS_EVENT_TYPES[number];
export interface BusinessEvent<T = Record<string, unknown>> {
  schemaVersion: 1;
  eventId: string;
  businessId: string;
  environment: 'live' | 'test';
  type: BusinessEventType;
  sourceRevision: string;
  occurredAt: string;
  payload: T;
}
export interface BillingFact {
  factId: string;
  eventType: 'charge.succeeded' | 'invoice.paid' | 'charge.refunded' | 'charge.dispute.created' | 'payout.paid';
  currency: string;
  grossMinor: string;
  taxMinor: string;
  feeStatus: 'actual' | 'estimated' | 'unknown';
  feeMinor?: string;
  aliases: string[];
  revenueStream?: 'usage_topup' | 'annual_deferred' | 'subscription';
  apiVersion?: string;
  description?: string;
  /** Provider linkage is evidence, never equivalence between financial effects. */
  relatedPaymentId?: string;
  relatedChargeId?: string;
  /** Only cumulative refunds use this: monotonic charge-level totals, not per-webhook amounts. */
  refundChargeId?: string;
  cumulativeRefundMinor?: string;
}
export interface UsageFact {
  sourceId: string;
  currency: string;
  costMicros: string;
  category: 'ai_inference' | 'media_stt' | 'cloud_hosting';
  boundary: 'per_call' | 'per_row' | 'unknown_aggregate';
  aliases: string[];
  provider?: string;
  costSource?: string;
  originalCost?: string;
  sourceSystem?: 'lex_ai_usage_log' | 'lalia_meeting_cost_events';
  sourceRowId?: string;
  sourceBoundaryId?: string;
}
export interface BusinessEventReceipt {
  eventId: string;
  status: 'applied' | 'covered' | 'stale' | 'deferred' | 'needs_reconciliation';
  journalId?: string;
  reason?: string;
}
export function validateBusinessEvent(value: unknown): asserts value is BusinessEvent {
  const e = value as BusinessEvent;
  if (!e || e.schemaVersion !== 1) throw Error('Unsupported business event schemaVersion');
  if (!(BUSINESS_EVENT_TYPES as readonly string[]).includes(e.type)) throw Error('Unsupported business event type');
  for (const field of ['eventId', 'businessId'] as const) {
    if (typeof e[field] !== 'string' || !e[field].trim() || e[field].length > 128) throw Error(`Missing or invalid ${field}`);
  }
  if (!['live', 'test'].includes(e.environment)) throw Error('Explicit event environment required');
  if (typeof e.sourceRevision !== 'string' || !/^(0|[1-9]\d{0,29})$/.test(e.sourceRevision)) throw Error('Monotonic integer sourceRevision required');
  if (typeof e.occurredAt !== 'string' || !Number.isFinite(Date.parse(e.occurredAt))) throw Error('Valid occurredAt required');
  if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) throw Error('Object payload required');
}
/** Decimal USD → integer micro-dollars. Half-up at the seventh fractional digit; no floating-point accumulation. */
export function usdToMicros(value: string | number): string {
  const raw = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) throw Error('Non-negative decimal USD required');
  const fraction = match[2] || '';
  const shift = 6 + Number(match[3] || 0) - fraction.length;
  if (Math.abs(shift) > 100) throw Error('USD value out of range');
  const digits = BigInt(match[1] + fraction);
  const power = BigInt('1' + '0'.repeat(Math.abs(shift)));
  return (shift >= 0 ? digits * power : (digits + power / BigInt(2)) / power).toString();
}

/** Pure normalization of already verified provider input. It never verifies or calls Stripe. */
export function stripeBusinessEvent(businessId: string, event: any): BusinessEvent<BillingFact> | null {
  if (!event?.id || typeof event.livemode !== 'boolean' || !Number.isSafeInteger(event.created)) throw Error('Complete verified Stripe receipt required');
  const obj = event.data?.object;
  if (!obj?.id) throw Error('Stripe object identity required');
  const id = (value: any) => typeof value === 'string' ? value : value?.id;
  const minor = (value: any) => {
    if (!Number.isSafeInteger(value) || value < 0) throw Error('Non-negative Stripe minor units required');
    return String(value);
  };
  let eventType: BillingFact['eventType'];
  let gross: number;
  let tax = 0;
  let factId: string;
  let refundChargeId: string | undefined;
  let cumulativeRefundMinor: string | undefined;
  const payment = id(obj.payment_intent) || id(obj.payments?.data?.find((p: any) => p.payment?.payment_intent)?.payment?.payment_intent);
  if (event.type === 'invoice.paid') {
    eventType = 'invoice.paid';
    const taxes = obj.total_taxes ?? obj.total_tax_amounts;
    tax = Array.isArray(taxes) ? taxes.reduce((sum: number, t: any) => sum + Number(t.amount), 0) : Number(obj.tax ?? 0);
    gross = Number(obj.amount_paid) - tax;
    factId = payment ? `payment:${payment}` : `invoice:${obj.id}`;
  } else if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    if (obj.payment_status === 'unpaid' || obj.mode === 'subscription') return null;
    eventType = 'charge.succeeded';
    tax = Number(obj.total_details?.amount_tax ?? 0);
    gross = Number(obj.amount_total) - tax;
    // An invoice is settled separately; leave ambiguous linkage to that authoritative receipt.
    factId = payment ? `payment:${payment}` : id(obj.invoice) ? `invoice:${id(obj.invoice)}` : `checkout:${obj.id}`;
  } else if (event.type === 'charge.refunded') {
    eventType = 'charge.refunded';
    gross = Number(obj.amount_refunded);
    refundChargeId = obj.id;
    cumulativeRefundMinor = minor(gross);
    factId = `refund:${obj.id}`;
  } else if (event.type === 'charge.dispute.created') {
    eventType = 'charge.dispute.created';
    gross = Number(obj.amount);
    factId = `dispute:${obj.id}`;
  } else if (event.type === 'payout.paid') {
    eventType = 'payout.paid';
    gross = Number(obj.amount);
    factId = `payout:${obj.id}`;
  } else return null;
  const isSale = eventType === 'charge.succeeded' || eventType === 'invoice.paid';
  const relatedChargeId = refundChargeId || id(obj.charge) || id(obj.payment_intent?.latest_charge);
  const equivalentAliases = refundChargeId ? [event.id, `refund:${refundChargeId}`] : [event.id, obj.id];
  if (isSale) {
    if (payment) equivalentAliases.push(`payment:${payment}`);
    const invoice = event.type === 'invoice.paid' ? obj.id : id(obj.invoice);
    if (invoice) equivalentAliases.push(`invoice:${invoice}`);
  }
  return {
    schemaVersion: 1,
    eventId: event.id,
    businessId,
    environment: event.livemode ? 'live' : 'test',
    type: 'billing.recorded',
    sourceRevision: String(event.created),
    occurredAt: new Date(event.created * 1000).toISOString(),
    payload: {
      factId,
      eventType,
      currency: String(obj.currency || 'unknown').toUpperCase(),
      grossMinor: minor(gross),
      taxMinor: minor(tax),
      feeStatus: 'unknown',
      aliases: equivalentAliases,
      ...(payment ? { relatedPaymentId: payment } : {}),
      ...(relatedChargeId ? { relatedChargeId } : {}),
      apiVersion: event.api_version || 'unknown',
      ...(refundChargeId ? {
        refundChargeId,
        cumulativeRefundMinor
      } : {}),
      revenueStream: obj.metadata?.type === 'credit_topup' ? 'usage_topup' : 'subscription'
    }
  };
}

export interface LiveKitInvoiceFact {
  provider: 'livekit';
  invoiceNumber: string;
  billingMonth: string;
  currency: 'USD';
  amountMinor: string;
  documentSha256: string;
}
export function liveKitInvoiceEventId(month: string): string {
  return 'livekit-invoice:' + month;
}
export function validateLiveKitInvoiceFact(value: unknown): asserts value is LiveKitInvoiceFact {
  const fact = value as LiveKitInvoiceFact;
  if (!fact || fact.provider !== 'livekit' || fact.currency !== 'USD' ||
      typeof fact.invoiceNumber !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(fact.invoiceNumber) ||
      typeof fact.billingMonth !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(fact.billingMonth) ||
      typeof fact.amountMinor !== 'string' || !/^[1-9]\d{0,9}$/.test(fact.amountMinor) ||
      typeof fact.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fact.documentSha256)) {
    throw new Error('Invalid LiveKit invoice details');
  }
}
