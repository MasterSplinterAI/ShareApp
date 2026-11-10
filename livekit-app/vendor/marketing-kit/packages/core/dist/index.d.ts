import { MarketingProductContextSnapshot, AudienceSegmentInfo, MarketingContact, StudioCardSpec, MarketingPost, EmailLayout, EmailCampaign, MarketingPostRevision, ArtworkMode, MarketingArtworkAsset, CopilotIdeaAction, CopilotMessage, MarketingOverview, BlogFaqItem } from '@rhule/marketing-shared';

interface MarketingDbAdapter {
    run(sql: string, params?: unknown[]): Promise<{
        changes: number;
    }>;
    get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
    all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
declare const DEFAULT_MARKETING_TABLE_PREFIX = "mkt_";
declare function buildMarketingSchemaStatements(prefix?: string): string[];
declare function ensureMarketingSchema(db: MarketingDbAdapter, tablePrefix?: string): Promise<{
    tablePrefix: string;
    statements: number;
}>;

interface CodebaseSearchHit {
    path: string;
    score: number;
    snippet: string;
}
interface MarketingCodebaseAdapter {
    label?: string;
    search(query: string, limit?: number): Promise<CodebaseSearchHit[]>;
    readFile(relPath: string): Promise<string | null>;
}
interface MarketingLlmAdapter {
    complete(input: {
        system: string;
        user: string;
        temperature?: number;
    }): Promise<string>;
}
interface MarketingImageAdapter {
    /** Generates raster artwork. Returned bytes are stored by the kit and served from `<mount>/media/:id`. */
    generateImage(input: {
        prompt: string;
        targetType: "blog" | "email";
        size: "1536x1024" | "1024x1024";
    }): Promise<{
        data: Buffer;
        contentType: string;
    }>;
}
interface MarketingAuthUser {
    id: string;
    email?: string;
    name?: string;
    role: "user" | "admin" | "ops";
}
interface MarketingEmailAdapter {
    sendEmail(input: {
        to: string;
        subject: string;
        html: string;
        headers?: Record<string, string>;
        tags?: Array<{
            name: string;
            value: string;
        }>;
    }): Promise<{
        providerMessageId?: string | null;
        status: "sent" | "skipped" | "failed";
        error?: string;
    }>;
    sendBatch?(messages: Array<{
        to: string;
        subject: string;
        html: string;
        headers?: Record<string, string>;
        tags?: Array<{
            name: string;
            value: string;
        }>;
    }>): Promise<Array<{
        to: string;
        providerMessageId?: string | null;
        status: "sent" | "skipped" | "failed";
        error?: string;
    }>>;
}
interface MarketingBrandConfig {
    tenantId: string;
    name: string;
    domain: string;
    tagline: string;
    brandVoice: string;
    primaryColor: string;
    accentColor: string;
    logoText?: string;
    signupUrl: string;
    pricingSummary: string;
    coreFeatures: string[];
    targetAudiences: string[];
    contactEmail?: string;
}
interface CreateMarketingRouterOptions {
    tenantId: string;
    db: MarketingDbAdapter;
    brand: MarketingBrandConfig;
    brandsByTenant?: Record<string, MarketingBrandConfig>;
    llm: MarketingLlmAdapter;
    imageGen?: MarketingImageAdapter;
    email?: MarketingEmailAdapter;
    codebase?: MarketingCodebaseAdapter;
    resolveUser?: (req: any) => Promise<MarketingAuthUser | null> | MarketingAuthUser | null;
    /** Service keys accepted via `X-Ops-Key` (ops.lalia.cloud federation). Compared in constant time. */
    opsKeys?: () => Array<string | null | undefined> | Promise<Array<string | null | undefined>>;
    getProductContext?: (tenantId: string) => Promise<Partial<MarketingProductContextSnapshot>>;
    /** Host-defined segments. `blog_subscribers` and `custom` are provided by the kit. */
    listSegments?: (tenantId: string) => Promise<AudienceSegmentInfo[]>;
    resolveSegmentContacts?: (tenantId: string, segmentId: string, filter?: MarketingCustomSegmentFilter | null) => Promise<MarketingContact[]>;
    /** Converts SVG studio artwork to PNG (email clients such as Gmail do not render SVG). */
    rasterizeSvg?: (svg: Buffer, width: number) => Promise<Buffer>;
    /** Path the router is mounted at, used to build media/unsubscribe URLs. Default `/marketing`. */
    mountPath?: string;
    /** Origin prefixed to stored media URLs, e.g. `https://lexit.legal`. Default: relative URLs. */
    assetBaseUrl?: string;
    /** Svix signing secret (`whsec_...`) for Resend webhooks. Unsigned webhooks are rejected. */
    resendWebhookSecret?: () => string | null | undefined | Promise<string | null | undefined>;
    /** Per-call LLM timeout; on timeout generation falls back to templates or records an error. Default 240000. */
    llmTimeoutMs?: number;
    /** Max concurrent post generations per batch. Default 3. */
    generationConcurrency?: number;
    logger?: Pick<Console, "info" | "warn" | "error">;
}
interface MarketingCustomSegmentFilter {
    userTypes?: string[];
    planTiers?: string[];
    signedUpAfter?: string;
    signedUpBefore?: string;
    hasLockedMatter?: boolean;
    emailDomain?: string;
}
declare function createMarketingCodebaseAdapter(opts: {
    root: string;
    allowlist: string[];
    label?: string;
    maxFilesWalk?: number;
}): MarketingCodebaseAdapter;

declare function buildDefaultStudioCardSpec(input: {
    title: string;
    kicker?: string;
    customInstruction?: string;
    brand: MarketingBrandConfig;
}): StudioCardSpec;
/**
 * Generates a high-resolution 1200x630 editorial SVG artwork buffer (for blog hero or email banner)
 * that is always crisp, brand-aligned, and never fails even when external image APIs are offline.
 */
declare function renderEditorialSvgArtwork(input: {
    title: string;
    kicker?: string;
    targetType: "blog" | "email";
    spec: StudioCardSpec;
    brand: MarketingBrandConfig;
}): Buffer;

declare function renderMarkdownToHtmlAndToc(markdown: string): {
    html: string;
    toc: Array<{
        id: string;
        text: string;
    }>;
};
declare function renderPublicBlogIndexHtml(input: {
    posts: MarketingPost[];
    brand: MarketingBrandConfig;
}): string;
declare function renderPublicBlogPostHtml(input: {
    post: MarketingPost;
    relatedPosts: MarketingPost[];
    brand: MarketingBrandConfig;
}): string;
declare function renderSitemapXml(input: {
    brand: MarketingBrandConfig;
    posts: MarketingPost[];
}): string;

/**
 * Pure-HTML banner used when no raster artwork exists. Table-based so it survives Outlook and Gmail,
 * neither of which render SVG.
 */
declare function renderTableBannerHtml(input: {
    brand: MarketingBrandConfig;
    kicker: string;
    title: string;
    subtitle?: string;
}): string;
declare function buildResponsiveEmailHtml(input: {
    brand: MarketingBrandConfig;
    subject: string;
    preheader: string;
    headline: string;
    bodyMarkdown: string;
    ctaLabel: string;
    ctaUrl: string;
    bannerImageUrl?: string | null;
    layout?: EmailLayout;
    bannerKicker?: string;
}): string;
/** Replaces `{{var}}` placeholders. Values are HTML-escaped unless `raw` is set. */
declare function interpolateEmailVariables(raw: string, vars: Record<string, string>, opts?: {
    escape?: boolean;
}): string;

type Row = Record<string, any>;
declare const nowIso: () => string;
declare const newId: (prefix: string) => string;
declare const newToken: () => string;
declare function slugify(raw: string): string;
declare function rowToPost(r: Row): MarketingPost;
declare function rowToCampaign(r: Row): EmailCampaign;
declare function estimateReadingTime(markdown: string): number;
declare class MarketingStore {
    private readonly db;
    private readonly p;
    constructor(db: MarketingDbAdapter, p?: string);
    private tenantClause;
    uniqueSlug(tenantId: string, base: string, excludeId?: string): Promise<string>;
    createPost(tenantId: string, input: Partial<MarketingPost> & {
        title: string;
    }): Promise<MarketingPost>;
    getPost(tenantId: string, id: string): Promise<MarketingPost | null>;
    getPostBySlug(tenantId: string, slug: string): Promise<MarketingPost | null>;
    listPosts(tenantId: string, opts?: {
        status?: string;
        limit?: number;
    }): Promise<MarketingPost[]>;
    listPublishedPosts(tenantId: string, limit?: number): Promise<MarketingPost[]>;
    /** Drafts left in `generating` by a crashed or restarted process become editable drafts again. */
    recoverStaleGenerating(updatedBefore: string, excludeIds?: string[]): Promise<number>;
    updatePost(tenantId: string, id: string, patch: Partial<MarketingPost>): Promise<MarketingPost | null>;
    addRevision(post: MarketingPost, instruction: string): Promise<void>;
    listRevisions(postId: string): Promise<MarketingPostRevision[]>;
    getRevision(postId: string, revisionId: string): Promise<MarketingPostRevision | null>;
    createAsset(input: {
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
    }): Promise<MarketingArtworkAsset>;
    listAssets(targetType: string, targetId: string): Promise<MarketingArtworkAsset[]>;
    getAssetBinary(id: string): Promise<{
        contentType: string;
        data: Buffer;
    } | null>;
    approveLatestAsset(targetType: string, targetId: string): Promise<void>;
    createCampaign(tenantId: string, input: Partial<EmailCampaign> & {
        subject: string;
        segmentId: string;
    }): Promise<EmailCampaign>;
    getCampaign(tenantId: string, id: string): Promise<EmailCampaign | null>;
    listCampaigns(tenantId: string, limit?: number): Promise<EmailCampaign[]>;
    listDueCampaigns(): Promise<EmailCampaign[]>;
    updateCampaign(tenantId: string, id: string, patch: Partial<EmailCampaign>): Promise<EmailCampaign | null>;
    /** Atomically moves a campaign into `sending`; returns false when another worker already claimed it. */
    claimCampaignForSend(id: string, fromStatuses: string[]): Promise<boolean>;
    addRecipient(input: {
        campaignId: string;
        tenantId: string;
        email: string;
        contactName?: string | null;
        providerMessageId?: string | null;
        status: string;
    }): Promise<void>;
    listRecipients(campaignId: string, limit?: number): Promise<Row[]>;
    /**
     * Applies a provider event to the recipient row and bumps the campaign counter only on the first
     * occurrence of each event type, so webhook retries stay idempotent.
     */
    applyDeliveryEvent(providerMessageId: string, event: "delivered" | "opened" | "clicked" | "bounced" | "complained"): Promise<boolean>;
    markRecipientUnsubscribed(campaignId: string, email: string): Promise<void>;
    recipientEmailForMessage(providerMessageId: string): Promise<{
        email: string;
        tenantId: string;
    } | null>;
    ensureSubscriber(tenantId: string, email: string, name: string | null, source: string, optIn?: boolean): Promise<{
        token: string;
        unsubscribed: boolean;
    }>;
    resubscribe(tenantId: string, email: string): Promise<void>;
    unsubscribeByToken(token: string): Promise<{
        email: string;
        tenantId: string;
    } | null>;
    suppressEmail(tenantId: string, email: string): Promise<void>;
    suppressedEmails(tenantId: string): Promise<Set<string>>;
    listBlogSubscribers(tenantId: string): Promise<Row[]>;
    addMessage(tenantId: string, role: "user" | "assistant", content: string, extra?: {
        actions?: CopilotIdeaAction[];
        sources?: string[];
    }): Promise<CopilotMessage>;
    listMessages(tenantId: string, limit?: number): Promise<CopilotMessage[]>;
    clearMessages(tenantId: string): Promise<void>;
    overview(tenantId: string): Promise<MarketingOverview>;
}

/** Extracts the first JSON object/array from an LLM response (tolerates code fences and prose). */
declare function parseJsonLoose<T = any>(raw: string): T | null;
declare function contextBlock(ctx: MarketingProductContextSnapshot, hits?: CodebaseSearchHit[]): string;
declare function runCopilotTurn(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    hits: CodebaseSearchHit[];
    history: Array<{
        role: string;
        content: string;
    }>;
    message: string;
    segmentIds: string[];
}): Promise<{
    reply: string;
    actions: CopilotIdeaAction[];
}>;
interface BlogIdea {
    title: string;
    kicker: string;
    angle: string;
    targetKeywords: string[];
    audience: "individual" | "attorney" | "general";
}
declare function generateBlogIdeas(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    hits: CodebaseSearchHit[];
    count: number;
    audience?: string;
    theme?: string;
    existingTitles: string[];
}): Promise<BlogIdea[]>;
interface GeneratedPostDraft {
    title: string;
    slug: string;
    kicker: string;
    excerpt: string;
    seoTitle: string;
    seoDescription: string;
    targetKeywords: string[];
    audience: MarketingPost["audience"];
    bodyMarkdown: string;
    faqItems: BlogFaqItem[];
    ctaLabel: string;
    ctaUrl: string;
    artworkPrompt: string;
    readingTimeMinutes: number;
}
declare function templatePostDraft(topic: string, ctx: MarketingProductContextSnapshot, audience: MarketingPost["audience"]): GeneratedPostDraft;
declare function generatePostDraft(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    hits: CodebaseSearchHit[];
    topic: string;
    audience: MarketingPost["audience"];
    instruction?: string;
}): Promise<{
    draft: GeneratedPostDraft;
    usedFallback: boolean;
    error?: string;
}>;
/** Rewrites a whole post, or only the `## section` whose heading matches `sectionHeading`. */
declare function rewritePost(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    post: MarketingPost;
    instruction: string;
    sectionHeading?: string;
}): Promise<Partial<GeneratedPostDraft> | null>;
declare function splitSections(markdown: string): Array<{
    heading: string;
    text: string;
}>;
interface EmailIdea {
    name: string;
    subject: string;
    angle: string;
    segmentId: string;
}
interface GeneratedEmailDraft {
    name: string;
    subject: string;
    preheader: string;
    headline: string;
    bodyMarkdown: string;
    ctaLabel: string;
    ctaUrl: string;
    artworkPrompt: string;
    bannerKicker: string;
    layout?: EmailLayout;
}
declare function generateEmailIdeas(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    segmentId: string;
    segmentLabel: string;
    goal?: string;
}): Promise<EmailIdea[]>;
declare function templateEmailDraft(input: {
    ctx: MarketingProductContextSnapshot;
    segmentId: string;
    goal: string;
}): GeneratedEmailDraft;
declare function generateEmailDraft(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    hits: CodebaseSearchHit[];
    segmentId: string;
    segmentLabel: string;
    goal: string;
    instruction?: string;
}): Promise<{
    draft: GeneratedEmailDraft;
    usedFallback: boolean;
}>;
declare function refineEmailCopy(input: {
    llm: MarketingLlmAdapter;
    ctx: MarketingProductContextSnapshot;
    current: GeneratedEmailDraft;
    segmentId: string;
    instruction: string;
}): Promise<GeneratedEmailDraft | null>;
/** Picks a layout from free-text instructions such as "make it minimal" or "more visual". */
declare function layoutFromInstruction(instruction: string, current: EmailLayout): EmailLayout;

