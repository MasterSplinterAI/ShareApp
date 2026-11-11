import type {
  BlogFaqItem,
  CopilotIdeaAction,
  EmailLayout,
  MarketingPost,
  MarketingProductContextSnapshot,
} from "@rhule/marketing-shared";
import type { CodebaseSearchHit, MarketingBrandConfig, MarketingLlmAdapter } from "./adapters.js";
import { estimateReadingTime, slugify } from "./store.js";

/** Extracts the first JSON object/array from an LLM response (tolerates code fences and prose). */
export function parseJsonLoose<T = any>(raw: string): T | null {
  if (!raw) return null;
  const text = String(raw).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through
  }
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, maxItems = 12): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, maxItems) : [];

export function contextBlock(ctx: MarketingProductContextSnapshot, hits: CodebaseSearchHit[] = []): string {
  const lines = [
    `PRODUCT: ${ctx.productName} (${ctx.domain}) — ${ctx.tagline}`,
    `BRAND VOICE: ${ctx.brandVoice}`,
    `PRICING / TIERS: ${ctx.pricingSummary}`,
    `CORE FEATURES:\n${ctx.coreFeatures.map((f) => `- ${f}`).join("\n")}`,
    `TARGET AUDIENCES: ${ctx.targetAudiences.join("; ")}`,
  ];
  if (ctx.recentCommitsOrChanges?.length) {
    lines.push(`RECENT PRODUCT CHANGES:\n${ctx.recentCommitsOrChanges.slice(0, 15).map((c) => `- ${c}`).join("\n")}`);
  }
  if (ctx.supportKnowledgeGaps?.length) {
    lines.push(`UNANSWERED SUPPORT QUESTIONS (content opportunities):\n${ctx.supportKnowledgeGaps.slice(0, 12).map((g) => `- ${g}`).join("\n")}`);
  }
  if (ctx.liveMetrics && Object.keys(ctx.liveMetrics).length) {
    lines.push(`LIVE METRICS: ${Object.entries(ctx.liveMetrics).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (ctx.codebaseHighlights?.length) {
    lines.push(`PRODUCT SURFACES:\n${ctx.codebaseHighlights.slice(0, 12).map((h) => `- ${h.path}: ${h.summary}`).join("\n")}`);
  }
  if (hits.length) {
    lines.push(`RELEVANT CODE / DOCS:\n${hits.map((h) => `[${h.path}] ${h.snippet}`).join("\n")}`);
  }
  return lines.join("\n\n");
}

const LEGAL_GUARDRAILS = `Rules: You write marketing for a legal-information and document-preparation product. Never promise legal outcomes,
never claim to be a law firm, never give jurisdiction-specific legal advice as fact, and never invent statistics, case names, or citations.
Only describe product features listed in the context. Write in plain, confident, specific English.`;

// ---------------- Copilot ----------------

export async function runCopilotTurn(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  hits: CodebaseSearchHit[];
  history: Array<{ role: string; content: string }>;
  message: string;
  segmentIds: string[];
}): Promise<{ reply: string; actions: CopilotIdeaAction[] }> {
  const system = `You are the Marketing Copilot for ${input.ctx.productName}. You know the product from its codebase, pricing, support gaps, and metrics.
Help the operator plan growth: SEO blog topics, email campaigns, positioning, and launch messaging grounded in real features.
${LEGAL_GUARDRAILS}

Respond with JSON only:
{"reply": "markdown answer, concise, cite product surfaces when relevant",
 "actions": [ {"kind":"blog_batch","title":"...","description":"...","seedTopics":["..."],"audience":"individual|attorney|general","count":3}
            | {"kind":"email_campaign","title":"...","description":"...","segmentId":"one of: ${input.segmentIds.join(", ")}","campaignGoal":"...","subjectHint":"..."} ]}
Include 1-3 actions whenever the conversation contains an idea that could become content.

${contextBlock(input.ctx, input.hits)}`;
  const transcript = input.history
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  try {
    const raw = await input.llm.complete({
      system,
      user: `${transcript ? `${transcript}\n\n` : ""}USER: ${input.message}`,
      temperature: 0.6,
    });
    const parsed = parseJsonLoose<{ reply?: string; actions?: any[] }>(raw);
    if (parsed && typeof parsed.reply === "string") {
      return { reply: parsed.reply.trim(), actions: normalizeActions(parsed.actions, input.segmentIds) };
    }
    if (raw && raw.trim()) return { reply: raw.trim(), actions: fallbackActions(input.message, input.segmentIds) };
  } catch {
    // fall through to deterministic reply
  }
  return {
    reply: `I couldn't reach the language model just now, so here is a starting point based on "${input.message.slice(0, 120)}". Pick an action below to generate drafts; you can refine every draft before anything is published or sent.`,
    actions: fallbackActions(input.message, input.segmentIds),
  };
}

function normalizeActions(raw: unknown, segmentIds: string[]): CopilotIdeaAction[] {
  if (!Array.isArray(raw)) return [];
  const out: CopilotIdeaAction[] = [];
  for (const a of raw.slice(0, 4)) {
    if (!a || typeof a !== "object") continue;
    const kind = a.kind === "email_campaign" ? "email_campaign" : a.kind === "blog_batch" ? "blog_batch" : null;
    if (!kind) continue;
    const title = str(a.title, 140);
    if (!title) continue;
    if (kind === "blog_batch") {
      const topics = strArr(a.seedTopics, 12);
      out.push({
        kind,
        title,
        description: str(a.description, 400),
        seedTopics: topics.length ? topics : [title],
        audience: ["individual", "attorney", "general"].includes(a.audience) ? a.audience : "general",
        count: Math.min(Math.max(Number(a.count) || topics.length || 3, 1), 12),
      });
    } else {
      out.push({
        kind,
        title,
        description: str(a.description, 400),
        segmentId: segmentIds.includes(a.segmentId) ? a.segmentId : segmentIds[0] || "all_individuals",
        campaignGoal: str(a.campaignGoal, 400) || title,
        subjectHint: str(a.subjectHint, 140),
      });
    }
  }
  return out;
}

function fallbackActions(message: string, segmentIds: string[]): CopilotIdeaAction[] {
  const topic = message.replace(/\s+/g, " ").trim().slice(0, 100) || "How our product helps";
  return [
    {
      kind: "blog_batch",
      title: `Blog batch: ${topic}`,
      description: "Three SEO articles exploring this idea from different search intents.",
      seedTopics: [topic, `${topic}: a step-by-step guide`, `Common mistakes with ${topic.toLowerCase()}`],
      audience: "general",
      count: 3,
    },
    {
      kind: "email_campaign",
      title: `Email: ${topic}`,
      description: "A short campaign introducing this idea with one clear call to action.",
      segmentId: segmentIds[0] || "all_individuals",
      campaignGoal: topic,
    },
  ];
}

// ---------------- Blog ----------------

export interface BlogIdea {
  title: string;
  kicker: string;
  angle: string;
  targetKeywords: string[];
  audience: "individual" | "attorney" | "general";
}

export async function generateBlogIdeas(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  hits: CodebaseSearchHit[];
  count: number;
  audience?: string;
  theme?: string;
  existingTitles: string[];
}): Promise<BlogIdea[]> {
  const count = Math.min(Math.max(input.count || 6, 1), 12);
  try {
    const raw = await input.llm.complete({
      system: `You are an SEO content strategist for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
Return JSON only: {"ideas":[{"title":"...","kicker":"2-3 word category","angle":"one sentence","targetKeywords":["..."],"audience":"individual|attorney|general"}]}

${contextBlock(input.ctx, input.hits)}`,
      user: `Propose ${count} blog article ideas${input.audience ? ` for the ${input.audience} audience` : ""}${input.theme ? ` around: ${input.theme}` : ""}.
Target real search intent (questions people type into Google). Avoid these existing titles: ${input.existingTitles.slice(0, 40).join(" | ") || "none"}.`,
      temperature: 0.8,
    });
    const parsed = parseJsonLoose<{ ideas?: any[] }>(raw);
    const ideas = (parsed?.ideas || [])
      .map((i: any) => ({
        title: str(i?.title, 140),
        kicker: str(i?.kicker, 40) || "Practice Note",
        angle: str(i?.angle, 300),
        targetKeywords: strArr(i?.targetKeywords, 8),
        audience: (["individual", "attorney", "general"].includes(i?.audience) ? i.audience : "general") as BlogIdea["audience"],
      }))
      .filter((i: BlogIdea) => i.title);
    if (ideas.length) return ideas.slice(0, count);
  } catch {
    // fall through
  }
  const base = input.theme || input.ctx.coreFeatures[0] || input.ctx.productName;
  return Array.from({ length: count }, (_v, i) => ({
    title: [`What to know before ${base.toLowerCase()}`, `A practical checklist for ${base.toLowerCase()}`, `${base}: questions to ask first`][i % 3] + (i >= 3 ? ` (${i + 1})` : ""),
    kicker: "Practice Note",
    angle: `Explains ${base} in plain language and shows where ${input.ctx.productName} helps.`,
    targetKeywords: [base.toLowerCase()],
    audience: (input.audience as BlogIdea["audience"]) || "general",
  }));
}

