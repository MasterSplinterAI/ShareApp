import { createHash, randomUUID } from "node:crypto";
import type { KbArticle, KbArticleStatus, KbVisibility } from "@quill/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
type KbArticleRow = {
    id: string;
    tenant_id: string;
    title: string;
    body: string;
    status: string;
    source_kind: string;
    visibility: string;
    provenance_json: string | null;
    source_key: string | null;
    created_at: string;
    updated_at: string;
    draft_revision_id: string | null;
    published_revision_id: string | null;
    revision_version: number;
    removal_candidate: number;
};
type RevisionRow = {
    id: string;
    title: string;
    body: string;
    visibility: KbVisibility;
    provenance_json: string | null;
    source_revision: string;
};
function mapKbArticle(row: KbArticleRow): KbArticle {
    return { id: row.id, tenantId: row.tenant_id as KbArticle['tenantId'], title: row.title, body: row.body,
        status: row.status as KbArticleStatus, sourceKind: row.source_kind as KbArticle['sourceKind'],
        visibility: row.visibility as KbVisibility, provenanceJson: row.provenance_json, sourceKey: row.source_key,
        createdAt: row.created_at, updatedAt: row.updated_at, revisionId: row.draft_revision_id,
        publishedRevisionId: row.published_revision_id, publicationVersion: row.revision_version,
        removalCandidate: Boolean(row.removal_candidate) };
}
export class PublishedKnowledgeConflict extends Error {
    constructor() { super('Knowledge revision changed; review the current revision before publishing'); }
}
export interface IngestCodegenArticleInput {
    /** Retained for host compatibility; all writes now preserve the published snapshot. */
    preserveActive?: boolean;
    tenantId: string;
    title: string;
    body: string;
    sourceKey: string;
    gitSha?: string;
    path?: string;
    sourceRevision?: string;
    provenance?: Record<string, unknown>;
    visibility?: KbVisibility;
    tablePrefix?: string;
    sourceKind?: "codegen" | "evolutionary" | "curated" | "code_research";
}
async function appendDraft(db: DbAdapter, prefix: string, existing: KbArticleRow, input: {
    title: string;
    body: string;
    visibility: KbVisibility;
    provenanceJson: string | null;
    sourceRevision?: string;
}) {
    const sourceRevision = input.sourceRevision ?? createHash('sha256').update(JSON.stringify([input.title, input.body, input.visibility])).digest('hex');
    if (existing.draft_revision_id) {
        const previous = await db.get<RevisionRow>(`SELECT * FROM ${prefix}kb_revisions WHERE id=? AND article_id=? AND tenant_id=?`, [existing.draft_revision_id, existing.id, existing.tenant_id]);
        if (previous && previous.title === input.title && previous.body === input.body && previous.visibility === input.visibility && previous.source_revision === sourceRevision && !existing.removal_candidate)
            return (await getKbArticle(db, existing.tenant_id, existing.id, prefix))!;
    }
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    await db.run(`INSERT INTO ${prefix}kb_revisions
    (id,article_id,tenant_id,title,body,visibility,provenance_json,source_revision,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [revisionId, existing.id, existing.tenant_id, input.title, input.body, input.visibility, input.provenanceJson,
        sourceRevision, now]);
    const changed = await db.run(`UPDATE ${prefix}kb_articles SET draft_revision_id=?,revision_version=revision_version+1,
    removal_candidate=0,updated_at=?,status=CASE WHEN status='deprecated' THEN 'draft' ELSE status END
    WHERE id=? AND tenant_id=? AND revision_version=?`, [revisionId, now, existing.id, existing.tenant_id, existing.revision_version]);
    if (changed.changes !== 1)
        throw new PublishedKnowledgeConflict();
    return (await getKbArticle(db, existing.tenant_id, existing.id, prefix))!;
}
/** Immutable imports never overwrite the approved snapshot. Host transactions make batches atomic. */
export async function ingestCodegenArticle(db: DbAdapter, input: IngestCodegenArticleInput): Promise<KbArticle> {
    const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
    const now = new Date().toISOString();
    const sourceKind = input.sourceKind ?? 'codegen';
    const visibility = input.visibility ?? 'agent';
    const sourceRevision = input.sourceRevision ?? input.gitSha ?? createHash('sha256').update(JSON.stringify([input.title, input.body, visibility])).digest('hex');
    const provenanceJson = JSON.stringify({ gitSha: input.gitSha ?? null, path: input.path ?? null, ingestedAt: now, ...input.provenance, sourceRevision });
    let existing = await db.get<KbArticleRow>(`SELECT * FROM ${prefix}kb_articles WHERE tenant_id=? AND source_kind=? AND source_key=?`, [input.tenantId, sourceKind, input.sourceKey]);
    if (!existing) {
        const id = randomUUID();
        await db.run(`INSERT INTO ${prefix}kb_articles (id,tenant_id,title,body,status,source_kind,visibility,provenance_json,source_key,created_at,updated_at)
      VALUES (?,?,?,?,'draft',?,?,?,?,?,?)`, [id, input.tenantId, input.title, input.body, sourceKind, visibility, provenanceJson, input.sourceKey, now, now]);
        existing = (await db.get<KbArticleRow>(`SELECT * FROM ${prefix}kb_articles WHERE id=? AND tenant_id=?`, [id, input.tenantId]))!;
    }
    const identical = await db.get<RevisionRow>(`SELECT * FROM ${prefix}kb_revisions WHERE tenant_id=? AND article_id=? AND source_revision=? AND title=? AND body=? AND visibility=?`, [input.tenantId, existing.id, sourceRevision, input.title, input.body, visibility]);
    if (identical && !existing.removal_candidate)
        return { ...(await getKbArticle(db, input.tenantId, existing.id, prefix))!, ingestedRevisionId: identical.id };
    const draft = await appendDraft(db, prefix, existing, { title: input.title, body: input.body, visibility, provenanceJson, ...((input.sourceRevision ?? input.gitSha) ? { sourceRevision: input.sourceRevision ?? input.gitSha! } : {}) });
    return { ...draft, ingestedRevisionId: draft.revisionId! };
}
export interface PromoteKbOptions {
    visibility?: KbVisibility;
    revisionId?: string | null | undefined;
    expectedPublishedRevisionId?: string | null;
    expectedDraftRevisionId?: string | null | undefined;
}
export async function promoteKbArticle(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string, opts?: PromoteKbOptions): Promise<KbArticle> {
    const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
    const existing = await db.get<KbArticleRow>(`SELECT * FROM ${prefix}kb_articles WHERE tenant_id=? AND id=?`, [tenantId, id]);
    if (!existing)
        throw new Error(`promoteKbArticle: article not found (${id})`);
    const revisionId = opts?.revisionId ?? existing.draft_revision_id;
    if (!revisionId || ((opts && 'expectedDraftRevisionId' in opts) ? opts.expectedDraftRevisionId !== existing.draft_revision_id : revisionId !== existing.draft_revision_id) || existing.removal_candidate)
        throw new PublishedKnowledgeConflict();
    if (opts && 'expectedPublishedRevisionId' in opts && opts.expectedPublishedRevisionId !== existing.published_revision_id)
        throw new PublishedKnowledgeConflict();
    const revision = await db.get<RevisionRow>(`SELECT * FROM ${prefix}kb_revisions WHERE id=? AND article_id=? AND tenant_id=?`, [revisionId, id, tenantId]);
    if (!revision)
        throw new PublishedKnowledgeConflict();
    // Changing visibility is itself a new reviewable revision. Legacy callers retain their
    // explicit promotion visibility, but central callers may only promote exact content.
    if (opts?.revisionId && opts.visibility && opts.visibility !== revision.visibility)
        throw new PublishedKnowledgeConflict();
    const publishRevision = revision;
    if (opts?.visibility && opts.visibility !== revision.visibility) {
        const draft = await appendDraft(db, prefix, existing, { title: revision.title, body: revision.body, visibility: opts.visibility, provenanceJson: revision.provenance_json });
        return promoteKbArticle(db, tenantId, id, prefix, { revisionId: draft.revisionId, expectedPublishedRevisionId: existing.published_revision_id });
    }
    const result = await db.run(`UPDATE ${prefix}kb_articles SET title=?,body=?,visibility=?,provenance_json=?,status='active',published_revision_id=?,revision_version=revision_version+1,updated_at=?
    WHERE tenant_id=? AND id=? AND draft_revision_id=? AND revision_version=?`, [publishRevision.title, publishRevision.body, publishRevision.visibility, publishRevision.provenance_json, revisionId, new Date().toISOString(), tenantId, id, existing.draft_revision_id, existing.revision_version]);
    if (result.changes !== 1)
        throw new PublishedKnowledgeConflict();
    return (await getKbArticle(db, tenantId, id, prefix))!;
}
export async function deprecateKbArticle(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string, opts?: {
    expectedPublishedRevisionId?: string | null;
    publicationVersion?: number;
}): Promise<KbArticle> {
    const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
    const existing = await db.get<KbArticleRow>(`SELECT * FROM ${prefix}kb_articles WHERE tenant_id=? AND id=?`, [tenantId, id]);
    if (!existing)
        throw new Error(`deprecateKbArticle: article not found (${id})`);
    if (opts && 'expectedPublishedRevisionId' in opts && opts.expectedPublishedRevisionId !== existing.published_revision_id)
        throw new PublishedKnowledgeConflict();
    if (opts?.publicationVersion !== undefined && opts.publicationVersion !== existing.revision_version)
        throw new PublishedKnowledgeConflict();
    const result = await db.run(`UPDATE ${prefix}kb_articles SET status='deprecated',published_revision_id=NULL,revision_version=revision_version+1,updated_at=? WHERE tenant_id=? AND id=? AND revision_version=?`, [new Date().toISOString(), tenantId, id, existing.revision_version]);
    if (result.changes !== 1)
        throw new PublishedKnowledgeConflict();
    return (await getKbArticle(db, tenantId, id, prefix))!;
}
export async function updateKbArticle(db: DbAdapter, tenantId: string, id: string, patch: {
    title?: string;
    body?: string;
    visibility?: KbVisibility;
}, tablePrefix?: string, _options?: {
    preserveActive?: boolean;
}): Promise<KbArticle> {
    const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
    const existing = await db.get<KbArticleRow>(`SELECT * FROM ${prefix}kb_operator_articles WHERE tenant_id=? AND id=?`, [tenantId, id]);
    if (!existing)
        throw new Error(`updateKbArticle: not found (${id})`);
    return appendDraft(db, prefix, existing, { title: patch.title ?? existing.title, body: patch.body ?? existing.body, visibility: patch.visibility ?? existing.visibility as KbVisibility, provenanceJson: existing.provenance_json });
}
export async function listKbArticles(db: DbAdapter, tenantId: string, opts?: {
    status?: KbArticleStatus;
    sourceKind?: string;
    limit?: number;
    tablePrefix?: string;
}): Promise<KbArticle[]> {
    const prefix = opts?.tablePrefix ?? DEFAULT_TABLE_PREFIX;
    const clauses = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];
    if (opts?.status) {
        clauses.push('status = ?');
        params.push(opts.status);
    }
    if (opts?.sourceKind) {
        clauses.push('source_kind = ?');
        params.push(opts.sourceKind);
    }
    params.push(opts?.limit ?? 100);
    return (await db.all<KbArticleRow>(`SELECT * FROM ${prefix}kb_operator_articles WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`, params)).map(mapKbArticle);
}
export async function getKbArticle(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string): Promise<KbArticle | undefined> {
    const row = await db.get<KbArticleRow>(`SELECT * FROM ${tablePrefix ?? DEFAULT_TABLE_PREFIX}kb_operator_articles WHERE tenant_id=? AND id=?`, [tenantId, id]);
    return row ? mapKbArticle(row) : undefined;
}
/** Full immutable history, scoped to the article's business. */
export async function listKbRevisions(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string): Promise<KbArticle[]> {
    const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
    const article = await db.get<KbArticleRow>(`SELECT * FROM ${prefix}kb_articles WHERE tenant_id=? AND id=?`, [tenantId, id]);
    if (!article)
        return [];
    const revisions = await db.all<RevisionRow & {
        created_at: string;
    }>(`SELECT * FROM ${prefix}kb_revisions WHERE tenant_id=? AND article_id=? ORDER BY created_at DESC,id DESC`, [tenantId, id]);
    return revisions.map(revision => ({ ...mapKbArticle(article), title: revision.title, body: revision.body, visibility: revision.visibility,
        provenanceJson: revision.provenance_json, revisionId: revision.id, createdAt: revision.created_at,
        status: revision.id === article.published_revision_id ? 'active' : 'draft' }));
}
export interface IngestFromChangelogOptions {
    preserveActive?: boolean;
    gitSha?: string;
    tablePrefix?: string;
}
function slugifyHeading(heading: string): string {
    return heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}
export async function ingestFromChangelog(db: DbAdapter, tenantId: string, changelogText: string, opts?: IngestFromChangelogOptions): Promise<KbArticle[]> {
    const sections = changelogText.split(/\n(?=##\s)/);
    const articles: KbArticle[] = [];
    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed)
            continue;
        const match = trimmed.match(/^##\s+(.+?)(?:\n|$)/);
        if (!match)
            continue;
        const heading = match[1]!.trim();
        const sourceKey = `changelog:${slugifyHeading(heading)}`;
        const ingestInput: IngestCodegenArticleInput = {
            tenantId,
            title: heading,
            body: trimmed,
            sourceKey,
        };
        if (opts?.preserveActive)
            ingestInput.preserveActive = true;
        if (opts?.gitSha)
            ingestInput.gitSha = opts.gitSha;
        if (opts?.tablePrefix)
            ingestInput.tablePrefix = opts.tablePrefix;
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
export async function ingestDocsSources(db: DbAdapter, tenantId: string, sources: IngestDocSource[], opts?: {
    gitSha?: string;
    sourceRevision?: string;
    tablePrefix?: string;
    preserveActive?: boolean;
    completeSnapshot?: boolean;
    visibility?: KbVisibility;
}): Promise<KbArticle[]> {
    const articles: KbArticle[] = [];
    for (const src of sources) {
        const sourceKey = `docs:${src.path.replace(/^\/+/, "")}`;
        const title = src.title ??
            src.path.split("/").pop()?.replace(/\.md$/i, "") ??
            src.path;
        const ingestInput: IngestCodegenArticleInput = {
            tenantId,
            title,
            body: src.body,
            sourceKey,
            path: src.path,
            ...(opts?.visibility ? { visibility: opts.visibility } : {}),
        };
        if (opts?.preserveActive)
            ingestInput.preserveActive = true;
        if (opts?.gitSha)
            ingestInput.gitSha = opts.gitSha;
        if (opts?.sourceRevision)
            ingestInput.sourceRevision = opts.sourceRevision;
        if (opts?.tablePrefix)
            ingestInput.tablePrefix = opts.tablePrefix;
        articles.push(await ingestCodegenArticle(db, ingestInput));
    }
    if (opts?.completeSnapshot) {
        const prefix = opts.tablePrefix ?? DEFAULT_TABLE_PREFIX;
        const present = new Set(sources.map(source => `docs:${source.path.replace(/^\/+/, "")}`));
        const existing = await db.all<{
            id: string;
            source_key: string;
        }>(`SELECT id,source_key FROM ${prefix}kb_articles WHERE tenant_id=? AND source_kind='codegen' AND source_key LIKE 'docs:%'`, [tenantId]);
        for (const row of existing)
            if (!present.has(row.source_key))
                await db.run(`UPDATE ${prefix}kb_articles SET removal_candidate=1,revision_version=revision_version+1,updated_at=? WHERE id=? AND tenant_id=? AND removal_candidate=0`, [new Date().toISOString(), row.id, tenantId]);
    }
    return articles;
}
