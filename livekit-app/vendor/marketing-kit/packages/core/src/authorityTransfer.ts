import { createHash } from 'node:crypto';
import type { MarketingDbAdapter } from './schema.js';

export const MARKETING_HISTORY_TABLES = [
  'mkt_posts', 'mkt_post_revisions', 'mkt_assets', 'mkt_campaigns',
  'mkt_campaign_recipients', 'mkt_subscribers', 'mkt_copilot_messages',
] as const;
type HistoryTable = (typeof MARKETING_HISTORY_TABLES)[number];
type Row = Record<string, string | number | boolean | null>;
type AuthorityMode = 'legacy' | 'frozen' | 'central' | 'cache';
interface AuthorityRow { mode: AuthorityMode; generation: number | string; projection_revision: number | string; projection_hash: string; frozen_from: string | null }
export interface MarketingInventory { count: number; digest: string }

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function rowHash(row: Row): string {
  return hash(JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]])));
}

export async function ensureMarketingAuthority(db: MarketingDbAdapter, businessId: string, initial: 'legacy' | 'frozen') {
  await db.run(`CREATE TABLE IF NOT EXISTS mkt_authority (
    business_id TEXT PRIMARY KEY, generation BIGINT NOT NULL, mode TEXT NOT NULL, frozen_from TEXT,
    projection_revision BIGINT NOT NULL DEFAULT 0, projection_hash TEXT NOT NULL DEFAULT ''
  )`);
  await db.run(`INSERT INTO mkt_authority(business_id,generation,mode,frozen_from) VALUES (?,1,?,?) ON CONFLICT (business_id) DO NOTHING`,[businessId,initial,initial === 'frozen' ? 'target' : null]);
}

export async function readMarketingAuthority(db: MarketingDbAdapter, businessId: string) {
  return db.get<AuthorityRow>('SELECT mode,generation,projection_revision,projection_hash,frozen_from FROM mkt_authority WHERE business_id=?',[businessId]);
}

async function requireFrozen(db: MarketingDbAdapter, businessId: string, generation: number, side: 'source' | 'target') {
  const authority = await readMarketingAuthority(db,businessId);
  if (!authority || authority.mode !== 'frozen' || Number(authority.generation)+1 !== generation) {
    throw new Error('Marketing authority is not frozen for this generation');
  }
  const source = authority.frozen_from === 'legacy' || authority.frozen_from === 'central';
  if (source !== (side === 'source')) throw new Error('Marketing transfer has the wrong authority role');
}

export async function freezeMarketingAuthority(db: MarketingDbAdapter, businessId: string, generation: number) {
  const result = await db.run("UPDATE mkt_authority SET frozen_from=mode,mode='frozen' WHERE business_id=? AND generation=? AND mode IN ('legacy','central','cache')",[businessId,generation]);
  if (!result.changes) {
    const row = await readMarketingAuthority(db,businessId);
    if (row?.mode !== 'frozen' || Number(row.generation) !== generation) throw new Error('Marketing authority generation changed');
  }
}

export async function startMarketingCache(db: MarketingDbAdapter, businessId: string, generation: number) {
  const changed = await db.run("UPDATE mkt_authority SET mode='cache',generation=?,frozen_from=NULL,projection_revision=0,projection_hash='' WHERE business_id=? AND mode='frozen' AND frozen_from='legacy' AND generation=?",[generation,businessId,generation-1]);
  if (!changed.changes) {
    const current = await readMarketingAuthority(db,businessId);
    if (current?.mode !== 'cache' || Number(current.generation) !== generation) throw new Error('Marketing cache generation changed');
  }
}

async function requireSettled(db: MarketingDbAdapter, businessId: string) {
  const pending = await db.get<{ count: number | string }>(`SELECT COUNT(*) AS count FROM mkt_campaigns
    WHERE tenant_id=? AND status IN ('scheduled','sending','paused')`,[businessId]);
  const ambiguous = await db.get<{ count: number | string }>(`SELECT COUNT(*) AS count FROM mkt_campaign_recipients
    WHERE tenant_id=? AND status='dispatching'`,[businessId]);
  if (Number(pending?.count) || Number(ambiguous?.count)) throw new Error('Reconcile scheduled and ambiguous sends before moving marketing authority');
}

export async function exportMarketingPage(db: MarketingDbAdapter, businessId: string, generation: number, table: HistoryTable, cursor: string) {
  if (!MARKETING_HISTORY_TABLES.includes(table)) throw new Error('Unknown marketing history table');
  await requireFrozen(db,businessId,generation,'source');
  await requireSettled(db,businessId);
  const rows = await db.all<Row>(`SELECT * FROM ${table} WHERE tenant_id=? AND id>? ORDER BY id LIMIT 50`,[businessId,cursor]);
  return { rows, next: rows.length === 50 ? String(rows[49].id) : null };
}

