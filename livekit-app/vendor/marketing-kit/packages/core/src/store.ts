import { randomBytes, randomUUID } from "node:crypto";
import type {
  ArtworkMode,
  BlogFaqItem,
  CopilotIdeaAction,
  CopilotMessage,
  EmailCampaign,
  EmailLayout,
  MarketingArtworkAsset,
  MarketingOverview,
  MarketingPost,
  MarketingPostRevision,
  StudioCardSpec,
} from "@rhule/marketing-shared";
import type { MarketingDbAdapter } from "./schema.js";

type Row = Record<string, any>;

export const nowIso = (): string => new Date().toISOString();
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const newToken = (): string => randomBytes(24).toString("base64url");

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function slugify(raw: string): string {
  return (
    String(raw || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .replace(/-+$/g, "") || "post"
  );
}

export function rowToPost(r: Row): MarketingPost {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    title: r.title,
    kicker: r.kicker,
    excerpt: r.excerpt,
    bodyMarkdown: r.body_markdown,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    targetKeywords: parseJson<string[]>(r.target_keywords_json, []),
    readingTimeMinutes: Number(r.reading_time_minutes) || 3,
    audience: r.audience,
    ctaLabel: r.cta_label,
    ctaUrl: r.cta_url,
    faqItems: parseJson<BlogFaqItem[]>(r.faq_items_json, []),
    artworkMode: r.artwork_mode,
    artworkPrompt: r.artwork_prompt,
    artworkStatus: r.artwork_status,
    heroImageUrl: r.hero_image_url || null,
    studioCardSpec: parseJson<StudioCardSpec | null>(r.studio_card_spec_json, null),
    status: r.status,
    sourceTopic: r.source_topic || "",
    generationError: r.generation_error || null,
    authorName: r.author_name,
    publishedAt: r.published_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToCampaign(r: Row): EmailCampaign {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    segmentId: r.segment_id,
    segmentFilter: parseJson<Record<string, unknown> | null>(r.segment_filter_json, null),
    goal: r.goal,
    layout: (r.layout || "editorial") as EmailLayout,
    subject: r.subject,
    preheader: r.preheader,
    headline: r.headline,
    bodyHtml: r.body_html,
    bodyMarkdown: r.body_markdown,
    ctaLabel: r.cta_label,
    ctaUrl: r.cta_url,
    artworkPrompt: r.artwork_prompt,
    artworkStatus: r.artwork_status,
    artworkMode: (r.artwork_mode || "ai_illustration") as ArtworkMode,
    studioCardSpec: parseJson<StudioCardSpec | null>(r.studio_card_spec_json, null),
    bannerImageUrl: r.banner_image_url || null,
    status: r.status,
    lastError: r.last_error || null,
    recipientCount: Number(r.recipient_count) || 0,
    sentCount: Number(r.sent_count) || 0,
    deliveredCount: Number(r.delivered_count) || 0,
    openedCount: Number(r.opened_count) || 0,
    clickedCount: Number(r.clicked_count) || 0,
    bouncedCount: Number(r.bounced_count) || 0,
    unsubscribedCount: Number(r.unsubscribed_count) || 0,
    scheduledAt: r.scheduled_at || null,
    sentAt: r.sent_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToAsset(r: Row): MarketingArtworkAsset {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    targetType: r.target_type,
    targetId: r.target_id,
    mode: r.mode,
    prompt: r.prompt,
    customInstruction: r.custom_instruction || null,
    imageUrl: r.image_url,
    studioCardSpec: parseJson<StudioCardSpec | null>(r.studio_card_spec_json, null),
    status: r.status,
    createdAt: r.created_at,
  };
}

function rowToMessage(r: Row): CopilotMessage {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    role: r.role,
    content: r.content,
    suggestedActions: parseJson<CopilotIdeaAction[] | undefined>(r.suggested_actions_json, undefined),
    codebaseSources: parseJson<string[] | undefined>(r.codebase_sources_json, undefined),
    createdAt: r.created_at,
  };
}

const POST_COLUMNS: Record<string, string> = {
  slug: "slug",
  title: "title",
  kicker: "kicker",
  excerpt: "excerpt",
  bodyMarkdown: "body_markdown",
  seoTitle: "seo_title",
  seoDescription: "seo_description",
  targetKeywords: "target_keywords_json",
  readingTimeMinutes: "reading_time_minutes",
  audience: "audience",
  ctaLabel: "cta_label",
  ctaUrl: "cta_url",
  faqItems: "faq_items_json",
  artworkMode: "artwork_mode",
  artworkPrompt: "artwork_prompt",
  artworkStatus: "artwork_status",
  heroImageUrl: "hero_image_url",
  studioCardSpec: "studio_card_spec_json",
  status: "status",
  sourceTopic: "source_topic",
  generationError: "generation_error",
  authorName: "author_name",
  publishedAt: "published_at",
};

const CAMPAIGN_COLUMNS: Record<string, string> = {
  name: "name",
  segmentId: "segment_id",
  segmentFilter: "segment_filter_json",
  goal: "goal",
  layout: "layout",
  subject: "subject",
  preheader: "preheader",
  headline: "headline",
  bodyHtml: "body_html",
  bodyMarkdown: "body_markdown",
  ctaLabel: "cta_label",
  ctaUrl: "cta_url",
  artworkPrompt: "artwork_prompt",
  artworkStatus: "artwork_status",
  artworkMode: "artwork_mode",
  studioCardSpec: "studio_card_spec_json",
  bannerImageUrl: "banner_image_url",
  status: "status",
  lastError: "last_error",
  recipientCount: "recipient_count",
  sentCount: "sent_count",
  scheduledAt: "scheduled_at",
  sentAt: "sent_at",
};

const JSON_FIELDS = new Set(["targetKeywords", "faqItems", "studioCardSpec", "segmentFilter"]);

function buildUpdate(map: Record<string, string>, patch: Record<string, unknown>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(map)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    sets.push(`${col} = ?`);
    params.push(JSON_FIELDS.has(key) ? (v === null || v === undefined ? null : JSON.stringify(v)) : v ?? null);
  }
  return { sets, params };
}

