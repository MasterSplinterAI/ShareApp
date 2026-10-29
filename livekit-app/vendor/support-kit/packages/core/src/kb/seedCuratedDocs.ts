import fs from "node:fs";
import path from "node:path";
import type { DbAdapter } from "../adapters/types.js";
import { ensureSchema } from "../db/migrate.js";
import { ingestDocsSources, promoteKbArticle } from "./codegen.js";

export interface SeedCuratedDocsResult {
  tenantId: string;
  docsRoot: string;
  ingested: number;
  promoted: number;
  articleIds: string[];
}

function walkMarkdown(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(full));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

function titleFromMarkdown(rel: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  return rel.split("/").pop()?.replace(/\.md$/i, "") ?? rel;
}

/**
 * Crawl a host markdown tree, ingest as curated drafts, then promote to active.
 * Used by the local harness to seed a demo tenant KB.
 */
export async function seedCuratedDocs(
  db: DbAdapter,
  tenantId: string,
  docsRoot: string,
): Promise<SeedCuratedDocsResult> {
  await ensureSchema(db);
  const root = path.resolve(docsRoot);
  const files = walkMarkdown(root);
  const sources = files.map((file) => {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const body = fs.readFileSync(file, "utf8");
    return { path: rel, title: titleFromMarkdown(rel, body), body };
  });

  const articles = await ingestDocsSources(db, tenantId, sources);
  let promoted = 0;
  const articleIds: string[] = [];
  for (const article of articles) {
    await promoteKbArticle(db, tenantId, article.id, undefined, {
      visibility: "public",
    });
    promoted += 1;
    articleIds.push(article.id);
  }

  return {
    tenantId,
    docsRoot: root,
    ingested: articles.length,
    promoted,
    articleIds,
  };
}