export interface GeneratedPostDraft {
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

const POST_JSON_SHAPE = `{"title":"H1 title","slug":"kebab-case-slug","kicker":"2-3 word category","excerpt":"1-2 sentence summary",
"seoTitle":"<= 60 chars, includes primary keyword","seoDescription":"<= 155 chars","targetKeywords":["primary","secondary",...],
"audience":"individual|attorney|general","bodyMarkdown":"900-1400 words of markdown using ## and ### headings, short paragraphs, bullet lists, one > callout, and 2-3 internal links such as [start free](/auth?mode=register) or [pricing](/pricing)",
"faqItems":[{"question":"...","answer":"..."}],"ctaLabel":"...","ctaUrl":"/auth?mode=register","artworkPrompt":"editorial illustration brief, no text in image"}`;

function normalizePostDraft(parsed: any, fallbackTitle: string, audience: MarketingPost["audience"]): GeneratedPostDraft | null {
  if (!parsed || typeof parsed !== "object") return null;
  const title = str(parsed.title, 160);
  const body = str(parsed.bodyMarkdown, 30000);
  if (!title || body.length < 200) return null;
  const faq: BlogFaqItem[] = Array.isArray(parsed.faqItems)
    ? parsed.faqItems
        .map((f: any) => ({ question: str(f?.question, 300), answer: str(f?.answer, 1200) }))
        .filter((f: BlogFaqItem) => f.question && f.answer)
        .slice(0, 6)
    : [];
  const ctaUrl = str(parsed.ctaUrl, 300);
  return {
    title,
    slug: slugify(str(parsed.slug, 90) || title),
    kicker: str(parsed.kicker, 40) || "Practice Note",
    excerpt: str(parsed.excerpt, 400) || body.replace(/[#>*_\-[\]()]/g, "").slice(0, 200),
    seoTitle: (str(parsed.seoTitle, 120) || title).slice(0, 70),
    seoDescription: (str(parsed.seoDescription, 300) || str(parsed.excerpt, 300)).slice(0, 160),
    targetKeywords: strArr(parsed.targetKeywords, 10),
    audience: ["individual", "attorney", "general"].includes(parsed.audience) ? parsed.audience : audience,
    bodyMarkdown: body,
    faqItems: faq,
    ctaLabel: str(parsed.ctaLabel, 60) || "Start your first matter free",
    ctaUrl: /^(\/|https?:\/\/)/.test(ctaUrl) ? ctaUrl : "/auth?mode=register",
    artworkPrompt: str(parsed.artworkPrompt, 800) || `Editorial illustration about ${fallbackTitle}`,
    readingTimeMinutes: estimateReadingTime(body),
  };
}

export function templatePostDraft(topic: string, ctx: MarketingProductContextSnapshot, audience: MarketingPost["audience"]): GeneratedPostDraft {
  const title = topic.length > 8 ? topic.replace(/\.$/, "") : `${topic}: a practical guide`;
  const features = ctx.coreFeatures.slice(0, 4);
  const body = `## Why this matters

Most people meet this problem for the first time under a deadline. The rules are knowable, but they are scattered, and the cost of a missed step is high. This guide walks through the parts you can control.

## Start with the facts you already have

Write down the dates, the parties, and the documents in front of you before you do anything else. A clean timeline is the single most useful thing you can bring to a lawyer, a court clerk, or a negotiation.

- Every date you were served, notified, or contacted
- Every document you received or signed
- What outcome you actually want

## Where most people get stuck

The common failure is not a lack of effort; it is working from the wrong template or the wrong assumption about deadlines. Check the rules for your jurisdiction, and keep a record of where each rule came from.

> Legal information is not legal advice. When the stakes are high, talk to a licensed attorney in your jurisdiction.

## How ${ctx.productName} helps

${features.map((f) => `- ${f}`).join("\n")}

You can [start your first matter free](/auth?mode=register) and see how it organizes your facts, or review [pricing](/pricing) first.

## Next steps

Pick one action today: build the timeline, collect the documents, or book a consultation. Momentum matters more than perfection.`;
  return {
    title,
    slug: slugify(title),
    kicker: "Practice Note",
    excerpt: `A plain-language guide to ${topic.toLowerCase()}, with a checklist you can use today.`,
    seoTitle: title.slice(0, 60),
    seoDescription: `Plain-language guide to ${topic.toLowerCase()}: key facts to gather, common mistakes, and next steps.`.slice(0, 155),
    targetKeywords: [topic.toLowerCase()],
    audience,
    bodyMarkdown: body,
    faqItems: [
      { question: `Do I need a lawyer for ${topic.toLowerCase()}?`, answer: "It depends on the stakes and your jurisdiction. Legal information tools help you prepare, but a licensed attorney can advise on your specific situation." },
      { question: `Is ${ctx.productName} a law firm?`, answer: `No. ${ctx.productName} provides legal information and document preparation tools, not legal advice.` },
    ],
    ctaLabel: "Start your first matter free",
    ctaUrl: "/auth?mode=register",
    artworkPrompt: `Calm editorial illustration representing ${topic}, desk with documents, navy and warm amber palette, no text`,
    readingTimeMinutes: estimateReadingTime(body),
  };
}

export async function generatePostDraft(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  hits: CodebaseSearchHit[];
  topic: string;
  audience: MarketingPost["audience"];
  instruction?: string;
}): Promise<{ draft: GeneratedPostDraft; usedFallback: boolean; error?: string }> {
  try {
    const raw = await input.llm.complete({
      system: `You are a senior legal-tech content writer and SEO editor for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
Write one complete, publish-ready article. Structure: hook intro, 4-6 ## sections with ### subsections where useful, a practical checklist,
a "How ${input.ctx.productName} helps" section grounded only in listed features, and a closing next step.
Return JSON only in this shape:
${POST_JSON_SHAPE}

${contextBlock(input.ctx, input.hits)}`,
      user: `Topic: ${input.topic}\nAudience: ${input.audience}${input.instruction ? `\nEditor instructions: ${input.instruction}` : ""}`,
      temperature: 0.7,
    });
    const draft = normalizePostDraft(parseJsonLoose(raw), input.topic, input.audience);
    if (draft) return { draft, usedFallback: false };
    return { draft: templatePostDraft(input.topic, input.ctx, input.audience), usedFallback: true, error: "Model returned an unusable draft; used the template." };
  } catch (err: any) {
    return { draft: templatePostDraft(input.topic, input.ctx, input.audience), usedFallback: true, error: String(err?.message || err).slice(0, 300) };
  }
}

/** Rewrites a whole post, or only the `## section` whose heading matches `sectionHeading`. */
export async function rewritePost(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  post: MarketingPost;
  instruction: string;
  sectionHeading?: string;
}): Promise<Partial<GeneratedPostDraft> | null> {
  const { post } = input;
  if (input.sectionHeading) {
    const sections = splitSections(post.bodyMarkdown);
    const idx = sections.findIndex((s) => s.heading.toLowerCase() === input.sectionHeading!.toLowerCase());
    if (idx < 0) return null;
    const raw = await input.llm.complete({
      system: `You edit one section of a published-quality article for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
Return JSON only: {"sectionMarkdown":"the full replacement section starting with its ## heading"}`,
      user: `Article title: ${post.title}\n\nSection to rewrite:\n${sections[idx].text}\n\nInstruction: ${input.instruction}`,
      temperature: 0.6,
    });
    const parsed = parseJsonLoose<{ sectionMarkdown?: string }>(raw);
    let replacement = str(parsed?.sectionMarkdown, 12000);
    if (!replacement) return null;
    if (!/^##\s/.test(replacement)) replacement = `## ${sections[idx].heading}\n\n${replacement}`;
    sections[idx] = { ...sections[idx], text: replacement };
    const body = sections.map((s) => s.text.trim()).join("\n\n");
    return { bodyMarkdown: body, readingTimeMinutes: estimateReadingTime(body) };
  }
  const raw = await input.llm.complete({
    system: `You revise articles for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
Apply the editor instruction to the article and return the full revised article as JSON only:
${POST_JSON_SHAPE}

${contextBlock(input.ctx)}`,
    user: `Editor instruction: ${input.instruction}\n\nCurrent article JSON:\n${JSON.stringify({
      title: post.title,
      kicker: post.kicker,
      excerpt: post.excerpt,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      targetKeywords: post.targetKeywords,
      audience: post.audience,
      bodyMarkdown: post.bodyMarkdown,
      faqItems: post.faqItems,
      ctaLabel: post.ctaLabel,
      ctaUrl: post.ctaUrl,
      artworkPrompt: post.artworkPrompt,
    })}`,
    temperature: 0.6,
  });
  const draft = normalizePostDraft(parseJsonLoose(raw), post.title, post.audience);
  if (!draft) return null;
  const { slug: _slug, ...rest } = draft;
  return rest;
}

export function splitSections(markdown: string): Array<{ heading: string; text: string }> {
  const lines = String(markdown || "").split(/\r?\n/);
  const out: Array<{ heading: string; text: string }> = [];
  let current: { heading: string; lines: string[] } = { heading: "", lines: [] };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current.lines.length) out.push({ heading: current.heading, text: current.lines.join("\n") });
      current = { heading: m[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) out.push({ heading: current.heading, text: current.lines.join("\n") });
  return out;
}

// ---------------- Email ----------------

export interface EmailIdea {
  name: string;
  subject: string;
  angle: string;
  segmentId: string;
}

export interface GeneratedEmailDraft {
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

const EMAIL_VARS_HELP = `Personalization variables you may use verbatim: {{firstName}}, {{matterTitle}}, {{proposedDocsList}}, {{unlockUrl}}.
Only use {{matterTitle}}, {{proposedDocsList}} and {{unlockUrl}} for the free_matter_locked segment.`;

export async function generateEmailIdeas(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  segmentId: string;
  segmentLabel: string;
  goal?: string;
}): Promise<EmailIdea[]> {
  try {
    const raw = await input.llm.complete({
      system: `You are a lifecycle email strategist for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
Return JSON only: {"ideas":[{"name":"internal campaign name","subject":"subject line <= 60 chars","angle":"one sentence"}]}

${contextBlock(input.ctx)}`,
      user: `Segment: ${input.segmentLabel} (${input.segmentId}).${input.goal ? ` Goal: ${input.goal}.` : ""} Propose 5 campaign ideas.`,
      temperature: 0.8,
    });
    const parsed = parseJsonLoose<{ ideas?: any[] }>(raw);
    const ideas = (parsed?.ideas || [])
      .map((i: any) => ({ name: str(i?.name, 120), subject: str(i?.subject, 120), angle: str(i?.angle, 300), segmentId: input.segmentId }))
      .filter((i: EmailIdea) => i.subject);
    if (ideas.length) return ideas.slice(0, 6);
  } catch {
    // fall through
  }
  return [
    { name: `${input.segmentLabel}: feature spotlight`, subject: `A faster way to get your next step done`, angle: "Spotlight one core feature with a single clear CTA.", segmentId: input.segmentId },
    { name: `${input.segmentLabel}: how-to`, subject: `3 things to prepare before you file anything`, angle: "Useful checklist that builds trust before asking for action.", segmentId: input.segmentId },
  ];
}

export function templateEmailDraft(input: {
  ctx: MarketingProductContextSnapshot;
  segmentId: string;
  goal: string;
}): GeneratedEmailDraft {
  if (input.segmentId === "free_matter_locked") {
    return {
      name: "Unlock your matter documents",
      subject: "Your documents for {{matterTitle}} are ready to unlock",
      preheader: "Pick up where you left off — your research is saved.",
      headline: "Your next documents are one step away",
      bodyMarkdown: `Hi {{firstName}},

You've already done the hard part on **{{matterTitle}}**: the facts are organized and the research is saved.

Lex has proposed these documents for your matter:

{{proposedDocsList}}

Unlock this matter once to draft, revise, and download them.`,
      ctaLabel: "Unlock my documents",
      ctaUrl: "{{unlockUrl}}",
      artworkPrompt: "Editorial illustration of a neatly organized legal folder being unlocked, navy and amber, no text",
      bannerKicker: "Your matter",
    };
  }
  return {
    name: input.goal.slice(0, 80) || `${input.ctx.productName} update`,
    subject: `${input.goal.slice(0, 50) || `What's new in ${input.ctx.productName}`}`,
    preheader: input.ctx.tagline,
    headline: input.goal.slice(0, 90) || `What's new in ${input.ctx.productName}`,
    bodyMarkdown: `Hi {{firstName}},

${input.ctx.tagline}

${input.ctx.coreFeatures.slice(0, 3).map((f) => `- ${f}`).join("\n")}

Reply to this email if you have questions — a real person reads every reply.`,
    ctaLabel: "Open my workspace",
    ctaUrl: input.ctx.domain ? `https://${input.ctx.domain}/` : "/",
    artworkPrompt: `Editorial illustration for ${input.goal || input.ctx.productName}, navy palette, no text`,
    bannerKicker: input.ctx.productName,
  };
}

const EMAIL_JSON_SHAPE = `{"name":"internal name","subject":"<= 60 chars","preheader":"<= 100 chars","headline":"<= 70 chars",
"bodyMarkdown":"120-260 words of markdown: greeting with {{firstName}}, short paragraphs, optional bullet list","ctaLabel":"2-4 words",
"ctaUrl":"absolute or root-relative URL","artworkPrompt":"banner illustration brief, no text in image","bannerKicker":"1-3 words"}`;

function normalizeEmailDraft(parsed: any): GeneratedEmailDraft | null {
  if (!parsed || typeof parsed !== "object") return null;
  const subject = str(parsed.subject, 140);
  const body = str(parsed.bodyMarkdown, 8000);
  if (!subject || body.length < 40) return null;
  const ctaUrl = str(parsed.ctaUrl, 400);
  return {
    name: str(parsed.name, 140) || subject,
    subject,
    preheader: str(parsed.preheader, 160),
    headline: str(parsed.headline, 140) || subject,
    bodyMarkdown: body,
    ctaLabel: str(parsed.ctaLabel, 50) || "Learn more",
    ctaUrl: /^(\/|https?:\/\/|\{\{)/.test(ctaUrl) ? ctaUrl : "/",
    artworkPrompt: str(parsed.artworkPrompt, 800),
    bannerKicker: str(parsed.bannerKicker, 40),
  };
}

export async function generateEmailDraft(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  hits: CodebaseSearchHit[];
  segmentId: string;
  segmentLabel: string;
  goal: string;
  instruction?: string;
}): Promise<{ draft: GeneratedEmailDraft; usedFallback: boolean }> {
  try {
    const raw = await input.llm.complete({
      system: `You are a lifecycle email copywriter for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
${EMAIL_VARS_HELP}
Return JSON only: ${EMAIL_JSON_SHAPE}

${contextBlock(input.ctx, input.hits)}`,
      user: `Segment: ${input.segmentLabel} (${input.segmentId})\nGoal: ${input.goal}${input.instruction ? `\nInstructions: ${input.instruction}` : ""}`,
      temperature: 0.7,
    });
    const draft = normalizeEmailDraft(parseJsonLoose(raw));
    if (draft) return { draft, usedFallback: false };
  } catch {
    // fall through
  }
  return { draft: templateEmailDraft(input), usedFallback: true };
}

export async function refineEmailCopy(input: {
  llm: MarketingLlmAdapter;
  ctx: MarketingProductContextSnapshot;
  current: GeneratedEmailDraft;
  segmentId: string;
  instruction: string;
}): Promise<GeneratedEmailDraft | null> {
  const raw = await input.llm.complete({
    system: `You revise marketing emails for ${input.ctx.productName}. ${LEGAL_GUARDRAILS}
${EMAIL_VARS_HELP}
Apply the instruction and return the full revised email as JSON only: ${EMAIL_JSON_SHAPE}`,
    user: `Segment: ${input.segmentId}\nInstruction: ${input.instruction}\n\nCurrent email JSON:\n${JSON.stringify(input.current)}`,
    temperature: 0.6,
  });
  return normalizeEmailDraft(parseJsonLoose(raw));
}

/** Picks a layout from free-text instructions such as "make it minimal" or "more visual". */
export function layoutFromInstruction(instruction: string, current: EmailLayout): EmailLayout {
  const lower = instruction.toLowerCase();
  if (/\b(minimal|plain|letter|text[- ]only|personal)\b/.test(lower)) return "minimal";
  if (/\b(spotlight|bold|visual|hero|centered|centred|big)\b/.test(lower)) return "spotlight";
  if (/\b(editorial|classic|standard|newsletter)\b/.test(lower)) return "editorial";
  return current;
}