type Req = any;
type Res = any;
type Next = (err?: unknown) => void;
declare const KIT_SEGMENTS: AudienceSegmentInfo[];
/** Verifies a Svix-signed webhook (the scheme Resend uses). */
declare function verifySvixSignature(input: {
    secret: string;
    id: string;
    timestamp: string;
    signatureHeader: string;
    payload: Buffer | string;
    toleranceSeconds?: number;
    nowSeconds?: number;
}): boolean;
interface MarketingKit {
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
    seedPosts: (tenantId: string, posts: Array<Partial<MarketingPost> & {
        title: string;
        slug: string;
    }>) => Promise<number>;
    runScheduledWork: () => Promise<{
        campaignsSent: number;
        postsPublished: number;
    }>;
    startScheduler: (intervalMs?: number) => () => void;
}
declare function createMarketingKit(opts: CreateMarketingRouterOptions): MarketingKit;
/** Convenience wrapper returning only the request handler. */
declare function createMarketingRouter(opts: CreateMarketingRouterOptions): (req: Req, res: Res, next?: Next) => Promise<void>;

export { type BlogIdea, type CodebaseSearchHit, type CreateMarketingRouterOptions, DEFAULT_MARKETING_TABLE_PREFIX, type EmailIdea, type GeneratedEmailDraft, type GeneratedPostDraft, KIT_SEGMENTS, type MarketingAuthUser, type MarketingBrandConfig, type MarketingCodebaseAdapter, type MarketingCustomSegmentFilter, type MarketingDbAdapter, type MarketingEmailAdapter, type MarketingImageAdapter, type MarketingKit, type MarketingLlmAdapter, MarketingStore, buildDefaultStudioCardSpec, buildMarketingSchemaStatements, buildResponsiveEmailHtml, contextBlock, createMarketingCodebaseAdapter, createMarketingKit, createMarketingRouter, ensureMarketingSchema, estimateReadingTime, generateBlogIdeas, generateEmailDraft, generateEmailIdeas, generatePostDraft, interpolateEmailVariables, layoutFromInstruction, newId, newToken, nowIso, parseJsonLoose, refineEmailCopy, renderEditorialSvgArtwork, renderMarkdownToHtmlAndToc, renderPublicBlogIndexHtml, renderPublicBlogPostHtml, renderSitemapXml, renderTableBannerHtml, rewritePost, rowToCampaign, rowToPost, runCopilotTurn, slugify, splitSections, templateEmailDraft, templatePostDraft, verifySvixSignature };