export function estimateReadingTime(markdown: string): number {
  const words = String(markdown || "").split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 220));
}

export class MarketingStore {
  constructor(
    private readonly db: MarketingDbAdapter,
    private readonly p = "mkt_",
  ) {}

  private tenantClause(tenantId: string, col = "tenant_id"): { sql: string; params: unknown[] } {
    return tenantId === "all" ? { sql: "1=1", params: [] } : { sql: `${col} = ?`, params: [tenantId] };
  }

  // ---------- posts ----------

  async uniqueSlug(tenantId: string, base: string, excludeId?: string): Promise<string> {
    let root = slugify(base);
    if (["posts", "jobs", "ideas", "generate-batch"].includes(root)) root = `${root}-guide`;
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const row = await this.db.get<Row>(
        `SELECT id FROM ${this.p}posts WHERE tenant_id = ? AND slug = ?`,
        [tenantId, candidate],
      );
      if (!row || row.id === excludeId) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  async createPost(tenantId: string, input: Partial<MarketingPost> & { title: string }): Promise<MarketingPost> {
    const id = input.id || newId("post");
    const ts = nowIso();
    const slug = await this.uniqueSlug(tenantId, input.slug || input.title);
    await this.db.run(
      `INSERT INTO ${this.p}posts (id, tenant_id, slug, title, kicker, excerpt, body_markdown, seo_title, seo_description,
        target_keywords_json, reading_time_minutes, audience, cta_label, cta_url, faq_items_json, artwork_mode, artwork_prompt,
        artwork_status, hero_image_url, studio_card_spec_json, status, source_topic, generation_error, author_name, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        slug,
        input.title,
        input.kicker || "Practice Note",
        input.excerpt || "",
        input.bodyMarkdown || "",
        input.seoTitle || input.title,
        input.seoDescription || input.excerpt || "",
        JSON.stringify(input.targetKeywords || []),
        input.readingTimeMinutes || estimateReadingTime(input.bodyMarkdown || ""),
        input.audience || "general",
        input.ctaLabel || "Start your first matter free",
        input.ctaUrl || "/auth?mode=register",
        JSON.stringify(input.faqItems || []),
        input.artworkMode || "ai_illustration",
        input.artworkPrompt || "",
        input.artworkStatus || "draft",
        input.heroImageUrl || null,
        input.studioCardSpec ? JSON.stringify(input.studioCardSpec) : null,
        input.status || "draft",
        input.sourceTopic || input.title,
        input.generationError || null,
        input.authorName || "Editorial Team",
        input.publishedAt || null,
        input.createdAt || ts,
        ts,
      ],
    );
    return (await this.getPost(tenantId, id))!;
  }

  async getPost(tenantId: string, id: string): Promise<MarketingPost | null> {
    const t = this.tenantClause(tenantId);
    const row = await this.db.get<Row>(`SELECT * FROM ${this.p}posts WHERE id = ? AND ${t.sql}`, [id, ...t.params]);
    return row ? rowToPost(row) : null;
  }

  async getPostBySlug(tenantId: string, slug: string): Promise<MarketingPost | null> {
    const row = await this.db.get<Row>(`SELECT * FROM ${this.p}posts WHERE tenant_id = ? AND slug = ?`, [tenantId, slug]);
    return row ? rowToPost(row) : null;
  }

  async listPosts(tenantId: string, opts: { status?: string; limit?: number } = {}): Promise<MarketingPost[]> {
    const t = this.tenantClause(tenantId);
    const params: unknown[] = [...t.params];
    let where = t.sql;
    if (opts.status) {
      where += " AND status = ?";
      params.push(opts.status);
    } else {
      where += " AND status <> 'archived'";
    }
    params.push(Math.min(Math.max(opts.limit || 100, 1), 500));
    const rows = await this.db.all<Row>(
      `SELECT * FROM ${this.p}posts WHERE ${where} ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?`,
      params,
    );
    return rows.map(rowToPost);
  }

  async listPublishedPosts(tenantId: string, limit = 200): Promise<MarketingPost[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM ${this.p}posts WHERE tenant_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT ?`,
      [tenantId, limit],
    );
    return rows.map(rowToPost);
  }

  /** Drafts left in `generating` by a crashed or restarted process become editable drafts again. */
  async recoverStaleGenerating(updatedBefore: string, excludeIds: string[] = []): Promise<number> {
    const exclude = excludeIds.length ? ` AND id NOT IN (${excludeIds.map(() => "?").join(", ")})` : "";
    const result = await this.db.run(
      `UPDATE ${this.p}posts SET status = 'draft', generation_error = ?, updated_at = ?
       WHERE status = 'generating' AND updated_at < ?${exclude}`,
      ["Generation was interrupted. Use Regenerate to try again.", nowIso(), updatedBefore, ...excludeIds],
    );
    return result.changes;
  }

  async updatePost(tenantId: string, id: string, patch: Partial<MarketingPost>): Promise<MarketingPost | null> {
    const { sets, params } = buildUpdate(POST_COLUMNS, patch as Record<string, unknown>);
    if (sets.length === 0) return this.getPost(tenantId, id);
    sets.push("updated_at = ?");
    params.push(nowIso());
    const t = this.tenantClause(tenantId);
    await this.db.run(`UPDATE ${this.p}posts SET ${sets.join(", ")} WHERE id = ? AND ${t.sql}`, [...params, id, ...t.params]);
    return this.getPost(tenantId, id);
  }

  async addRevision(post: MarketingPost, instruction: string): Promise<void> {
    await this.db.run(
      `INSERT INTO ${this.p}post_revisions (id, post_id, tenant_id, instruction, title, excerpt, body_markdown, seo_title, seo_description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId("rev"), post.id, post.tenantId, instruction, post.title, post.excerpt, post.bodyMarkdown, post.seoTitle, post.seoDescription, nowIso()],
    );
  }

  async listRevisions(postId: string): Promise<MarketingPostRevision[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM ${this.p}post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT 25`,
      [postId],
    );
    return rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      tenantId: r.tenant_id,
      instruction: r.instruction,
      title: r.title,
      excerpt: r.excerpt,
      bodyMarkdown: r.body_markdown,
      seoTitle: r.seo_title,
      seoDescription: r.seo_description,
      createdAt: r.created_at,
    }));
  }

  async getRevision(postId: string, revisionId: string): Promise<MarketingPostRevision | null> {
    const list = await this.listRevisions(postId);
    return list.find((r) => r.id === revisionId) || null;
  }

  // ---------- assets ----------

  async createAsset(input: {
    tenantId: string;
    targetType: "blog" | "email";
    targetId: string;
    mode: ArtworkMode;
    prompt: string;
    customInstruction?: string | null;
    imageUrl: string;
    contentType: string;
    data: Buffer | null;
    studioCardSpec?: StudioCardSpec | null;
    id?: string;
  }): Promise<MarketingArtworkAsset> {
    const id = input.id || newId("asset");
    await this.db.run(
      `INSERT INTO ${this.p}assets (id, tenant_id, target_type, target_id, mode, prompt, custom_instruction, image_url, content_type, data_base64, studio_card_spec_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        id,
        input.tenantId,
        input.targetType,
        input.targetId,
        input.mode,
        input.prompt,
        input.customInstruction || null,
        input.imageUrl,
        input.contentType,
        input.data ? input.data.toString("base64") : null,
        input.studioCardSpec ? JSON.stringify(input.studioCardSpec) : null,
        nowIso(),
      ],
    );
    const row = await this.db.get<Row>(`SELECT * FROM ${this.p}assets WHERE id = ?`, [id]);
    return rowToAsset(row!);
  }

  async listAssets(targetType: string, targetId: string): Promise<MarketingArtworkAsset[]> {
    const rows = await this.db.all<Row>(
      `SELECT id, tenant_id, target_type, target_id, mode, prompt, custom_instruction, image_url, studio_card_spec_json, status, created_at
       FROM ${this.p}assets WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT 12`,
      [targetType, targetId],
    );
    return rows.map(rowToAsset);
  }

  async getAssetBinary(id: string): Promise<{ contentType: string; data: Buffer } | null> {
    const row = await this.db.get<Row>(`SELECT content_type, data_base64 FROM ${this.p}assets WHERE id = ?`, [id]);
    if (!row || !row.data_base64) return null;
    return { contentType: row.content_type || "image/png", data: Buffer.from(String(row.data_base64), "base64") };
  }

  async approveLatestAsset(targetType: string, targetId: string): Promise<void> {
    const latest = await this.db.get<Row>(
      `SELECT id FROM ${this.p}assets WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1`,
      [targetType, targetId],
    );
    if (latest) await this.db.run(`UPDATE ${this.p}assets SET status = 'approved' WHERE id = ?`, [latest.id]);
  }

  // ---------- campaigns ----------

  async createCampaign(tenantId: string, input: Partial<EmailCampaign> & { subject: string; segmentId: string }): Promise<EmailCampaign> {
    const id = newId("camp");
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO ${this.p}campaigns (id, tenant_id, name, segment_id, segment_filter_json, goal, layout, subject, preheader, headline,
        body_html, body_markdown, cta_label, cta_url, artwork_prompt, artwork_status, artwork_mode, studio_card_spec_json, banner_image_url,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        tenantId,
        input.name || input.subject,
        input.segmentId,
        input.segmentFilter ? JSON.stringify(input.segmentFilter) : null,
        input.goal || "",
        input.layout || "editorial",
        input.subject,
        input.preheader || "",
        input.headline || input.subject,
        input.bodyHtml || "",
        input.bodyMarkdown || "",
        input.ctaLabel || "Open your workspace",
        input.ctaUrl || "/",
        input.artworkPrompt || "",
        input.artworkStatus || "draft",
        input.artworkMode || "ai_illustration",
        input.studioCardSpec ? JSON.stringify(input.studioCardSpec) : null,
        input.bannerImageUrl || null,
        ts,
        ts,
      ],
    );
    return (await this.getCampaign(tenantId, id))!;
  }

  async getCampaign(tenantId: string, id: string): Promise<EmailCampaign | null> {
    const t = this.tenantClause(tenantId);
    const row = await this.db.get<Row>(`SELECT * FROM ${this.p}campaigns WHERE id = ? AND ${t.sql}`, [id, ...t.params]);
    return row ? rowToCampaign(row) : null;
  }

  async listCampaigns(tenantId: string, limit = 100): Promise<EmailCampaign[]> {
    const t = this.tenantClause(tenantId);
    const rows = await this.db.all<Row>(
      `SELECT * FROM ${this.p}campaigns WHERE ${t.sql} ORDER BY created_at DESC LIMIT ?`,
      [...t.params, limit],
    );
    return rows.map(rowToCampaign);
  }

  async listDueCampaigns(): Promise<EmailCampaign[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM ${this.p}campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 10`,
      [nowIso()],
    );
    return rows.map(rowToCampaign);
  }

  async updateCampaign(tenantId: string, id: string, patch: Partial<EmailCampaign>): Promise<EmailCampaign | null> {
    const { sets, params } = buildUpdate(CAMPAIGN_COLUMNS, patch as Record<string, unknown>);
    if (sets.length === 0) return this.getCampaign(tenantId, id);
    sets.push("updated_at = ?");
    params.push(nowIso());
    const t = this.tenantClause(tenantId);
    await this.db.run(`UPDATE ${this.p}campaigns SET ${sets.join(", ")} WHERE id = ? AND ${t.sql}`, [...params, id, ...t.params]);
    return this.getCampaign(tenantId, id);
  }

  /** Atomically moves a campaign into `sending`; returns false when another worker already claimed it. */
  async claimCampaignForSend(id: string, fromStatuses: string[]): Promise<boolean> {
    const placeholders = fromStatuses.map(() => "?").join(", ");
    const res = await this.db.run(
      `UPDATE ${this.p}campaigns SET status = 'sending', updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
      [nowIso(), id, ...fromStatuses],
    );
    return res.changes > 0;
  }

  async addRecipient(input: {
    campaignId: string;
    tenantId: string;
    email: string;
    contactName?: string | null;
    providerMessageId?: string | null;
    status: string;
  }): Promise<void> {
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO ${this.p}campaign_recipients (id, campaign_id, tenant_id, email, contact_name, provider_message_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId("rcpt"), input.campaignId, input.tenantId, input.email, input.contactName || null, input.providerMessageId || null, input.status, ts, ts],
    );
  }

  async prepareRecipient(campaignId: string, tenantId: string, email: string, name: string): Promise<boolean> {
    const existing = await this.db.get<Row>(`SELECT status FROM ${this.p}campaign_recipients WHERE campaign_id=? AND email=?`, [campaignId,email]);
    if (existing) return existing.status === 'queued';
    await this.addRecipient({campaignId,tenantId,email,contactName:name,status:'queued'});
    return true;
  }

  async transitionRecipient(campaignId:string,email:string,status:string,providerMessageId:string|null=null):Promise<void> {
    await this.db.run(`UPDATE ${this.p}campaign_recipients SET status=?,provider_message_id=COALESCE(?,provider_message_id),updated_at=? WHERE campaign_id=? AND email=? AND status IN ('queued','dispatching')`,[status,providerMessageId,nowIso(),campaignId,email]);
  }

  async recipientProgress(campaignId:string):Promise<{recipientCount:number;sentCount:number}> {
    const row=await this.db.get<Row>(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('sent','delivered','bounced','complained') THEN 1 ELSE 0 END) AS sent FROM ${this.p}campaign_recipients WHERE campaign_id=?`,[campaignId]);
    return {recipientCount:Number(row?.total||0),sentCount:Number(row?.sent||0)};
  }

  async listRecipients(campaignId: string, limit = 200): Promise<Row[]> {
    return this.db.all<Row>(
      `SELECT email, contact_name, provider_message_id, status, opened_at, clicked_at, bounced_at, unsubscribed_at, created_at
       FROM ${this.p}campaign_recipients WHERE campaign_id = ? ORDER BY created_at ASC LIMIT ?`,
      [campaignId, limit],
    );
  }

  /**
   * Applies a provider event to the recipient row and bumps the campaign counter only on the first
   * occurrence of each event type, so webhook retries stay idempotent.
   */
  async applyDeliveryEvent(providerMessageId: string, event: "delivered" | "opened" | "clicked" | "bounced" | "complained"): Promise<boolean> {
    const rcpt = await this.db.get<Row>(
      `SELECT id, campaign_id, status, opened_at, clicked_at, bounced_at FROM ${this.p}campaign_recipients WHERE provider_message_id = ?`,
      [providerMessageId],
    );
    if (!rcpt) return false;
    const ts = nowIso();
    const campaignCol: Record<string, string> = {
      delivered: "delivered_count",
      opened: "opened_count",
      clicked: "clicked_count",
      bounced: "bounced_count",
      complained: "unsubscribed_count",
    };
    let firstTime = false;
    if (event === "delivered") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET status = 'delivered', updated_at = ? WHERE id = ? AND status IN ('sent', 'queued')`,
        [ts, rcpt.id],
      );
      firstTime = r.changes > 0;
    } else if (event === "opened") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET opened_at = ?, updated_at = ? WHERE id = ? AND opened_at IS NULL`,
        [ts, ts, rcpt.id],
      );
      firstTime = r.changes > 0;
    } else if (event === "clicked") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET clicked_at = ?, updated_at = ? WHERE id = ? AND clicked_at IS NULL`,
        [ts, ts, rcpt.id],
      );
      firstTime = r.changes > 0;
    } else if (event === "bounced") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET status = 'bounced', bounced_at = ?, updated_at = ? WHERE id = ? AND bounced_at IS NULL`,
        [ts, ts, rcpt.id],
      );
      firstTime = r.changes > 0;
    } else if (event === "complained") {
      const r = await this.db.run(
        `UPDATE ${this.p}campaign_recipients SET status = 'complained', unsubscribed_at = ?, updated_at = ? WHERE id = ? AND unsubscribed_at IS NULL`,
        [ts, ts, rcpt.id],
      );
      firstTime = r.changes > 0;
    }
    if (firstTime) {
      const col = campaignCol[event];
      await this.db.run(`UPDATE ${this.p}campaigns SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`, [ts, rcpt.campaign_id]);
    }
    return firstTime;
  }

  async markRecipientUnsubscribed(campaignId: string, email: string): Promise<void> {
    const ts = nowIso();
    const r = await this.db.run(
      `UPDATE ${this.p}campaign_recipients SET unsubscribed_at = ?, updated_at = ? WHERE campaign_id = ? AND email = ? AND unsubscribed_at IS NULL`,
      [ts, ts, campaignId, email.trim().toLowerCase()],
    );
    if (r.changes > 0) {
      await this.db.run(`UPDATE ${this.p}campaigns SET unsubscribed_count = unsubscribed_count + 1, updated_at = ? WHERE id = ?`, [ts, campaignId]);
    }
  }

  async recipientEmailForMessage(providerMessageId: string): Promise<{ email: string; tenantId: string } | null> {
    const r = await this.db.get<Row>(
      `SELECT email, tenant_id FROM ${this.p}campaign_recipients WHERE provider_message_id = ?`,
      [providerMessageId],
    );
    return r ? { email: r.email, tenantId: r.tenant_id } : null;
  }

  // ---------- subscribers / suppression ----------

  async ensureSubscriber(tenantId: string, email: string, name: string | null, source: string, optIn = false): Promise<{ token: string; unsubscribed: boolean }> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.db.get<Row>(
      `SELECT unsubscribe_token, unsubscribed_at, marketing_opt_in, source FROM ${this.p}subscribers WHERE tenant_id = ? AND email = ?`,
      [tenantId, normalized],
    );
    if (existing) {
      if (optIn && source !== "account" && existing.source === "account") {
        await this.db.run(`UPDATE ${this.p}subscribers SET source = ?, updated_at = ? WHERE tenant_id = ? AND email = ?`, [source, nowIso(), tenantId, normalized]);
      }
      return { token: existing.unsubscribe_token, unsubscribed: Boolean(existing.unsubscribed_at) };
    }
    const token = newToken();
    const ts = nowIso();
    await this.db.run(
      `INSERT INTO ${this.p}subscribers (id, tenant_id, email, name, source, marketing_opt_in, unsubscribe_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [newId("sub"), tenantId, normalized, name, source, optIn ? 1 : 0, token, ts, ts],
    );
    const row = await this.db.get<Row>(
      `SELECT unsubscribe_token, unsubscribed_at FROM ${this.p}subscribers WHERE tenant_id = ? AND email = ?`,
      [tenantId, normalized],
    );
    return { token: row?.unsubscribe_token || token, unsubscribed: Boolean(row?.unsubscribed_at) };
  }

  async resubscribe(tenantId: string, email: string): Promise<void> {
    await this.db.run(
      `UPDATE ${this.p}subscribers SET marketing_opt_in = 1, unsubscribed_at = NULL, updated_at = ? WHERE tenant_id = ? AND email = ? AND source <> 'provider_suppression'`,
      [nowIso(), tenantId, email.trim().toLowerCase()],
    );
  }

  async unsubscribeByToken(token: string): Promise<{ email: string; tenantId: string } | null> {
    const row = await this.db.get<Row>(`SELECT email, tenant_id, unsubscribed_at FROM ${this.p}subscribers WHERE unsubscribe_token = ?`, [token]);
    if (!row) return null;
    if (!row.unsubscribed_at) {
      await this.db.run(
        `UPDATE ${this.p}subscribers SET marketing_opt_in = 0, unsubscribed_at = ?, updated_at = ? WHERE unsubscribe_token = ?`,
        [nowIso(), nowIso(), token],
      );
    }
    return { email: row.email, tenantId: row.tenant_id };
  }

  async suppressEmail(tenantId: string, email: string): Promise<void> {
    await this.ensureSubscriber(tenantId, email, null, "account", false);
    await this.db.run(
      `UPDATE ${this.p}subscribers SET source = 'provider_suppression', marketing_opt_in = 0, unsubscribed_at = COALESCE(unsubscribed_at, ?), updated_at = ? WHERE tenant_id = ? AND email = ?`,
      [nowIso(), nowIso(), tenantId, email.trim().toLowerCase()],
    );
  }

  async suppressedEmails(tenantId: string): Promise<Set<string>> {
    const rows = await this.db.all<Row>(
      `SELECT email FROM ${this.p}subscribers WHERE tenant_id = ? AND unsubscribed_at IS NOT NULL`,
      [tenantId],
    );
    return new Set(rows.map((r) => String(r.email).toLowerCase()));
  }

  async listBlogSubscribers(tenantId: string): Promise<Row[]> {
    return this.db.all<Row>(
      `SELECT id, email, name, unsubscribe_token FROM ${this.p}subscribers
       WHERE tenant_id = ? AND source <> 'account' AND marketing_opt_in = 1 AND unsubscribed_at IS NULL ORDER BY created_at ASC`,
      [tenantId],
    );
  }

  // ---------- copilot ----------

  async addMessage(tenantId: string, role: "user" | "assistant", content: string, extra: { actions?: CopilotIdeaAction[]; sources?: string[] } = {}): Promise<CopilotMessage> {
    const id = newId("msg");
    await this.db.run(
      `INSERT INTO ${this.p}copilot_messages (id, tenant_id, role, content, suggested_actions_json, codebase_sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, role, content, extra.actions ? JSON.stringify(extra.actions) : null, extra.sources ? JSON.stringify(extra.sources) : null, nowIso()],
    );
    return { id, tenantId, role, content, suggestedActions: extra.actions, codebaseSources: extra.sources, createdAt: nowIso() };
  }

  async listMessages(tenantId: string, limit = 60): Promise<CopilotMessage[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM ${this.p}copilot_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
      [tenantId, limit],
    );
    return rows.map(rowToMessage).reverse();
  }

  async clearMessages(tenantId: string): Promise<void> {
    await this.db.run(`DELETE FROM ${this.p}copilot_messages WHERE tenant_id = ?`, [tenantId]);
  }

  // ---------- analytics ----------

  async overview(tenantId: string): Promise<MarketingOverview> {
    const t = this.tenantClause(tenantId);
    const statusRows = await this.db.all<Row>(
      `SELECT status, COUNT(*) AS n FROM ${this.p}posts WHERE ${t.sql} GROUP BY status`,
      t.params,
    );
    const posts: Record<string, number> = {};
    for (const r of statusRows) posts[String(r.status)] = Number(r.n) || 0;
    const agg =
      (await this.db.get<Row>(
        `SELECT COUNT(*) AS campaigns, COALESCE(SUM(sent_count),0) AS sent, COALESCE(SUM(delivered_count),0) AS delivered,
          COALESCE(SUM(opened_count),0) AS opened, COALESCE(SUM(clicked_count),0) AS clicked, COALESCE(SUM(bounced_count),0) AS bounced,
          COALESCE(SUM(unsubscribed_count),0) AS unsubscribed, MAX(sent_at) AS last_sent
         FROM ${this.p}campaigns WHERE ${t.sql}`,
        t.params,
      )) || {};
    const subs = await this.db.get<Row>(
      `SELECT COUNT(*) AS n FROM ${this.p}subscribers WHERE ${t.sql} AND source <> 'account' AND unsubscribed_at IS NULL`,
      t.params,
    );
    const lastPub = await this.db.get<Row>(
      `SELECT MAX(published_at) AS p FROM ${this.p}posts WHERE ${t.sql} AND status = 'published'`,
      t.params,
    );
    const sent = Number(agg.sent) || 0;
    const delivered = Number(agg.delivered) || 0;
    const base = delivered || sent;
    return {
      tenantId,
      posts,
      publishedPosts: posts.published || 0,
      campaigns: Number(agg.campaigns) || 0,
      emailsSent: sent,
      delivered,
      opened: Number(agg.opened) || 0,
      clicked: Number(agg.clicked) || 0,
      bounced: Number(agg.bounced) || 0,
      unsubscribed: Number(agg.unsubscribed) || 0,
      openRate: base ? Number(agg.opened) / base : 0,
      clickRate: base ? Number(agg.clicked) / base : 0,
      subscribers: Number(subs?.n) || 0,
      lastCampaignAt: agg.last_sent || null,
      lastPublishedAt: lastPub?.p || null,
    };
  }
}
