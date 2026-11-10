import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AudienceSegmentInfo,
  BlogGenerationJob,
  EmailCampaign,
  EmailLayout,
  MarketingContact,
  MarketingPost,
  MarketingProductContextSnapshot,
  StudioCardSpec,
} from "@rhule/marketing-shared";
import { EmailLayoutSchema } from "@rhule/marketing-shared";
import type {
  CodebaseSearchHit,
  CreateMarketingRouterOptions,
  MarketingAuthUser,
  MarketingBrandConfig,
  MarketingCustomSegmentFilter,
  MarketingLlmAdapter,
} from "./adapters.js";
import { buildDefaultStudioCardSpec, renderEditorialSvgArtwork } from "./artwork.js";
import { buildResponsiveEmailHtml, interpolateEmailVariables } from "./emailRenderer.js";
import {
  generateBlogIdeas,
  generateEmailDraft,
  generateEmailIdeas,
  generatePostDraft,
  layoutFromInstruction,
  parseJsonLoose,
  refineEmailCopy,
  rewritePost,
  runCopilotTurn,
  splitSections,
} from "./generation.js";
import { ensureMarketingSchema } from "./schema.js";
import { renderPublicBlogIndexHtml, renderPublicBlogPostHtml, renderSitemapXml } from "./seoRenderer.js";
import { MarketingStore, newId, nowIso } from "./store.js";

type Req = any;
type Res = any;
type Next = (err?: unknown) => void;

interface RouteCtx {
  req: Req;
  res: Res;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  tenantId: string;
  brand: MarketingBrandConfig;
  user: MarketingAuthUser | null;
}

