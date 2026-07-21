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
  } catch {
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
