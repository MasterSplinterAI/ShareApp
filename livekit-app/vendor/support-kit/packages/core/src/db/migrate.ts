import type { DbAdapter } from "../adapters/types.js";
import { buildAlterStatements, buildSchemaStatements } from "./schema.js";

export const DEFAULT_TABLE_PREFIX = "support_";

async function columnExists(
  db: DbAdapter,
  table: string,
  column: string,
): Promise<boolean> {
  try {
    const rows = await db.all<{ name?: string; column_name?: string }>(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_name = ? AND column_name = ?`,
      [table, column],
    );
    if (rows.length > 0) return true;
  } catch {
    /* not Postgres / no information_schema — fall through */
  }

  try {
    const rows = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (rows.length > 0) {
      return rows.some((r) => r.name === column);
    }
  } catch {
    /* ignore */
  }

  try {
    await db.get(`SELECT ${column} FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}

async function runQuiet(db: DbAdapter, sql: string): Promise<boolean> {
  try {
    await db.run(sql.trim());
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no such|SQLITE_ERROR|Cannot read|null/i.test(message)) {
      console.warn(`[support-kit] ensureSchema statement failed: ${message}`);
    }
    return false;
  }
}

/**
 * Idempotent schema ensure for kit-owned tables.
 * Call once at host boot before serving traffic.
 *
 * Order matters for existing DBs: tables → column alters → indexes
 * (Postgres fails CREATE INDEX on columns that do not exist yet).
 */
export async function ensureSchema(
  db: DbAdapter,
  tablePrefix: string = DEFAULT_TABLE_PREFIX,
): Promise<{ tablePrefix: string; statements: number }> {
  if (!/^[a-z][a-z0-9_]*$/.test(tablePrefix)) {
    throw new Error(`ensureSchema: invalid tablePrefix "${tablePrefix}"`);
  }

  const statements = buildSchemaStatements(tablePrefix);
  const creates = statements.filter((s) => /^\s*CREATE\s+TABLE/i.test(s));
  const indexes = statements.filter((s) => /^\s*CREATE\s+INDEX/i.test(s));

  let applied = 0;
  for (const sql of creates) {
    if (await runQuiet(db, sql)) applied += 1;
  }

  for (const alter of buildAlterStatements(tablePrefix)) {
    const exists = await columnExists(db, alter.table, alter.column);
    if (!exists) {
      if (await runQuiet(db, alter.ddl)) applied += 1;
    }
  }

  for (const sql of indexes) {
    if (await runQuiet(db, sql)) applied += 1;
  }

  // Preserve existing reviewed snapshots as immutable revisions. Deterministic IDs make
  // startup retries harmless; fail closed if revision migration cannot be completed.
  await db.run(`INSERT INTO ${tablePrefix}kb_revisions
    (id,article_id,tenant_id,title,body,visibility,provenance_json,source_revision,created_at)
    SELECT 'legacy:' || id,id,tenant_id,title,body,visibility,provenance_json,'legacy:' || id,updated_at
    FROM ${tablePrefix}kb_articles WHERE draft_revision_id IS NULL
    ON CONFLICT (id) DO NOTHING`);
  await db.run(`UPDATE ${tablePrefix}kb_articles SET
    draft_revision_id='legacy:' || id,
    published_revision_id=CASE WHEN status='active' THEN 'legacy:' || id ELSE NULL END
    WHERE draft_revision_id IS NULL`);
  try {
    await db.run(`CREATE VIEW ${tablePrefix}kb_operator_articles AS
    SELECT a.id,a.tenant_id,COALESCE(r.title,a.title) AS title,COALESCE(r.body,a.body) AS body,
      CASE WHEN a.status='deprecated' THEN 'deprecated'
        WHEN a.draft_revision_id=a.published_revision_id THEN 'active' ELSE 'draft' END AS status,
      a.source_kind,COALESCE(r.visibility,a.visibility) AS visibility,
      COALESCE(r.provenance_json,a.provenance_json) AS provenance_json,a.source_key,a.created_at,a.updated_at,
      a.draft_revision_id,a.published_revision_id,a.revision_version,a.removal_candidate
    FROM ${tablePrefix}kb_articles a LEFT JOIN ${tablePrefix}kb_revisions r
      ON r.id=a.draft_revision_id AND r.tenant_id=a.tenant_id AND r.article_id=a.id`);
  } catch (error) {
    const duplicate = error as { code?: string; message?: string };
    if (duplicate.code !== '42P07' && !/^view [^ ]+ already exists$/i.test(duplicate.message ?? '')) throw error;
    // Duplicate creation is expected on startup or a concurrent initializer. Verify
    // the existing projection rather than masking a missing/incompatible view.
    await db.all(`SELECT id,tenant_id,title,body,status,source_kind,visibility,provenance_json,
      source_key,created_at,updated_at,draft_revision_id,published_revision_id,
      revision_version,removal_candidate FROM ${tablePrefix}kb_operator_articles LIMIT 0`);
  }

  // Backfill kind/topic from legacy category
  try {
    await db.run(`
      UPDATE ${tablePrefix}tickets SET
        kind = CASE category
          WHEN 'bug' THEN 'bug'
          WHEN 'feature' THEN 'feature'
          ELSE 'support'
        END,
        topic = CASE category
          WHEN 'billing' THEN 'billing'
          WHEN 'how_to' THEN 'how_to'
          WHEN 'feature' THEN 'product'
          WHEN 'bug' THEN 'other'
          ELSE COALESCE(NULLIF(topic, ''), 'other')
        END
      WHERE kind IS NULL OR kind = '' OR topic IS NULL OR topic = ''
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'support', topic = 'billing'
      WHERE category = 'billing'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'support', topic = 'how_to'
      WHERE category = 'how_to'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'bug', topic = COALESCE(NULLIF(topic, ''), 'other')
      WHERE category = 'bug'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'feature', topic = COALESCE(NULLIF(topic, ''), 'product')
      WHERE category = 'feature'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET status = 'waiting_user'
      WHERE status = 'pending_user'
    `);
  } catch {
    /* ignore backfill errors */
  }

  return { tablePrefix, statements: applied };
}