type Handler = (ctx: RouteCtx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public?: boolean;
  allowAllTenant?: boolean;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const KIT_SEGMENTS: AudienceSegmentInfo[] = [
  { id: "blog_subscribers", label: "Blog subscribers", description: "People who subscribed from the public journal.", count: 0 },
  { id: "custom", label: "Custom filter", description: "Build an ad-hoc audience from user type, plan, signup date, or email domain.", count: 0 },
];

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;

function compilePath(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/:([a-zA-Z]+)/g, (_m, k: string) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${src}/?$`), keys };
}

function sendJson(res: Res, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendText(res: Res, status: number, contentType: string, body: string | Buffer, cache = "no-store"): void {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", cache);
  res.end(body);
}

async function readRawBody(req: Req): Promise<Buffer> {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody);
  if (req.readableEnded || typeof req[Symbol.asyncIterator] !== "function") {
    if (Buffer.isBuffer(req.body)) return req.body;
    return Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 2_000_000) throw new HttpError(413, "Body too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: Req): Promise<any> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return {};
  if (req.readableEnded && !req.rawBody && typeof req.body !== "string") return {};
  const raw = await readRawBody(req);
  req.rawBody = raw;
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return {};
  }
}

function headerValue(req: Req, name: string): string {
  const v = req.headers?.[name.toLowerCase()];
  return Array.isArray(v) ? String(v[0] || "") : String(v || "");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verifies a Svix-signed webhook (the scheme Resend uses). */
export function verifySvixSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signatureHeader: string;
  payload: Buffer | string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  if (!input.secret || !input.id || !input.timestamp || !input.signatureHeader) return false;
  const ts = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (input.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret, "base64");
  const payload = typeof input.payload === "string" ? input.payload : input.payload.toString("utf8");
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${payload}`).digest("base64");
  return input.signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] || "")
    .some((sig) => sig && safeEqual(sig, expected));
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function escapeHtml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function simplePage(brand: MarketingBrandConfig, title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${escapeHtml(title)} · ${escapeHtml(brand.name)}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;">
<main style="max-width:520px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;">
<div style="font-family:Georgia,serif;font-weight:700;font-size:20px;margin-bottom:18px;">${escapeHtml(brand.name)}</div>
<h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 12px;">${escapeHtml(title)}</h1>${bodyHtml}
<p style="margin-top:24px"><a href="https://${escapeHtml(brand.domain)}/" style="color:#1d4ed8">Return to ${escapeHtml(brand.domain)}</a></p>
</main></body></html>`;
}

export interface MarketingKit {
  /** Mount at `mountPath` (e.g. `app.use("/marketing", kit.handler)`). */
  handler: (req: Req, res: Res, next?: Next) => Promise<void>;
  /** Public SSR pages for the host's primary tenant. Unknown or unpublished slugs get a 404 page. */
  publicHandlers: {
    blogIndex: (req: Req, res: Res, next?: Next) => Promise<void>;
    blogPost: (req: Req, res: Res, next?: Next) => Promise<void>;
    sitemap: (req: Req, res: Res, next?: Next) => Promise<void>;
  };
  store: MarketingStore;
  ensureSchema: () => Promise<void>;
  seedPosts: (tenantId: string, posts: Array<Partial<MarketingPost> & { title: string; slug: string }>) => Promise<number>;
  runScheduledWork: () => Promise<{ campaignsSent: number; postsPublished: number }>;
  startScheduler: (intervalMs?: number) => () => void;
}

export function createMarketingKit(opts: CreateMarketingRouterOptions): MarketingKit {
  const store = new MarketingStore(opts.db);
  const log = opts.logger || console;
  const mountPath = (opts.mountPath ?? "/marketing").replace(/\/$/, "");
  const jobs = new Map<string, BlogGenerationJob>();
  const subscribeHits = new Map<string, number[]>();
  const contextCache = new Map<string, { at: number; ctx: MarketingProductContextSnapshot }>();
  let schemaReady: Promise<void> | null = null;
  const llmTimeoutMs = opts.llmTimeoutMs ?? 240_000;
  const llm: MarketingLlmAdapter = {
    complete: (input) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`LLM timed out after ${Math.round(llmTimeoutMs / 1000)}s`)), llmTimeoutMs);
        opts.llm.complete(input).then(
          (v) => (clearTimeout(timer), resolve(v)),
          (e) => (clearTimeout(timer), reject(e)),
        );
      }),
  };

  const ensureSchema = () => {
    if (!schemaReady) {
      schemaReady = ensureMarketingSchema(opts.db)
        .then(() => undefined)
        .catch((err) => {
          schemaReady = null;
          throw err;
        });
    }
    return schemaReady;
  };

  const knownTenants = (): string[] => Array.from(new Set([opts.tenantId, ...Object.keys(opts.brandsByTenant || {})]));
  const brandFor = (tenantId: string): MarketingBrandConfig =>
    opts.brandsByTenant?.[tenantId] || (tenantId === opts.tenantId ? opts.brand : { ...opts.brand, tenantId });
  const publicOrigin = (brand: MarketingBrandConfig) => (opts.assetBaseUrl || `https://${brand.domain}`).replace(/\/$/, "");
  const mediaUrl = (assetId: string, ext: string) => `${opts.assetBaseUrl || ""}${mountPath}/media/${assetId}.${ext}`;

  async function productContext(tenantId: string): Promise<MarketingProductContextSnapshot> {
    const cached = contextCache.get(tenantId);
    if (cached && Date.now() - cached.at < 60_000) return cached.ctx;
    const brand = brandFor(tenantId);
    let extra: Partial<MarketingProductContextSnapshot> = {};
    try {
      extra = (await opts.getProductContext?.(tenantId)) || {};
    } catch (err) {
      log.warn("[marketing-kit] getProductContext failed", err);
    }
    const ctx: MarketingProductContextSnapshot = {
      tenantId,
      productName: brand.name,
      domain: brand.domain,
      tagline: brand.tagline,
      brandVoice: brand.brandVoice,
      primaryColor: brand.primaryColor,
      accentColor: brand.accentColor,
      pricingSummary: brand.pricingSummary,
      coreFeatures: brand.coreFeatures,
      targetAudiences: brand.targetAudiences,
      ...extra,
    };
    contextCache.set(tenantId, { at: Date.now(), ctx });
    return ctx;
  }

  async function searchCode(query: string, limit = 6): Promise<CodebaseSearchHit[]> {
    if (!opts.codebase || !query.trim()) return [];
    try {
      return await opts.codebase.search(query, limit);
    } catch {
      return [];
    }
  }

  async function listSegments(tenantId: string): Promise<AudienceSegmentInfo[]> {
    let hostSegments: AudienceSegmentInfo[] = [];
    try {
      hostSegments = (await opts.listSegments?.(tenantId)) || [];
    } catch (err) {
      log.warn("[marketing-kit] listSegments failed", err);
    }
    const blogSubs = await store.listBlogSubscribers(tenantId);
    const kit = KIT_SEGMENTS.map((s) =>
      s.id === "blog_subscribers" ? { ...s, count: blogSubs.length, sampleEmails: blogSubs.slice(0, 3).map((r) => String(r.email)) } : s,
    );
    const seen = new Set(hostSegments.map((s) => s.id));
    return [...hostSegments, ...kit.filter((s) => !seen.has(s.id))];
  }

  async function resolveContacts(tenantId: string, segmentId: string, filter: MarketingCustomSegmentFilter | null): Promise<MarketingContact[]> {
    if (segmentId === "blog_subscribers") {
      const rows = await store.listBlogSubscribers(tenantId);
      return rows.map((r) => ({
        id: String(r.id),
        tenantId,
        email: String(r.email),
        firstName: String(r.name || "").split(" ")[0] || "there",
        name: String(r.name || ""),
        planTier: "subscriber",
        lifecycleState: "subscriber",
        marketingOptIn: true,
        unsubscribeToken: String(r.unsubscribe_token),
      }));
    }
    if (!opts.resolveSegmentContacts) return [];
    return opts.resolveSegmentContacts(tenantId, segmentId, filter);
  }

  // ---------------- artwork ----------------

  async function refineStudioSpec(base: StudioCardSpec, title: string, instruction: string): Promise<StudioCardSpec> {
    try {
      const raw = await llm.complete({
        system: `You design text for an editorial "studio card" hero graphic. Return JSON only with these string fields:
caption, docTitle, docHighlight, docReference, calloutBadge, calloutTitle, calloutSubtitle, chipFrom, chipTo, and palette (navy|emerald|amber|purple).
Keep each field short (docHighlight <= 90 chars, others <= 40). Never invent case citations.`,
        user: `Article: ${title}\nCurrent card: ${JSON.stringify(base)}\nInstruction: ${instruction}`,
        temperature: 0.5,
      });
      const parsed = parseJsonLoose<Partial<StudioCardSpec>>(raw);
      if (!parsed) return base;
      const merged = { ...base };
      for (const k of Object.keys(base) as Array<keyof StudioCardSpec>) {
        const v = (parsed as any)[k];
        if (typeof v === "string" && v.trim()) (merged as any)[k] = v.trim().slice(0, 120);
      }
      if (!["navy", "emerald", "amber", "purple"].includes(String(merged.palette))) merged.palette = base.palette;
      return merged;
    } catch {
      return base;
    }
  }

  async function produceArtwork(input: {
    tenantId: string;
    brand: MarketingBrandConfig;
    targetType: "blog" | "email";
    targetId: string;
    title: string;
    kicker: string;
    prompt: string;
    instruction?: string;
    mode: "ai_illustration" | "studio_card";
    existingSpec?: StudioCardSpec | null;
  }): Promise<{ url: string; mode: "ai_illustration" | "studio_card"; spec: StudioCardSpec | null; warning?: string }> {
    let warning: string | undefined;
    if (input.mode === "ai_illustration" && opts.imageGen) {
      const prompt = [
        input.prompt || `Editorial illustration for "${input.title}"`,
        input.instruction ? `Art direction: ${input.instruction}` : "",
        `Style: refined editorial illustration for ${input.brand.name}, palette anchored on ${input.brand.primaryColor} and ${input.brand.accentColor}, soft natural light, generous negative space.`,
        "Absolutely no text, letters, numbers, logos, or watermarks. No gavels or courtroom cliches unless requested. Wide 3:2 composition.",
      ]
        .filter(Boolean)
        .join("\n");
      try {
        const img = await opts.imageGen.generateImage({ prompt, targetType: input.targetType, size: "1536x1024" });
        const id = newId("asset");
        const ext = img.contentType.includes("jpeg") ? "jpg" : img.contentType.includes("webp") ? "webp" : "png";
        const url = mediaUrl(id, ext);
        await store.createAsset({
          id,
          tenantId: input.tenantId,
          targetType: input.targetType,
          targetId: input.targetId,
          mode: "ai_illustration",
          prompt,
          customInstruction: input.instruction || null,
          imageUrl: url,
          contentType: img.contentType,
          data: img.data,
        });
        return { url, mode: "ai_illustration", spec: null };
      } catch (err: any) {
        warning = `AI image generation failed (${String(err?.message || err).slice(0, 160)}); used a studio card instead.`;
        log.warn("[marketing-kit] image generation failed, using studio card", err?.message || err);
      }
    }

    let spec =
      input.existingSpec && !input.instruction
        ? input.existingSpec
        : buildDefaultStudioCardSpec({ title: input.title, kicker: input.kicker, customInstruction: input.instruction, brand: input.brand });
    if (input.instruction) spec = await refineStudioSpec(input.existingSpec || spec, input.title, input.instruction);
    const svg = renderEditorialSvgArtwork({ title: input.title, kicker: input.kicker, targetType: input.targetType, spec, brand: input.brand });
    let data: Buffer = svg;
    let contentType = "image/svg+xml";
    if (opts.rasterizeSvg) {
      try {
        data = await opts.rasterizeSvg(svg, 1200);
        contentType = "image/png";
      } catch (err) {
        log.warn("[marketing-kit] rasterizeSvg failed", err);
      }
    }
    const id = newId("asset");
    const url = mediaUrl(id, contentType === "image/png" ? "png" : "svg");
    await store.createAsset({
      id,
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      mode: "studio_card",
      prompt: input.prompt,
      customInstruction: input.instruction || null,
      imageUrl: url,
      contentType,
      data,
      studioCardSpec: spec,
    });
    return { url, mode: "studio_card", spec, warning };
  }

  // ---------------- blog generation ----------------

  async function generateIntoPost(tenantId: string, postId: string, topic: string, audience: MarketingPost["audience"], instruction: string | undefined, artworkMode: "ai_illustration" | "studio_card") {
    const ctx = await productContext(tenantId);
    const hits = await searchCode(`${topic} ${instruction || ""}`, 5);
    const { draft, usedFallback, error } = await generatePostDraft({ llm, ctx, hits, topic, audience, instruction });
    const slug = await store.uniqueSlug(tenantId, draft.slug, postId);
    let post = await store.updatePost(tenantId, postId, {
      ...draft,
      slug,
      status: "draft",
      artworkMode,
      artworkStatus: "generating",
      generationError: usedFallback ? error || "Used template fallback" : null,
    });
    if (!post) return;
    const art = await produceArtwork({
      tenantId,
      brand: brandFor(tenantId),
      targetType: "blog",
      targetId: postId,
      title: post.title,
      kicker: post.kicker,
      prompt: draft.artworkPrompt,
      mode: artworkMode,
    });
    post = await store.updatePost(tenantId, postId, {
      heroImageUrl: art.url,
      artworkMode: art.mode,
      studioCardSpec: art.spec,
      artworkStatus: "draft",
      ...(art.warning && !usedFallback ? { generationError: art.warning } : {}),
    });
  }

  function startBatch(tenantId: string, topics: string[], audience: MarketingPost["audience"], instruction: string | undefined, artworkMode: "ai_illustration" | "studio_card", postIds: string[]): BlogGenerationJob {
    const job: BlogGenerationJob = {
      id: newId("job"),
      tenantId,
      total: topics.length,
      completed: 0,
      failed: 0,
      postIds,
      status: "running",
      startedAt: nowIso(),
      finishedAt: null,
    };
    jobs.set(job.id, job);
    void mapLimit(topics, opts.generationConcurrency || 3, async (topic, i) => {
      try {
        await generateIntoPost(tenantId, postIds[i], topic, audience, instruction, artworkMode);
        job.completed += 1;
      } catch (err: any) {
        job.failed += 1;
        await store
          .updatePost(tenantId, postIds[i], { status: "draft", artworkStatus: "draft", generationError: String(err?.message || err).slice(0, 300) })
          .catch(() => {});
      }
    }).finally(() => {
      job.status = job.failed === job.total ? "failed" : "completed";
      job.finishedAt = nowIso();
      setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref?.();
    });
    return job;
  }

  // ---------------- email ----------------

  function renderCampaignHtml(c: Pick<EmailCampaign, "subject" | "preheader" | "headline" | "bodyMarkdown" | "ctaLabel" | "ctaUrl" | "bannerImageUrl" | "layout">, brand: MarketingBrandConfig, bannerKicker?: string): string {
    return buildResponsiveEmailHtml({
      brand,
      subject: c.subject,
      preheader: c.preheader,
      headline: c.headline,
      bodyMarkdown: c.bodyMarkdown,
      ctaLabel: c.ctaLabel,
      ctaUrl: c.ctaUrl,
      bannerImageUrl: c.bannerImageUrl,
      layout: c.layout,
      bannerKicker,
    });
  }

  function contactVars(contact: Partial<MarketingContact>, brand: MarketingBrandConfig, unsubscribeUrl: string): Record<string, string> {
    return {
      firstName: contact.firstName || (contact.name || "").split(" ")[0] || "there",
      name: contact.name || "",
      email: contact.email || "",
      matterTitle: contact.matterTitle || "your matter",
      proposedDocsList: contact.proposedDocsList || "- Your proposed documents",
      unlockUrl: contact.unlockUrl || `https://${brand.domain}/`,
      unsubscribeUrl,
    };
  }

  /** Markdown variables like {{proposedDocsList}} expand to HTML lists, so they are rendered before interpolation. */
  function personalize(html: string, vars: Record<string, string>): string {
    const listHtml = vars.proposedDocsList
      .split(/\n/)
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean)
      .map((l) => `<li style="margin:0 0 6px;">${escapeHtml(l)}</li>`)
      .join("");
    const withList = html.replace(/<p[^>]*>\s*\{\{\s*proposedDocsList\s*\}\}\s*<\/p>/g, `<ul style="margin:0 0 16px;padding-left:20px;">${listHtml}</ul>`);
    return interpolateEmailVariables(withList, vars);
  }

  async function sampleContact(tenantId: string, segmentId: string, filter: MarketingCustomSegmentFilter | null): Promise<Partial<MarketingContact>> {
    try {
      const contacts = await resolveContacts(tenantId, segmentId, filter);
      if (contacts[0]) return contacts[0];
    } catch {
      // preview falls back to placeholder data
    }
    return { firstName: "Alex", name: "Alex Rivera", email: "alex@example.com", matterTitle: "Smith v. Landlord Holdings", proposedDocsList: "- Answer to Complaint\n- Motion to Dismiss", unlockUrl: "#" };
  }

  async function sendCampaign(tenantId: string, campaignId: string): Promise<EmailCampaign | null> {
    const campaign = await store.getCampaign(tenantId, campaignId);
    if (!campaign) throw new HttpError(404, "Campaign not found");
    const claimed = await store.claimCampaignForSend(campaignId, ["draft", "approved", "scheduled", "failed"]);
    if (!claimed) throw new HttpError(409, "Campaign is already sending or sent");
    const brand = brandFor(tenantId);
    try {
      if (!opts.email) throw new Error("No email provider configured");
      const contacts = await resolveContacts(tenantId, campaign.segmentId, (campaign.segmentFilter || null) as MarketingCustomSegmentFilter | null);
      const suppressed = await store.suppressedEmails(tenantId);
      const seen = new Set<string>();
      const messages: Array<{ to: string; name: string; subject: string; html: string; headers: Record<string, string>; tags: Array<{ name: string; value: string }> }> = [];
      for (const contact of contacts) {
        const email = String(contact.email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(email) || seen.has(email) || suppressed.has(email) || contact.marketingOptIn === false) continue;
        seen.add(email);
        const sub = await store.ensureSubscriber(tenantId, email, contact.name || null, campaign.segmentId === "blog_subscribers" ? "blog_inline" : "account");
        if (sub.unsubscribed) continue;
        const unsubscribeUrl = `${publicOrigin(brand)}${mountPath}/unsubscribe?token=${encodeURIComponent(sub.token)}&c=${encodeURIComponent(campaignId)}`;
        const vars = contactVars(contact, brand, unsubscribeUrl);
        messages.push({
          to: email,
          name: contact.name || "",
          subject: interpolateEmailVariables(campaign.subject, vars, { escape: false }),
          html: personalize(campaign.bodyHtml, vars),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>${brand.contactEmail ? `, <mailto:${brand.contactEmail}?subject=unsubscribe>` : ""}`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [
            { name: "campaign_id", value: campaignId },
            { name: "tenant", value: tenantId.replace(/[^a-zA-Z0-9_-]/g, "_") },
          ],
        });
      }

      let sent = 0;
      let failedCount = 0;
      const errors: string[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        const results = opts.email.sendBatch
          ? await opts.email.sendBatch(chunk.map(({ name: _n, ...m }) => m))
          : await Promise.all(chunk.map(async ({ name: _n, ...m }) => ({ to: m.to, ...(await opts.email!.sendEmail(m)) })));
        for (let j = 0; j < chunk.length; j++) {
          const r = results[j] || { status: "failed" as const, error: "missing result" };
          if (r.status === "sent") sent += 1;
          else {
            failedCount += 1;
            if (r.error && errors.length < 3) errors.push(r.error);
          }
          await store.addRecipient({
            campaignId,
            tenantId,
            email: chunk[j].to,
            contactName: chunk[j].name,
            providerMessageId: r.providerMessageId || null,
            status: r.status === "sent" ? "sent" : r.status,
          });
        }
      }
      const status: EmailCampaign["status"] = messages.length > 0 && sent === 0 ? "failed" : "sent";
      return store.updateCampaign(tenantId, campaignId, {
        status,
        recipientCount: messages.length,
        sentCount: sent,
        sentAt: nowIso(),
        lastError: errors.length ? `${failedCount} failed: ${errors.join("; ")}`.slice(0, 500) : messages.length === 0 ? "No eligible recipients in this segment." : null,
      });
    } catch (err: any) {
      return store.updateCampaign(tenantId, campaignId, { status: "failed", lastError: String(err?.message || err).slice(0, 500) });
    }
  }

  async function runScheduledWork(): Promise<{ campaignsSent: number; postsPublished: number }> {
    await ensureSchema();
    const runningPostIds = new Set(Array.from(jobs.values()).filter((j) => j.status === "running").flatMap((j) => j.postIds));
    const staleBefore = new Date(Date.now() - Math.max(llmTimeoutMs * 3, 15 * 60_000)).toISOString();
    await store.recoverStaleGenerating(staleBefore, Array.from(runningPostIds));
    let campaignsSent = 0;
    for (const c of await store.listDueCampaigns()) {
      try {
        await sendCampaign(c.tenantId, c.id);
        campaignsSent += 1;
      } catch (err: any) {
        if (!(err instanceof HttpError && err.status === 409)) log.error("[marketing-kit] scheduled send failed", err);
      }
    }
    let postsPublished = 0;
    for (const tenantId of knownTenants()) {
      const scheduled = await store.listPosts(tenantId, { status: "scheduled", limit: 50 });
      for (const p of scheduled) {
        if (p.publishedAt && p.publishedAt <= nowIso()) {
          await store.updatePost(tenantId, p.id, { status: "published" });
          postsPublished += 1;
        }
      }
    }
    return { campaignsSent, postsPublished };
  }

  // ---------------- routes ----------------

  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler, flags: { public?: boolean; allowAllTenant?: boolean } = {}) => {
    const { pattern, keys } = compilePath(path);
    routes.push({ method, pattern, keys, handler, ...flags });
  };

  const requirePost = async (ctx: RouteCtx) => {
    const post = await store.getPost(ctx.tenantId, ctx.params.id);
    if (!post) throw new HttpError(404, "Post not found");
    return post;
  };
  const requireCampaign = async (ctx: RouteCtx) => {
    const c = await store.getCampaign(ctx.tenantId, ctx.params.id);
    if (!c) throw new HttpError(404, "Campaign not found");
    return c;
  };
  const artworkModeOf = (v: unknown, fallback: "ai_illustration" | "studio_card" = "ai_illustration") =>
    v === "studio_card" ? "studio_card" : v === "ai_illustration" ? "ai_illustration" : fallback;
  const audienceOf = (v: unknown): MarketingPost["audience"] => (v === "individual" || v === "attorney" ? v : "general");

  add("GET", "/health", () => ({ ok: true, tenants: knownTenants(), imageGen: Boolean(opts.imageGen), email: Boolean(opts.email) }), { public: true });

  add("GET", "/context", async (ctx) => {
    const product = await productContext(ctx.tenantId);
    return { context: product, capabilities: { imageGen: Boolean(opts.imageGen), email: Boolean(opts.email), codebase: opts.codebase?.label || null } };
  });

  add("GET", "/overview", async (ctx) => ({ overview: await store.overview(ctx.tenantId) }), { allowAllTenant: true });

  // Copilot
  add("GET", "/copilot/messages", async (ctx) => ({ messages: await store.listMessages(ctx.tenantId) }));
  add("DELETE", "/copilot/messages", async (ctx) => {
    await store.clearMessages(ctx.tenantId);
    return { ok: true };
  });
  add("POST", "/copilot/chat", async (ctx) => {
    const message = String(ctx.body?.message || "").trim().slice(0, 4000);
    if (!message) throw new HttpError(400, "message is required");
    const history = await store.listMessages(ctx.tenantId, 20);
    const userMessage = await store.addMessage(ctx.tenantId, "user", message);
    const [product, hits, segments] = await Promise.all([productContext(ctx.tenantId), searchCode(message, 6), listSegments(ctx.tenantId)]);
    const { reply, actions } = await runCopilotTurn({
      llm,
      ctx: product,
      hits,
      history,
      message,
      segmentIds: segments.filter((s) => s.id !== "custom").map((s) => s.id),
    });
    const assistant = await store.addMessage(ctx.tenantId, "assistant", reply, { actions, sources: hits.map((h) => h.path) });
    return { userMessage, message: assistant };
  });

  // Blog
  add("POST", "/blog/ideas", async (ctx) => {
    const product = await productContext(ctx.tenantId);
    const theme = String(ctx.body?.theme || "").slice(0, 500);
    const existing = await store.listPosts(ctx.tenantId, { limit: 80 });
    const ideas = await generateBlogIdeas({
      llm,
      ctx: product,
      hits: await searchCode(theme || product.coreFeatures.join(" "), 4),
      count: Number(ctx.body?.count) || 6,
      audience: ctx.body?.audience,
      theme,
      existingTitles: existing.map((p) => p.title),
    });
    return { ideas };
  });

  add("POST", "/blog/generate-batch", async (ctx) => {
    const audience = audienceOf(ctx.body?.audience);
    const instruction = String(ctx.body?.instruction || "").slice(0, 2000) || undefined;
    const artworkMode = artworkModeOf(ctx.body?.artworkMode);
    let topics: string[] = Array.isArray(ctx.body?.topics) ? ctx.body.topics.map((t: unknown) => String(t || "").trim().slice(0, 240)).filter(Boolean) : [];
    const count = Math.min(Math.max(Number(ctx.body?.count) || topics.length || 3, 1), 12);
    if (topics.length < count) {
      const product = await productContext(ctx.tenantId);
      const existing = await store.listPosts(ctx.tenantId, { limit: 80 });
      const ideas = await generateBlogIdeas({
        llm,
        ctx: product,
        hits: [],
        count: count - topics.length,
        audience,
        theme: String(ctx.body?.theme || instruction || ""),
        existingTitles: [...existing.map((p) => p.title), ...topics],
      });
      topics = [...topics, ...ideas.map((i) => i.title)];
    }
    topics = topics.slice(0, count);
    const placeholders: MarketingPost[] = [];
    for (const topic of topics) {
      placeholders.push(
        await store.createPost(ctx.tenantId, {
          title: topic,
          slug: `draft-${topic}`,
          status: "generating",
          audience,
          artworkMode,
          artworkStatus: "generating",
          sourceTopic: topic,
          authorName: `${ctx.brand.name} Editorial`,
        }),
      );
    }
    const job = startBatch(ctx.tenantId, topics, audience, instruction, artworkMode, placeholders.map((p) => p.id));
    ctx.res.statusCode = 202;
    return { job, posts: placeholders };
  });

  add("GET", "/blog/jobs/:id", (ctx) => {
    const job = jobs.get(ctx.params.id);
    if (!job || job.tenantId !== ctx.tenantId) throw new HttpError(404, "Job not found");
    return { job };
  });

  add("GET", "/blog/posts", async (ctx) => ({ posts: await store.listPosts(ctx.tenantId, { status: ctx.query.get("status") || undefined, limit: Number(ctx.query.get("limit")) || 100 }) }), { allowAllTenant: true });

  add("GET", "/blog/posts/:id", async (ctx) => {
    const post = await requirePost(ctx);
    const [revisions, assets] = await Promise.all([store.listRevisions(post.id), store.listAssets("blog", post.id)]);
    return { post, revisions, assets, sections: splitSections(post.bodyMarkdown).filter((s) => s.heading).map((s) => s.heading) };
  });

  add("PATCH", "/blog/posts/:id", async (ctx) => {
    const post = await requirePost(ctx);
    const b = ctx.body || {};
    const patch: Partial<MarketingPost> = {};
    for (const k of ["title", "kicker", "excerpt", "bodyMarkdown", "seoTitle", "seoDescription", "ctaLabel", "ctaUrl", "artworkPrompt"] as const) {
      if (typeof b[k] === "string") (patch as any)[k] = b[k].slice(0, k === "bodyMarkdown" ? 60000 : 1000);
    }
    if (Array.isArray(b.targetKeywords)) patch.targetKeywords = b.targetKeywords.map(String).slice(0, 15);
    if (Array.isArray(b.faqItems)) patch.faqItems = b.faqItems.filter((f: any) => f?.question && f?.answer).slice(0, 8);
    if (b.audience) patch.audience = audienceOf(b.audience);
    if (typeof b.slug === "string" && b.slug.trim()) patch.slug = await store.uniqueSlug(ctx.tenantId, b.slug, post.id);
    if (typeof patch.bodyMarkdown === "string") patch.readingTimeMinutes = Math.max(2, Math.round(patch.bodyMarkdown.split(/\s+/).length / 220));
    if (patch.bodyMarkdown !== undefined || patch.title !== undefined) await store.addRevision(post, "Manual edit");
    return { post: await store.updatePost(ctx.tenantId, post.id, patch) };
  });

  add("POST", "/blog/posts/:id/rewrite", async (ctx) => {
    const post = await requirePost(ctx);
    const instruction = String(ctx.body?.instruction || "").trim().slice(0, 2000);
    if (!instruction) throw new HttpError(400, "instruction is required");
    const sectionHeading = ctx.body?.sectionHeading ? String(ctx.body.sectionHeading) : undefined;
    const product = await productContext(ctx.tenantId);
    let patch: Awaited<ReturnType<typeof rewritePost>> = null;
    try {
      patch = await rewritePost({ llm, ctx: product, post, instruction, sectionHeading });
    } catch (err: any) {
      throw new HttpError(502, `Rewrite failed: ${String(err?.message || err).slice(0, 200)}`);
    }
    if (!patch) throw new HttpError(502, sectionHeading ? "Could not rewrite that section" : "The model returned an unusable rewrite");
    await store.addRevision(post, sectionHeading ? `Section "${sectionHeading}": ${instruction}` : instruction);
    const updated = await store.updatePost(ctx.tenantId, post.id, { ...patch, generationError: null });
    if (ctx.body?.regenerateArtwork) {
      const art = await produceArtwork({
        tenantId: ctx.tenantId,
        brand: ctx.brand,
        targetType: "blog",
        targetId: post.id,
        title: updated!.title,
        kicker: updated!.kicker,
        prompt: updated!.artworkPrompt,
        instruction: String(ctx.body?.artworkInstruction || "") || undefined,
        mode: updated!.artworkMode,
        existingSpec: updated!.studioCardSpec,
      });
      return { post: await store.updatePost(ctx.tenantId, post.id, { heroImageUrl: art.url, studioCardSpec: art.spec, artworkMode: art.mode, artworkStatus: "draft" }), warning: art.warning };
    }
    return { post: updated };
  });

  add("POST", "/blog/posts/:id/regenerate", async (ctx) => {
    const post = await requirePost(ctx);
    await store.addRevision(post, "Regenerated");
    await store.updatePost(ctx.tenantId, post.id, { status: post.status === "published" ? "published" : "generating", artworkStatus: "generating" });
    const artworkMode = artworkModeOf(ctx.body?.artworkMode, post.artworkMode);
    const instruction = String(ctx.body?.instruction || "").slice(0, 2000) || undefined;
    const job = startBatch(ctx.tenantId, [post.sourceTopic || post.title], post.audience, instruction, artworkMode, [post.id]);
    ctx.res.statusCode = 202;
    return { job };
  });

  add("POST", "/blog/posts/:id/revisions/:revisionId/restore", async (ctx) => {
    const post = await requirePost(ctx);
    const rev = await store.getRevision(post.id, ctx.params.revisionId);
    if (!rev) throw new HttpError(404, "Revision not found");
    await store.addRevision(post, `Before restoring revision from ${rev.createdAt}`);
    return {
      post: await store.updatePost(ctx.tenantId, post.id, {
        title: rev.title,
        excerpt: rev.excerpt,
        bodyMarkdown: rev.bodyMarkdown,
        seoTitle: rev.seoTitle,
        seoDescription: rev.seoDescription,
      }),
    };
  });

  add("POST", "/blog/posts/:id/artwork", async (ctx) => {
    const post = await requirePost(ctx);
    const mode = artworkModeOf(ctx.body?.mode, post.artworkMode);
    const prompt = typeof ctx.body?.prompt === "string" && ctx.body.prompt.trim() ? ctx.body.prompt.trim().slice(0, 1500) : post.artworkPrompt;
    await store.updatePost(ctx.tenantId, post.id, { artworkStatus: "generating", artworkPrompt: prompt });
    const art = await produceArtwork({
      tenantId: ctx.tenantId,
      brand: ctx.brand,
      targetType: "blog",
      targetId: post.id,
      title: post.title,
      kicker: post.kicker,
      prompt,
      instruction: String(ctx.body?.instruction || "").slice(0, 1000) || undefined,
      mode,
      existingSpec: mode === "studio_card" ? post.studioCardSpec : null,
    });
    const updated = await store.updatePost(ctx.tenantId, post.id, { heroImageUrl: art.url, artworkMode: art.mode, studioCardSpec: art.spec, artworkStatus: "draft" });
    return { post: updated, assets: await store.listAssets("blog", post.id), warning: art.warning };
  });

  add("POST", "/blog/posts/:id/artwork/approve", async (ctx) => {
    const post = await requirePost(ctx);
    if (typeof ctx.body?.assetUrl === "string" && ctx.body.assetUrl) {
      const assets = await store.listAssets("blog", post.id);
      const chosen = assets.find((a) => a.imageUrl === ctx.body.assetUrl);
      if (!chosen) throw new HttpError(400, "Unknown asset");
      await store.updatePost(ctx.tenantId, post.id, { heroImageUrl: chosen.imageUrl, artworkMode: chosen.mode, studioCardSpec: chosen.studioCardSpec || null });
    }
    await store.approveLatestAsset("blog", post.id);
    return { post: await store.updatePost(ctx.tenantId, post.id, { artworkStatus: "approved" }) };
  });

  add("POST", "/blog/posts/:id/approve", async (ctx) => {
    const post = await requirePost(ctx);
    if (post.status === "generating") throw new HttpError(409, "Post is still generating");
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: post.status === "published" ? "published" : "approved", artworkStatus: "approved" }) };
  });

  add("POST", "/blog/posts/:id/publish", async (ctx) => {
    const post = await requirePost(ctx);
    if (post.status === "generating") throw new HttpError(409, "Post is still generating");
    const publishAt = ctx.body?.publishAt ? new Date(String(ctx.body.publishAt)) : null;
    if (publishAt && !Number.isNaN(publishAt.getTime()) && publishAt.getTime() > Date.now() + 60_000) {
      return { post: await store.updatePost(ctx.tenantId, post.id, { status: "scheduled", publishedAt: publishAt.toISOString(), artworkStatus: "approved" }) };
    }
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: "published", publishedAt: post.publishedAt && post.status === "published" ? post.publishedAt : nowIso(), artworkStatus: "approved" }) };
  });

  add("POST", "/blog/posts/:id/unpublish", async (ctx) => {
    const post = await requirePost(ctx);
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: "draft" }) };
  });

  add("DELETE", "/blog/posts/:id", async (ctx) => {
    const post = await requirePost(ctx);
    return { post: await store.updatePost(ctx.tenantId, post.id, { status: "archived" }) };
  });

  add("GET", "/blog/posts/:id/preview", async (ctx) => {
    const post = await requirePost(ctx);
    const related = (await store.listPublishedPosts(ctx.tenantId, 4)).filter((p) => p.id !== post.id).slice(0, 3);
    const html = renderPublicBlogPostHtml({ post, relatedPosts: related, brand: ctx.brand }).replace("<head>", '<head><meta name="robots" content="noindex"/>');
    sendText(ctx.res, 200, "text/html; charset=utf-8", html);
    return undefined;
  });

  // Segments
  add("GET", "/segments", async (ctx) => ({ segments: await listSegments(ctx.tenantId) }));
  add("POST", "/segments/preview", async (ctx) => {
    const segmentId = String(ctx.body?.segmentId || "");
    if (!segmentId) throw new HttpError(400, "segmentId is required");
    const contacts = await resolveContacts(ctx.tenantId, segmentId, (ctx.body?.filter || null) as MarketingCustomSegmentFilter | null);
    const suppressed = await store.suppressedEmails(ctx.tenantId);
    const eligible = contacts.filter((c) => c.marketingOptIn !== false && !suppressed.has(String(c.email).toLowerCase()));
    return {
      count: eligible.length,
      suppressed: contacts.length - eligible.length,
      sample: eligible.slice(0, 8).map((c) => ({ email: c.email, name: c.name, planTier: c.planTier, userType: c.userType, matterTitle: c.matterTitle })),
    };
  });

  // Email
  add("POST", "/email/ideas", async (ctx) => {
    const segmentId = String(ctx.body?.segmentId || "all_individuals");
    const segments = await listSegments(ctx.tenantId);
    const seg = segments.find((s) => s.id === segmentId);
    return { ideas: await generateEmailIdeas({ llm, ctx: await productContext(ctx.tenantId), segmentId, segmentLabel: seg?.label || segmentId, goal: String(ctx.body?.goal || "") }) };
  });

  add("GET", "/email/campaigns", async (ctx) => ({ campaigns: await store.listCampaigns(ctx.tenantId) }), { allowAllTenant: true });

  add("POST", "/email/campaigns", async (ctx) => {
    const segmentId = String(ctx.body?.segmentId || "").trim();
    const goal = String(ctx.body?.goal || "").trim().slice(0, 1000);
    if (!segmentId) throw new HttpError(400, "segmentId is required");
    if (!goal) throw new HttpError(400, "goal is required");
    const segments = await listSegments(ctx.tenantId);
    const seg = segments.find((s) => s.id === segmentId);
    if (!seg) throw new HttpError(400, `Unknown segment ${segmentId}`);
    const layoutParsed = EmailLayoutSchema.safeParse(ctx.body?.layout);
    const layout: EmailLayout = layoutParsed.success ? layoutParsed.data : "editorial";
    const artworkMode = artworkModeOf(ctx.body?.artworkMode);
    const product = await productContext(ctx.tenantId);
    const { draft } = await generateEmailDraft({
      llm,
      ctx: product,
      hits: await searchCode(goal, 4),
      segmentId,
      segmentLabel: seg.label,
      goal,
      instruction: String(ctx.body?.instruction || "") || undefined,
    });
    let campaign = await store.createCampaign(ctx.tenantId, {
      ...draft,
      name: String(ctx.body?.name || "") || draft.name,
      segmentId,
      segmentFilter: (ctx.body?.filter || null) as Record<string, unknown> | null,
      goal,
      layout,
      artworkMode,
      artworkStatus: "generating",
    });
    let warning: string | undefined;
    if (ctx.body?.withArtwork !== false && layout !== "minimal") {
      const art = await produceArtwork({
        tenantId: ctx.tenantId,
        brand: ctx.brand,
        targetType: "email",
        targetId: campaign.id,
        title: draft.headline,
        kicker: draft.bannerKicker || ctx.brand.name,
        prompt: draft.artworkPrompt,
        mode: artworkMode,
      });
      warning = art.warning;
      campaign = (await store.updateCampaign(ctx.tenantId, campaign.id, { bannerImageUrl: art.url, artworkMode: art.mode, studioCardSpec: art.spec }))!;
    }
    campaign = (await store.updateCampaign(ctx.tenantId, campaign.id, {
      artworkStatus: "draft",
      bodyHtml: renderCampaignHtml(campaign, ctx.brand, draft.bannerKicker),
    }))!;
    return { campaign, warning };
  });

  add("GET", "/email/campaigns/:id", async (ctx) => {
    const campaign = await requireCampaign(ctx);
    const [recipients, assets] = await Promise.all([store.listRecipients(campaign.id, 100), store.listAssets("email", campaign.id)]);
    return { campaign, recipients, assets };
  });

  add("PATCH", "/email/campaigns/:id", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (["sending", "sent"].includes(c.status)) throw new HttpError(409, "Sent campaigns cannot be edited");
    const b = ctx.body || {};
    const patch: Partial<EmailCampaign> = {};
    for (const k of ["name", "subject", "preheader", "headline", "bodyMarkdown", "ctaLabel", "ctaUrl", "artworkPrompt", "segmentId"] as const) {
      if (typeof b[k] === "string") (patch as any)[k] = b[k].slice(0, k === "bodyMarkdown" ? 20000 : 1000);
    }
    if (b.layout && EmailLayoutSchema.safeParse(b.layout).success) patch.layout = b.layout;
    if (b.filter !== undefined) patch.segmentFilter = b.filter;
    const merged = { ...c, ...patch };
    patch.bodyHtml = renderCampaignHtml(merged, ctx.brand);
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, patch) };
  });

  add("POST", "/email/campaigns/:id/refine", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (["sending", "sent"].includes(c.status)) throw new HttpError(409, "Sent campaigns cannot be edited");
    const instruction = String(ctx.body?.instruction || "").trim().slice(0, 2000);
    const target = ["copy", "layout", "artwork", "all"].includes(ctx.body?.target) ? ctx.body.target : "all";
    if (!instruction && target !== "artwork") throw new HttpError(400, "instruction is required");
    const patch: Partial<EmailCampaign> = {};
    let warning: string | undefined;
    if (target === "copy" || target === "all") {
      const product = await productContext(ctx.tenantId);
      const revised = await refineEmailCopy({
        llm,
        ctx: product,
        segmentId: c.segmentId,
        instruction,
        current: { name: c.name, subject: c.subject, preheader: c.preheader, headline: c.headline, bodyMarkdown: c.bodyMarkdown, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl, artworkPrompt: c.artworkPrompt, bannerKicker: "" },
      }).catch(() => null);
      if (!revised && target === "copy") throw new HttpError(502, "The model returned an unusable revision");
      if (revised) Object.assign(patch, { subject: revised.subject, preheader: revised.preheader, headline: revised.headline, bodyMarkdown: revised.bodyMarkdown, ctaLabel: revised.ctaLabel, ctaUrl: revised.ctaUrl, artworkPrompt: revised.artworkPrompt || c.artworkPrompt });
    }
    if (target === "layout" || target === "all") {
      const requested = EmailLayoutSchema.safeParse(ctx.body?.layout);
      patch.layout = requested.success ? requested.data : layoutFromInstruction(instruction, c.layout);
    }
    const merged = { ...c, ...patch };
    if (target === "artwork" || (target === "all" && /\b(art|image|banner|illustration|visual|colou?r|palette)\b/i.test(instruction))) {
      const mode = artworkModeOf(ctx.body?.mode, c.artworkMode);
      const art = await produceArtwork({
        tenantId: ctx.tenantId,
        brand: ctx.brand,
        targetType: "email",
        targetId: c.id,
        title: merged.headline,
        kicker: ctx.brand.name,
        prompt: typeof ctx.body?.prompt === "string" && ctx.body.prompt.trim() ? ctx.body.prompt.trim() : merged.artworkPrompt,
        instruction: instruction || undefined,
        mode,
        existingSpec: c.studioCardSpec,
      });
      warning = art.warning;
      Object.assign(patch, { bannerImageUrl: art.url, artworkMode: art.mode, studioCardSpec: art.spec, artworkStatus: "draft" });
      merged.bannerImageUrl = art.url;
    }
    patch.bodyHtml = renderCampaignHtml({ ...merged, ...patch }, ctx.brand);
    if (c.status === "approved") patch.status = "draft";
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, patch), warning };
  });

  add("GET", "/email/campaigns/:id/preview", async (ctx) => {
    const c = await requireCampaign(ctx);
    const contact = await sampleContact(ctx.tenantId, c.segmentId, (c.segmentFilter || null) as MarketingCustomSegmentFilter | null);
    const html = personalize(c.bodyHtml, contactVars(contact, ctx.brand, "#unsubscribe-preview"));
    sendText(ctx.res, 200, "text/html; charset=utf-8", html);
    return undefined;
  });

  add("POST", "/email/campaigns/:id/test-send", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (!opts.email) throw new HttpError(503, "No email provider configured");
    const to = String(ctx.body?.to || ctx.user?.email || headerValue(ctx.req, "x-marketing-actor-email") || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new HttpError(400, "A valid test recipient is required");
    const contact = await sampleContact(ctx.tenantId, c.segmentId, (c.segmentFilter || null) as MarketingCustomSegmentFilter | null);
    const vars = contactVars({ ...contact, email: to }, ctx.brand, `${publicOrigin(ctx.brand)}${mountPath}/unsubscribe?token=test`);
    const result = await opts.email.sendEmail({
      to,
      subject: `[Test] ${interpolateEmailVariables(c.subject, vars, { escape: false })}`,
      html: personalize(c.bodyHtml, vars),
      tags: [{ name: "campaign_id", value: c.id }, { name: "test", value: "true" }],
    });
    if (result.status !== "sent") throw new HttpError(502, result.error || `Test send ${result.status}`);
    return { ok: true, to, providerMessageId: result.providerMessageId || null };
  });

  add("POST", "/email/campaigns/:id/approve", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (!["draft", "failed"].includes(c.status)) throw new HttpError(409, `Cannot approve a ${c.status} campaign`);
    await store.approveLatestAsset("email", c.id);
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, { status: "approved", artworkStatus: "approved" }) };
  });

  add("POST", "/email/campaigns/:id/send", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (["sending", "sent"].includes(c.status)) throw new HttpError(409, `Campaign is already ${c.status}`);
    if (c.status !== "approved" && c.status !== "scheduled" && !ctx.body?.confirm) {
      throw new HttpError(409, "Approve the campaign first, or pass confirm: true");
    }
    const scheduledAt = ctx.body?.scheduledAt ? new Date(String(ctx.body.scheduledAt)) : null;
    if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now() + 60_000) {
      return { campaign: await store.updateCampaign(ctx.tenantId, c.id, { status: "scheduled", scheduledAt: scheduledAt.toISOString() }) };
    }
    if (!opts.email) throw new HttpError(503, "No email provider configured");
    void sendCampaign(ctx.tenantId, c.id).catch((err) => log.error("[marketing-kit] send failed", err));
    ctx.res.statusCode = 202;
    return { campaign: { ...c, status: "sending" } };
  });

  add("POST", "/email/campaigns/:id/cancel-schedule", async (ctx) => {
    const c = await requireCampaign(ctx);
    if (c.status !== "scheduled") throw new HttpError(409, "Campaign is not scheduled");
    return { campaign: await store.updateCampaign(ctx.tenantId, c.id, { status: "approved", scheduledAt: null }) };
  });

  // Public: media, cover fallback, subscribe, unsubscribe, webhook
  add(
    "GET",
    "/media/:file",
    async (ctx) => {
      const id = ctx.params.file.replace(/\.[a-z0-9]+$/i, "");
      const asset = await store.getAssetBinary(id);
      if (!asset) throw new HttpError(404, "Not found");
      sendText(ctx.res, 200, asset.contentType, asset.data, "public, max-age=31536000, immutable");
      return undefined;
    },
    { public: true },
  );

  const coverCache = new Map<string, { at: number; type: string; data: Buffer }>();
  add(
    "GET",
    "/blog/:slug/:cover",
    async (ctx) => {
      const ext = ctx.params.cover === "cover.png" ? "png" : ctx.params.cover === "cover.svg" ? "svg" : null;
      if (!ext) throw new HttpError(404, "Not found");
      const post = await store.getPostBySlug(ctx.tenantId, ctx.params.slug);
      if (!post || post.status !== "published") throw new HttpError(404, "Not found");
      const cacheKey = `${ctx.tenantId}:${post.slug}:${post.updatedAt}:${ext}`;
      const cached = coverCache.get(cacheKey);
      if (cached) {
        sendText(ctx.res, 200, cached.type, cached.data, "public, max-age=3600");
        return undefined;
      }
      const spec = post.studioCardSpec || buildDefaultStudioCardSpec({ title: post.title, kicker: post.kicker, brand: ctx.brand });
      const svg = renderEditorialSvgArtwork({ title: post.title, kicker: post.kicker, targetType: "blog", spec, brand: ctx.brand });
      let data: Buffer = svg;
      let type = "image/svg+xml";
      if (ext === "png" && opts.rasterizeSvg) {
        try {
          data = await opts.rasterizeSvg(svg, 1200);
          type = "image/png";
        } catch (err) {
          log.warn("[marketing-kit] cover rasterize failed", err);
        }
      }
      if (coverCache.size > 200) coverCache.clear();
      coverCache.set(cacheKey, { at: Date.now(), type, data });
      sendText(ctx.res, 200, type, data, "public, max-age=3600");
      return undefined;
    },
    { public: true },
  );

  add(
    "POST",
    "/subscribe",
    async (ctx) => {
      const ip = String(headerValue(ctx.req, "x-forwarded-for").split(",")[0] || ctx.req.socket?.remoteAddress || "unknown").trim();
      const now = Date.now();
      const hits = (subscribeHits.get(ip) || []).filter((t) => now - t < 3_600_000);
      if (hits.length >= 10) throw new HttpError(429, "Too many requests");
      hits.push(now);
      subscribeHits.set(ip, hits);
      const email = String(ctx.body?.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "A valid email is required");
      const source = String(ctx.body?.source || "blog_inline").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "blog_inline";
      await store.ensureSubscriber(ctx.tenantId, email, String(ctx.body?.name || "").slice(0, 120) || null, source === "account" ? "blog_inline" : source);
      await store.resubscribe(ctx.tenantId, email);
      return { ok: true };
    },
    { public: true },
  );

  const unsubscribe = async (ctx: RouteCtx, confirm: boolean) => {
    const token = String(ctx.query.get("token") || ctx.body?.token || "");
    if (!token || token === "test") {
      sendText(ctx.res, token === "test" ? 200 : 400, "text/html; charset=utf-8", simplePage(ctx.brand, token === "test" ? "Test unsubscribe link" : "Invalid link", "<p>This link is not attached to a subscription.</p>"));
      return undefined;
    }
    if (!confirm) {
      const action = `${mountPath}/unsubscribe?token=${encodeURIComponent(token)}${ctx.query.get("c") ? `&c=${encodeURIComponent(String(ctx.query.get("c")))}` : ""}`;
      sendText(
        ctx.res,
        200,
        "text/html; charset=utf-8",
        simplePage(
          ctx.brand,
          "Unsubscribe from marketing email",
          `<p>You will stop receiving product updates and campaigns. Account and security emails will still be delivered.</p>
<form method="post" action="${escapeHtml(action)}"><button type="submit" style="margin-top:12px;padding:12px 20px;border:0;border-radius:10px;background:#0c1931;color:#fff;font-weight:700;cursor:pointer">Unsubscribe</button></form>`,
        ),
      );
      return undefined;
    }
    const result = await store.unsubscribeByToken(token);
    const campaignId = String(ctx.query.get("c") || "");
    if (result && campaignId) await store.markRecipientUnsubscribed(campaignId, result.email);
    sendText(
      ctx.res,
      result ? 200 : 404,
      "text/html; charset=utf-8",
      simplePage(ctx.brand, result ? "You're unsubscribed" : "Link not found", result ? `<p>${escapeHtml(result.email)} will no longer receive marketing email.</p>` : "<p>This unsubscribe link is invalid or expired.</p>"),
    );
    return undefined;
  };
  add("GET", "/unsubscribe", (ctx) => unsubscribe(ctx, false), { public: true });
  add("POST", "/unsubscribe", (ctx) => unsubscribe(ctx, true), { public: true });

  add(
    "POST",
    "/webhooks/resend",
    async (ctx) => {
      const secret = (await opts.resendWebhookSecret?.())?.trim() || "";
      if (!secret) throw new HttpError(503, "Resend webhook secret not configured");
      const raw = await readRawBody(ctx.req);
      const ok = verifySvixSignature({
        secret,
        id: headerValue(ctx.req, "svix-id"),
        timestamp: headerValue(ctx.req, "svix-timestamp"),
        signatureHeader: headerValue(ctx.req, "svix-signature"),
        payload: raw,
      });
      if (!ok) throw new HttpError(401, "Invalid signature");
      let event: any;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }
      const messageId = String(event?.data?.email_id || "");
      const map: Record<string, "delivered" | "opened" | "clicked" | "bounced" | "complained"> = {
        "email.delivered": "delivered",
        "email.opened": "opened",
        "email.clicked": "clicked",
        "email.bounced": "bounced",
        "email.complained": "complained",
      };
      const kind = map[String(event?.type || "")];
      if (!kind || !messageId) return { ok: true, ignored: true };
      const applied = await store.applyDeliveryEvent(messageId, kind);
      if (kind === "bounced" || kind === "complained") {
        const rcpt = await store.recipientEmailForMessage(messageId);
        if (rcpt) await store.suppressEmail(rcpt.tenantId, rcpt.email);
      }
      return { ok: true, applied };
    },
    { public: true },
  );

  // ---------------- dispatcher ----------------

  async function authenticate(req: Req): Promise<MarketingAuthUser | null> {
    const key = headerValue(req, "x-ops-key").trim();
    if (key && opts.opsKeys) {
      const keys = ((await opts.opsKeys()) || []).map((k) => String(k || "").trim()).filter(Boolean);
      if (keys.some((k) => safeEqual(k, key))) {
        const email = headerValue(req, "x-marketing-actor-email").trim();
        return { id: "ops-hub", role: "ops", email: EMAIL_RE.test(email) ? email : undefined, name: "Ops Hub" };
      }
    }
    if (!opts.resolveUser) return null;
    try {
      return (await opts.resolveUser(req)) || null;
    } catch {
      return null;
    }
  }

  const handler = async (req: Req, res: Res, next?: Next): Promise<void> => {
    const url = new URL(String(req.url || "/"), "http://local");
    let path = url.pathname.replace(/\/+$/, "") || "/";
    let tenantId = opts.tenantId;
    const tenantMatch = path.match(/^\/t\/([a-z0-9_-]+)(\/.*)?$/i);
    if (tenantMatch) {
      tenantId = tenantMatch[1].toLowerCase();
      path = tenantMatch[2] || "/";
      if (tenantId !== "all" && !knownTenants().includes(tenantId)) return sendJson(res, 404, { error: `Unknown tenant ${tenantId}` });
    }
    const method = String(req.method || "GET").toUpperCase();
    const route = routes.find((r) => r.method === method && r.pattern.test(path));
    if (!route) {
      if (next) return next();
      return sendJson(res, 404, { error: "Not found" });
    }
    try {
      await ensureSchema();
      const user = route.public ? null : await authenticate(req);
      if (!route.public && (!user || (user.role !== "admin" && user.role !== "ops"))) {
        return sendJson(res, user ? 403 : 401, { error: user ? "Admin access required" : "Authentication required" });
      }
      if (tenantId === "all" && !route.allowAllTenant) {
        return sendJson(res, 400, { error: "Select a specific tenant for this action" });
      }
      const m = path.match(route.pattern)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const body = method === "GET" || method === "HEAD" ? {} : await readJsonBody(req);
      const result = await route.handler({ req, res, params, query: url.searchParams, body, tenantId, brand: brandFor(tenantId === "all" ? opts.tenantId : tenantId), user });
      if (result !== undefined && !res.writableEnded) sendJson(res, res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, result);
    } catch (err: any) {
      if (res.writableEnded) return;
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      log.error("[marketing-kit] request failed", err);
      sendJson(res, 500, { error: "Internal error" });
    }
  };

  const publicHandlers: MarketingKit["publicHandlers"] = {
    async blogIndex(_req, res, next) {
      try {
        await ensureSchema();
        const posts = await store.listPublishedPosts(opts.tenantId);
        sendText(res, 200, "text/html; charset=utf-8", renderPublicBlogIndexHtml({ posts, brand: opts.brand }), "public, max-age=300");
      } catch (err) {
        log.error("[marketing-kit] blog index failed", err);
        if (next) next(err);
        else sendText(res, 500, "text/plain", "Error");
      }
    },
    async blogPost(req, res, next) {
      try {
        await ensureSchema();
        const slug = String(req.params?.slug || new URL(String(req.url || "/"), "http://local").pathname.split("/").filter(Boolean).pop() || "");
        const post = await store.getPostBySlug(opts.tenantId, slug);
        if (!post || post.status !== "published") {
          return sendText(res, 404, "text/html; charset=utf-8", simplePage(opts.brand, "Article not found", `<p>This article doesn't exist or is no longer published.</p><p><a href="/blog" style="color:#1d4ed8">Browse the journal</a></p>`));
        }
        const related = (await store.listPublishedPosts(opts.tenantId, 6)).filter((p) => p.id !== post.id).slice(0, 3);
        sendText(res, 200, "text/html; charset=utf-8", renderPublicBlogPostHtml({ post, relatedPosts: related, brand: opts.brand }), "public, max-age=300");
      } catch (err) {
        log.error("[marketing-kit] blog post failed", err);
        if (next) next(err);
        else sendText(res, 500, "text/plain", "Error");
      }
    },
    async sitemap(_req, res, next) {
      try {
        await ensureSchema();
        const posts = await store.listPublishedPosts(opts.tenantId, 1000);
        sendText(res, 200, "application/xml; charset=utf-8", renderSitemapXml({ brand: opts.brand, posts }), "public, max-age=900");
      } catch (err) {
        log.error("[marketing-kit] sitemap failed", err);
        if (next) next(err);
        else sendText(res, 500, "text/plain", "Error");
      }
    },
  };

  async function seedPosts(tenantId: string, posts: Array<Partial<MarketingPost> & { title: string; slug: string }>): Promise<number> {
    await ensureSchema();
    let created = 0;
    for (const p of posts) {
      if (await store.getPostBySlug(tenantId, p.slug)) continue;
      await store.createPost(tenantId, p);
      created += 1;
    }
    return created;
  }

  function startScheduler(intervalMs = 60_000): () => void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      runScheduledWork()
        .catch((err) => log.error("[marketing-kit] scheduler failed", err))
        .finally(() => {
          running = false;
        });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { handler, publicHandlers, store, ensureSchema, seedPosts, runScheduledWork, startScheduler };
}

/** Convenience wrapper returning only the request handler. */
export function createMarketingRouter(opts: CreateMarketingRouterOptions) {
  return createMarketingKit(opts).handler;
}
