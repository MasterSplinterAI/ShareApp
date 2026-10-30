import { randomUUID } from "node:crypto";
import type { KbArticle, KbArticleStatus, KbVisibility } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

type KbArticleRow = {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  status: string;
  source_kind: string;
  visibility: string | null;
  provenance_json: string | null;
  source_key: string | null;
  created_at: string;
  updated_at: string;
};

function mapKbArticle(row: KbArticleRow): KbArticle {
  return {
    id: row.id,
    tenantId: row.tenant_id as KbArticle["tenantId"],
    title: row.title,
    body: row.body,
    status: row.status as KbArticle["status"],
    sourceKind: row.source_kind as KbArticle["sourceKind"],
    visibility: (row.visibility as KbVisibility) ?? "agent",
    provenanceJson: row.provenance_json,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface IngestCodegenArticleInput {
  tenantId: string;
  title: string;
  body: string;
  sourceKey: string;
  gitSha?: string;
  path?: string;
  visibility?: KbVisibility;
  tablePrefix?: string;
  sourceKind?: "codegen" | "evolutionary" | "curated" | "code_research";
}

/**
 * Ingest a codegen-sourced KB article as draft. Upserts on (tenant_id, source_kind, source_key).
 */
export async function ingestCodegenArticle(
  db: DbAdapter,
  input: IngestCodegenArticleInput,
): Promise<KbArticle> {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = new Date().toISOString();
  const sourceKind = input.sourceKind ?? "codegen";
  const visibility = input.visibility ?? "agent";
  const provenanceJson = JSON.stringify({
    gitSha: input.gitSha ?? null,
    path: input.path ?? null,
    ingestedAt: now,
  });

  const existing = await db.get<KbArticleRow>(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND source_kind = ? AND source_key = ?`,
    [input.tenantId, sourceKind, input.sourceKey],
  );

  if (existing) {
    await db.run(
      `UPDATE ${table}
       SET title = ?, body = ?, status = 'draft', visibility = ?, provenance_json = ?, updated_at = ?
       WHERE id = ?`,
      [input.title, input.body, visibility, provenanceJson, now, existing.id],
    );
    const row = await db.get<KbArticleRow>(`SELECT * FROM ${table} WHERE id = ?`, [existing.id]);
    if (!row) throw new Error("ingestCodegenArticle: upsert failed");
    return mapKbArticle(row);
  }

  const id = randomUUID();
  await db.run(
    `INSERT INTO ${table} (
      id, tenant_id, title, body, status, source_kind, visibility, provenance_json, source_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.title,
      input.body,
      sourceKind,
      visibility,
      provenanceJson,
      input.sourceKey,
      now,
      now,
    ],
  );
  const row = await db.get<KbArticleRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("ingestCodegenArticle: insert failed");
  return mapKbArticle(row);
}

export async function promoteKbArticle(
  db: DbAdapter,
  tenantId: string,
  id: string,
  tablePrefix?: string,
  opts?: { visibility?: KbVisibility },
): Promise<KbArticle> {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = new Date().toISOString();

  const existing = await db.get<KbArticleRow>(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
  if (!existing) {
    throw new Error(`promoteKbArticle: article not found (${id})`);
  }

  if (opts?.visibility) {
    await db.run(
      `UPDATE ${table} SET status = 'active', visibility = ?, updated_at = ? WHERE id = ?`,
      [opts.visibility, now, id],
    );
  } else {
    await db.run(
      `UPDATE ${table} SET status = 'active', updated_at = ? WHERE id = ?`,
      [now, id],
    );
  }

  const row = await db.get<KbArticleRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("promoteKbArticle: update failed");
  return mapKbArticle(row);
}

export async function deprecateKbArticle(
  db: DbAdapter,
  tenantId: string,
  id: string,
  tablePrefix?: string,
): Promise<KbArticle> {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = new Date().toISOString();
  await db.run(
    `UPDATE ${table} SET status = 'deprecated', updated_at = ? WHERE tenant_id = ? AND id = ?`,
    [now, tenantId, id],
  );
  const row = await db.get<KbArticleRow>(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
  if (!row) throw new Error(`deprecateKbArticle: article not found (${id})`);
  return mapKbArticle(row);
}

export async function updateKbArticle(
  db: DbAdapter,
  tenantId: string,
  id: string,
  patch: { title?: string; body?: string; visibility?: KbVisibility },
  tablePrefix?: string,
): Promise<KbArticle> {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const existing = await db.get<KbArticleRow>(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
  if (!existing) throw new Error(`updateKbArticle: not found (${id})`);
  const now = new Date().toISOString();
  await db.run(
    `UPDATE ${table} SET title = ?, body = ?, visibility = ?, updated_at = ? WHERE id = ?`,
    [
      patch.title ?? existing.title,
      patch.body ?? existing.body,
      patch.visibility ?? existing.visibility ?? "agent",
      now,
      id,
    ],
  );
  const row = await db.get<KbArticleRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("updateKbArticle: reload failed");
  return mapKbArticle(row);
}

export async function listKbArticles(
  db: DbAdapter,
  tenantId: string,
  opts?: {
    status?: KbArticleStatus;
    sourceKind?: string;
    limit?: number;
    tablePrefix?: string;
  },
): Promise<KbArticle[]> {
  const prefix = opts?.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const limit = opts?.limit ?? 100;
  const clauses = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (opts?.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.sourceKind) {
    clauses.push("source_kind = ?");
    params.push(opts.sourceKind);
  }
  params.push(limit);
  const rows = await db.all<KbArticleRow>(
    `SELECT * FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    params,
  );
  return rows.map(mapKbArticle);
}

export async function getKbArticle(
  db: DbAdapter,
  tenantId: string,
  id: string,
  tablePrefix?: string,
): Promise<KbArticle | undefined> {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const row = await db.get<KbArticleRow>(
    `SELECT * FROM ${prefix}kb_articles WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
  return row ? mapKbArticle(row) : undefined;
}

export interface IngestFromChangelogOptions {
  gitSha?: string;
  tablePrefix?: string;
}

function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function ingestFromChangelog(
  db: DbAdapter,
  tenantId: string,
  changelogText: string,
  opts?: IngestFromChangelogOptions,
): Promise<KbArticle[]> {
  const sections = changelogText.split(/\n(?=##\s)/);
  const articles: KbArticle[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s+(.+?)(?:\n|$)/);
    if (!match) continue;

    const heading = match[1]!.trim();
    const sourceKey = `changelog:${slugifyHeading(heading)}`;
    const ingestInput: IngestCodegenArticleInput = {
      tenantId,
      title: heading,
      body: trimmed,
      sourceKey,
    };
    if (opts?.gitSha) ingestInput.gitSha = opts.gitSha;
    if (opts?.tablePrefix) ingestInput.tablePrefix = opts.tablePrefix;
    const article = await ingestCodegenArticle(db, ingestInput);
    articles.push(article);
  }

  return articles;
}

export interface IngestDocSource {
  path: string;
  title?: string;
  body: string;
}

/**
 * Upsert support-doc markdown paths as draft codegen articles.
 */
export async function ingestDocsSources(
  db: DbAdapter,
  tenantId: string,
  sources: IngestDocSource[],
  opts?: { gitSha?: string; tablePrefix?: string },
): Promise<KbArticle[]> {
  const articles: KbArticle[] = [];
  for (const src of sources) {
    const sourceKey = `docs:${src.path.replace(/^\/+/, "")}`;
    const title =
      src.title ??
      src.path.split("/").pop()?.replace(/\.md$/i, "") ??
      src.path;
    const ingestInput: IngestCodegenArticleInput = {
      tenantId,
      title,
      body: src.body,
      sourceKey,
      path: src.path,
    };
    if (opts?.gitSha) ingestInput.gitSha = opts.gitSha;
    if (opts?.tablePrefix) ingestInput.tablePrefix = opts.tablePrefix;
    articles.push(await ingestCodegenArticle(db, ingestInput));
  }
  return articles;
}
