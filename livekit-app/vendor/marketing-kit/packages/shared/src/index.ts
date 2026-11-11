import { z } from "zod";

export const MARKETING_KIT_VERSION = "0.1.0";

export const PostStatusSchema = z.enum([
  "idea",
  "generating",
  "draft",
  "approved",
  "scheduled",
  "published",
  "archived",
]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

export const ArtworkModeSchema = z.enum(["ai_illustration", "studio_card"]);
export type ArtworkMode = z.infer<typeof ArtworkModeSchema>;

export const ArtworkStatusSchema = z.enum(["draft", "approved", "generating"]);
export type ArtworkStatus = z.infer<typeof ArtworkStatusSchema>;

export interface BlogFaqItem {
  question: string;
  answer: string;
}

export interface StudioCardSpec {
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

export interface MarketingArtworkAsset {
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

export interface MarketingPost {
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

export interface MarketingPostRevision {
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

export interface AudienceSegmentInfo {
  id: string;
  label: string;
  description: string;
  count: number;
  sampleEmails?: string[];
}

export interface MarketingContact {
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

export const EmailLayoutSchema = z.enum(["editorial", "spotlight", "minimal"]);
export type EmailLayout = z.infer<typeof EmailLayoutSchema>;

export interface EmailCampaign {
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

export interface CopilotIdeaAction {
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

export interface CopilotMessage {
  id: string;
  tenantId: string;
  role: "user" | "assistant";
  content: string;
  suggestedActions?: CopilotIdeaAction[];
  codebaseSources?: string[];
  createdAt: string;
}

export interface MarketingProductContextSnapshot {
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
  codebaseHighlights?: Array<{ path: string; summary: string }>;
}

export interface MarketingOverview {
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

export interface BlogGenerationJob {
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