async function writeRow(db: MarketingDbAdapter, table: HistoryTable, businessId: string, row: Row, replace = false) {
  if (!row || typeof row.id !== 'string' || !row.id || row.tenant_id !== businessId) throw new Error('Invalid marketing record scope');
  const columns = Object.keys(row).sort();
  if (columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error('Invalid marketing record column');
  const existing = await db.get<Row>(`SELECT * FROM ${table} WHERE id=?`,[row.id]);
  if (existing) {
    if (existing.tenant_id !== businessId) throw new Error(`Marketing identity conflict for ${table} ${row.id}`);
    if (rowHash(existing) === rowHash(row)) return;
    if (!replace) throw new Error(`Marketing history conflict for ${table} ${row.id}`);
    const fields = columns.filter(column => column !== 'id' && column !== 'tenant_id');
    await db.run(`UPDATE ${table} SET ${fields.map(column => `"${column}"=?`).join(',')} WHERE id=? AND tenant_id=?`,[...fields.map(column => row[column]),row.id,businessId]);
    return;
  }
  await db.run(`INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,columns.map(column => row[column]));
}

export async function importMarketingPage(db: MarketingDbAdapter, businessId: string, generation: number, table: HistoryTable, rows: Row[]) {
  if (!db.transaction || !MARKETING_HISTORY_TABLES.includes(table) || !Array.isArray(rows) || rows.length > 50) throw new Error('Invalid marketing import page');
  await db.transaction(async tx => {
    await requireFrozen(tx,businessId,generation,'target');
    for (const row of rows) {
      if (table === 'mkt_campaigns' && ['scheduled','sending','paused'].includes(String(row.status))) throw new Error('Active campaign needs reconciliation before import');
      if (table === 'mkt_campaign_recipients' && row.status === 'dispatching') throw new Error('Ambiguous delivery needs reconciliation before import');
      await writeRow(tx,table,businessId,row);
    }
  });
}

export async function marketingInventory(db: MarketingDbAdapter, businessId: string): Promise<Record<HistoryTable, MarketingInventory>> {
  const result = {} as Record<HistoryTable, MarketingInventory>;
  for (const table of MARKETING_HISTORY_TABLES) {
    const entries: string[] = [];
    let cursor = '';
    for (;;) {
      const rows = await db.all<Row>(`SELECT * FROM ${table} WHERE tenant_id=? AND id>? ORDER BY id LIMIT 50`,[businessId,cursor]);
      entries.push(...rows.map(row => `${row.id}:${rowHash(row)}`));
      if (rows.length < 50) break;
      cursor = String(rows[49].id);
    }
    result[table] = { count: entries.length, digest: hash(entries.sort().join('\n')) };
  }
  return result;
}

export async function activateMarketingAuthority(db: MarketingDbAdapter, businessId: string, generation: number, mode: 'legacy' | 'central', expected: Record<HistoryTable, MarketingInventory>) {
  if (!db.transaction) throw new Error('Transactional marketing activation required');
  await db.transaction(async tx => {
    await requireFrozen(tx,businessId,generation,'target');
    await requireSettled(tx,businessId);
    const observed = await marketingInventory(tx,businessId);
    for (const table of MARKETING_HISTORY_TABLES) {
      if (observed[table].count !== expected?.[table]?.count || observed[table].digest !== expected[table].digest) {
        throw new Error(`Marketing reconciliation failed for ${table}`);
      }
    }
    const changed = await tx.run("UPDATE mkt_authority SET mode=?,generation=?,frozen_from=NULL,projection_revision=0,projection_hash='' WHERE business_id=? AND mode='frozen' AND generation=?",[mode,generation,businessId,generation-1]);
    if (!changed.changes) throw new Error('Marketing activation lost the authority fence');
  });
}

export interface MarketingPublishedSnapshot {
  version: 1;
  businessId: string;
  generation: number;
  revision: number;
  posts: Row[];
  assets: Row[];
}

export async function captureMarketingProjection(db: MarketingDbAdapter, businessId: string): Promise<MarketingPublishedSnapshot> {
  if (!db.transaction) throw new Error('Transactional marketing projection required');
  return db.transaction(async tx => {
    // Serialize versions so an older response can never restore unpublished content.
    const locked = await tx.run("UPDATE mkt_authority SET generation=generation WHERE business_id=? AND mode='central'",[businessId]);
    if (!locked.changes) throw new Error('Central marketing authority is unavailable');
    const current = (await readMarketingAuthority(tx,businessId))!;
    const posts = await tx.all<Row>("SELECT * FROM mkt_posts WHERE tenant_id=? AND status='published' ORDER BY id",[businessId]);
    const publishedIds = new Set(posts.map(post => post.id));
    const assets = (await tx.all<Row>(`SELECT * FROM mkt_assets WHERE tenant_id=? AND target_type='blog'
      AND status='approved' ORDER BY id`,[businessId])).filter(asset => publishedIds.has(asset.target_id));
    const digest = hash(JSON.stringify([posts.map(rowHash),assets.map(rowHash)]));
    const revision = Number(current.projection_revision) + (digest === current.projection_hash ? 0 : 1);
    if (revision !== Number(current.projection_revision)) await tx.run('UPDATE mkt_authority SET projection_revision=?,projection_hash=? WHERE business_id=?',[revision,digest,businessId]);
    return {version:1,businessId,generation:Number(current.generation),revision,posts,assets};
  });
}

export async function applyMarketingProjection(db: MarketingDbAdapter, expectedBusiness: string, snapshot: MarketingPublishedSnapshot) {
  if (!db.transaction || snapshot.version !== 1 || snapshot.businessId !== expectedBusiness ||
      !Number.isSafeInteger(snapshot.generation) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
      !Array.isArray(snapshot.posts) || !Array.isArray(snapshot.assets)) throw new Error('Invalid published marketing projection');
  return db.transaction(async tx => {
    const changed = await tx.run(`UPDATE mkt_authority SET projection_revision=? WHERE business_id=? AND mode='cache'
      AND generation=? AND projection_revision<?`,[snapshot.revision,expectedBusiness,snapshot.generation,snapshot.revision]);
    if (!changed.changes) return false;
    const published = new Set(snapshot.posts.map(post => post.id));
    for (const old of await tx.all<{id:string}>("SELECT id FROM mkt_posts WHERE tenant_id=? AND status='published'",[expectedBusiness])) {
      if (!published.has(old.id)) await tx.run("UPDATE mkt_posts SET status='approved' WHERE id=? AND tenant_id=?",[old.id,expectedBusiness]);
    }
    for (const post of snapshot.posts) {
      if (post.status !== 'published') throw new Error('Unpublished post in public projection');
      await writeRow(tx,'mkt_posts',expectedBusiness,post,true);
    }
    for (const asset of snapshot.assets) {
      if (asset.status !== 'approved' || asset.target_type !== 'blog' || !published.has(asset.target_id)) throw new Error('Unpublished asset in public projection');
      await writeRow(tx,'mkt_assets',expectedBusiness,asset,true);
    }
    return true;
  });
}

export async function runMarketingTransfer(db: MarketingDbAdapter, businessId: string, target: 'legacy' | 'central', input: any) {
  const generation = input?.generation;
  if (input?.businessId !== businessId || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid marketing transfer scope');
  switch (input.action) {
    case 'status': return readMarketingAuthority(db,businessId);
    case 'inspect': return marketingInventory(db,businessId);
    case 'freeze': await freezeMarketingAuthority(db,businessId,generation); return { frozen: true };
    case 'inventory':
      await requireFrozen(db,businessId,generation,'source');
      await requireSettled(db,businessId);
      return marketingInventory(db,businessId);
    case 'page': return exportMarketingPage(db,businessId,generation,input.table,String(input.cursor ?? ''));
    case 'import':
      await importMarketingPage(db,businessId,generation,input.table,input.rows);
      return { imported: input.rows.length };
    case 'activate':
      await activateMarketingAuthority(db,businessId,generation,target,input.inventory);
      return { mode: target, generation };
    case 'cache':
      if (target !== 'legacy') throw new Error('Only the app can become the public cache');
      await startMarketingCache(db,businessId,generation);
      return { mode: 'cache', generation };
    case 'standby': {
      if (target !== 'central') throw new Error('Only OpsHub can retain a frozen copy after reversal');
      const changed = await db.run("UPDATE mkt_authority SET generation=?,frozen_from='target' WHERE business_id=? AND mode='frozen' AND frozen_from='central' AND generation=?",[generation,businessId,generation-1]);
      if (!changed.changes) {
        const current = await readMarketingAuthority(db,businessId);
        if (current?.mode !== 'frozen' || current.frozen_from !== 'target' || Number(current.generation) !== generation) throw new Error('Marketing standby generation changed');
      }
      return { mode:'frozen',generation };
    }
    default: throw new Error('Unknown marketing transfer action');
  }
}
