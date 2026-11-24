import { canonicalSupportPayload, supportPayloadHash } from './supportGateway.js';
import { validateBusinessEvent, type BusinessEvent, type BusinessEventReceipt } from './events.js';
export interface BusinessEventSql {
  run(sql: string, params?: any[]): Promise<unknown>;
  get(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;
}
export const BUSINESS_OUTBOX_SCHEMA = [`CREATE TABLE IF NOT EXISTS ops_business_outbox (
   id TEXT PRIMARY KEY,business_id TEXT NOT NULL,environment TEXT NOT NULL,event_type TEXT NOT NULL,event_id TEXT NOT NULL,
   fingerprint TEXT NOT NULL,envelope TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
   next_attempt_at BIGINT NOT NULL DEFAULT 0,lease_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,
   last_error TEXT,result TEXT,UNIQUE(business_id,environment,event_type,event_id))`, `CREATE TABLE IF NOT EXISTS ops_source_revisions (source_id TEXT PRIMARY KEY,revision BIGINT NOT NULL)`, `CREATE TABLE IF NOT EXISTS ops_verified_stripe_receipts (
   id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
   attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at BIGINT NOT NULL DEFAULT 0,lease_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,last_error TEXT)`];
/** Caller must supply the same transaction adapter that commits product state. */
export async function enqueueBusinessEvent(tx: BusinessEventSql, event: BusinessEvent<unknown>): Promise<void> {
  validateBusinessEvent(event);
  const key = [event.businessId, event.environment, event.type, event.eventId];
  const id = await supportPayloadHash(key),
    fingerprint = await supportPayloadHash(event);
  await tx.run(`INSERT INTO ops_business_outbox(id,business_id,environment,event_type,event_id,fingerprint,envelope) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, [id, ...key, fingerprint, canonicalSupportPayload(event)]);
  const saved = await tx.get('SELECT fingerprint FROM ops_business_outbox WHERE id=?', [id]);
  if (saved?.fingerprint !== fingerprint) throw Error('Outbox event payload conflict');
}
export async function nextSourceRevision(tx: BusinessEventSql, sourceId: string): Promise<string> {
  if (!sourceId) throw Error('Source revision identity required');
  const row = await tx.get(`INSERT INTO ops_source_revisions(source_id,revision) VALUES(?,1) ON CONFLICT(source_id) DO UPDATE SET revision=ops_source_revisions.revision+1 RETURNING revision`, [sourceId]);
  return String(row.revision);
}
const MAX_ATTEMPTS = 32;
const LEASE_MS = 60_000;
function worker(options: {
  db: BusinessEventSql;
  process: (payload: any) => Promise<unknown>;
  table: 'ops_business_outbox' | 'ops_verified_stripe_receipts';
  now?: () => number;
}) {
  const now = options.now || Date.now;
  async function drain(limit = 20) {
    // A process can disappear after claiming the last attempt. Do not dispatch
    // that uncertain effect again; retain exhausted evidence after its lease ends.
    await options.db.run(`UPDATE ${options.table} SET status='dead_letter',last_error='Final attempt lease expired; outcome unknown',lease_token=NULL,lease_until=0 WHERE status='pending' AND attempts>=? AND lease_until<=?`, [MAX_ATTEMPTS, now()]);
    const rows = await options.db.all(`SELECT id FROM ${options.table} WHERE status='pending' AND next_attempt_at<=? AND lease_until<=? AND attempts<? ORDER BY next_attempt_at,id LIMIT ?`, [now(), now(), MAX_ATTEMPTS, Math.min(50, Math.max(1, limit))]);
    for (const candidate of rows) {
      const token = crypto.randomUUID(),
        at = now();
      const row = await options.db.get(`UPDATE ${options.table} SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND lease_until<=? AND next_attempt_at<=? AND attempts<? RETURNING *`, [token, at + LEASE_MS, candidate.id, at, at, MAX_ATTEMPTS]);
      if (!row) continue;
      try {
        const result = await options.process(JSON.parse(row.envelope ?? row.payload));
        const extra = options.table === 'ops_business_outbox' ? ',result=?' : '';
        await options.db.run(`UPDATE ${options.table} SET status='delivered',lease_token=NULL,lease_until=0,last_error=NULL${extra} WHERE id=? AND lease_token=? AND lease_until>?`, [...(extra ? [JSON.stringify(result)] : []), row.id, token, now()]);
      } catch (error) {
        await options.db.run(`UPDATE ${options.table} SET status=?,last_error=?,next_attempt_at=?,lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=? AND lease_until>?`, [row.attempts >= MAX_ATTEMPTS ? 'dead_letter' : 'pending', String(error instanceof Error ? error.message : error).slice(0, 500), now() + Math.min(3600000, 1000 * 2 ** Math.min(row.attempts, 12)), row.id, token, now()]);
      }
    }
  }
  let active: Promise<void> | undefined;
  const tick = () => active ??= drain().finally(() => {
    active = undefined;
  });
  return {
    drain,
    start(intervalMs = 5000) {
      void tick().catch(() => {});
      const timer = setInterval(() => {
        void tick().catch(() => {});
      }, intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    }
  };
}
export function createBusinessEventWorker(options: {
  db: BusinessEventSql;
  deliver: (event: BusinessEvent) => Promise<BusinessEventReceipt>;
  now?: () => number;
}) {
  return worker({
    ...options,
    table: 'ops_business_outbox',
    process: async event => {
      const receipt = await options.deliver(event);
      if (receipt?.eventId !== event.eventId || !['applied', 'covered', 'stale', 'deferred', 'needs_reconciliation'].includes(receipt.status)) throw Error('Invalid business event receipt');
      return receipt;
    }
  });
}
/** Must only be called after raw signature verification. Full replayable input is immutable. */
export async function persistVerifiedStripeReceipt(db: BusinessEventSql, event: any): Promise<void> {
  if (typeof event?.id !== 'string' || !event.id || typeof event.livemode !== 'boolean' || !event.data?.object || !Number.isSafeInteger(event.created)) throw Error('Complete verified Stripe receipt required');
  const fingerprint = await supportPayloadHash(event);
  await db.run('INSERT INTO ops_verified_stripe_receipts(id,fingerprint,payload) VALUES(?,?,?) ON CONFLICT DO NOTHING', [event.id, fingerprint, canonicalSupportPayload(event)]);
  if ((await db.get('SELECT fingerprint FROM ops_verified_stripe_receipts WHERE id=?', [event.id]))?.fingerprint !== fingerprint) throw Error('Verified Stripe receipt payload conflict');
}
export function createVerifiedStripeWorker(options: {
  db: BusinessEventSql;
  process: (event: any) => Promise<void>;
  now?: () => number;
}) {
  return worker({
    ...options,
    table: 'ops_verified_stripe_receipts'
  });
}
