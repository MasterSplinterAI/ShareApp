import { z } from 'zod';

declare const MARKETING_KIT_VERSION = "0.1.0";
declare const PostStatusSchema: z.ZodEnum<["idea", "generating", "draft", "approved", "scheduled", "published", "archived"]>;
type PostStatus = z.infer<typeof PostStatusSchema>;
declare const ArtworkModeSchema: z.ZodEnum<["ai_illustration", "studio_card"]>;
type ArtworkMode = z.infer<typeof ArtworkModeSchema>;
declare const ArtworkStatusSchema: z.ZodEnum<["draft", "approved", "generating"]>;
type ArtworkStatus = z.infer<typeof ArtworkStatusSchema>;
interface BlogFaqItem {
    question: string;
    answer: string;
}
interface StudioCardSpec {
    caption: string;
    docTitle: string;
    docHighlight: string;
    docReference: string;
    calloutBadge: string;
    calloutTitle: string;
    calloutSubtitle: string;
    chipFrom: string;
    chipTo: string;
    palette?: "navy" | "emerald" | "amber" | "purple";
}
interface MarketingArtworkAsset {
    id: string;
    tenantId: string;
    targetType: "blog" | "email";
    targetId: string;
    mode: ArtworkMode;
    prompt: string;
    customInstruction?: string | null;
    imageUrl: string;
    studioCardSpec?: StudioCardSpec | null;
    status: ArtworkStatus;
    createdAt: string;
}
interface MarketingPost {
    id: string;
    tenantId: string;
    slug: string;
    title: string;
    kicker: string;
    excerpt: string;
    bodyMarkdown: string;
    seoTitle: string;
    seoDescription: string;
    targetKeywords: string[];
    readingTimeMinutes: number;
    audience: "individual" | "attorney" | "general";
    ctaLabel: string;
    ctaUrl: string;
    faqItems: BlogFaqItem[];
    artworkMode: ArtworkMode;
    artworkPrompt: string;
    artworkStatus: ArtworkStatus;
    heroImageUrl: string | null;
    studioCardSpec: StudioCardSpec | null;
    status: PostStatus;
    sourceTopic: string;
    generationError: string | null;
    authorName: string;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
interface MarketingPostRevision {
    id: string;
    postId: string;
    tenantId: string;
    instruction: string;
    title: string;
    excerpt: string;
    bodyMarkdown: string;
    seoTitle: string;
    seoDescription: string;
    createdAt: string;
}
interface AudienceSegmentInfo {
    id: string;
    label: string;
    description: string;
    count: number;
    sampleEmails?: string[];
}
interface MarketingContact {
    id: string;
    tenantId: string;
    email: string;
    firstName: string;
    name: string;
    planTier: string;
    lifecycleState: string;
    userType?: string;
    marketingOptIn: boolean;
    unsubscribeToken: string;
    matterTitle?: string;
    proposedDocsList?: string;
    unlockUrl?: string;
}
declare const EmailLayoutSchema: z.ZodEnum<["editorial", "spotlight", "minimal"]>;
type EmailLayout = z.infer<typeof EmailLayoutSchema>;
interface EmailCampaign {
    id: string;
    tenantId: string;
    name: string;
    segmentId: string;
    segmentFilter: Record<string, unknown> | null;
    goal: string;
    layout: EmailLayout;
    subject: string;
    preheader: string;
    headline: string;
    bodyHtml: string;
    bodyMarkdown: string;
    ctaLabel: string;
    ctaUrl: string;
    artworkPrompt: string;
    artworkStatus: ArtworkStatus;
    artworkMode: ArtworkMode;
    studioCardSpec: StudioCardSpec | null;
    bannerImageUrl: string | null;
    status: "draft" | "approved" | "scheduled" | "sending" | "sent" | "failed";
    lastError: string | null;
    recipientCount: number;
    sentCount: number;
    deliveredCount: number;
    openedCount: number;
    clickedCount: number;
    bouncedCount: number;
    unsubscribedCount: number;
    scheduledAt?: string | null;
    sentAt?: string | null;
    createdAt: string;
    updatedAt: string;
}
interface CopilotIdeaAction {
    kind: "blog_batch" | "email_campaign";
    title: string;
    description: string;
    seedTopics?: string[];
    audience?: "individual" | "attorney" | "general";
    count?: number;
    segmentId?: string;
    campaignGoal?: string;
    subjectHint?: string;
}
interface CopilotMessage {
    id: string;
    tenantId: string;
    role: "user" | "assistant";
    content: string;
    suggestedActions?: CopilotIdeaAction[];
    codebaseSources?: string[];
    createdAt: string;
}
interface MarketingProductContextSnapshot {
    tenantId: string;
    productName: string;
    domain: string;
    tagline: string;
    brandVoice: string;
    primaryColor: string;
    accentColor: string;
    pricingSummary: string;
    coreFeatures: string[];
    targetAudiences: string[];
    recentCommitsOrChanges?: string[];
    supportKnowledgeGaps?: string[];
    liveMetrics?: Record<string, number | string>;
    codebaseHighlights?: Array<{
        path: string;
        summary: string;
    }>;
}
interface MarketingOverview {
    tenantId: string;
    posts: Record<string, number>;
    publishedPosts: number;
    campaigns: number;
    emailsSent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    unsubscribed: number;
    openRate: number;
    clickRate: number;
    subscribers: number;
    lastCampaignAt: string | null;
    lastPublishedAt: string | null;
}
interface BlogGenerationJob {
    id: string;
    tenantId: string;
    total: number;
    completed: number;
    failed: number;
    postIds: string[];
    status: "running" | "completed" | "failed";
    startedAt: string;
    finishedAt: string | null;
}

export { type ArtworkMode, ArtworkModeSchema, type ArtworkStatus, ArtworkStatusSchema, type AudienceSegmentInfo, type BlogFaqItem, type BlogGenerationJob, type CopilotIdeaAction, type CopilotMessage, type EmailCampaign, type EmailLayout, EmailLayoutSchema, MARKETING_KIT_VERSION, type MarketingArtworkAsset, type MarketingContact, type MarketingOverview, type MarketingPost, type MarketingPostRevision, type MarketingProductContextSnapshot, type PostStatus, PostStatusSchema, type StudioCardSpec };
