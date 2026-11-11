import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import type { MarketingContact } from "@rhule/marketing-shared";
import type { MarketingBrandConfig, MarketingDbAdapter } from "./index.js";
import { buildResponsiveEmailHtml, createMarketingKit, renderMarkdownToHtmlAndToc, verifySvixSignature } from "./index.js";

function sqliteDb(): MarketingDbAdapter {
  const db = new DatabaseSync(":memory:");
  return {
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...(params as any[]));
      return { changes: Number(r.changes) };
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...(params as any[])) as any;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...(params as any[])) as any;
    },
  };
}

const brand: MarketingBrandConfig = {
  tenantId: "legalai",
  name: "LexIt",
  domain: "lexit.legal",
  tagline: "Legal help that starts free",
  brandVoice: "Plain, calm, precise",
  primaryColor: "#173b7a",
  accentColor: "#f59e0b",
  signupUrl: "/auth?mode=register",
  pricingSummary: "First matter free; $29 per matter to unlock documents",
  coreFeatures: ["Matter workspace with research", "Document drafting", "Citation checks"],
  targetAudiences: ["individuals", "attorneys"],
  contactEmail: "support@lexit.legal",
};

const longBody = `## Why it matters\n\n${"Clear facts win arguments. ".repeat(30)}\n\n## What to do\n\n- Gather documents\n- Check deadlines\n\n## How LexIt helps\n\nUse [pricing](/pricing) and [bad](javascript:alert(1)).`;

const fakeLlm = {
  calls: 0,
  async complete({ system, user }: { system: string; user: string }) {
    fakeLlm.calls += 1;
    if (system.includes("Marketing Copilot")) {
      return JSON.stringify({
        reply: "Write about **citation checks**.",
        actions: [{ kind: "blog_batch", title: "Citation series", seedTopics: ["How to check citations"], count: 1, audience: "attorney" }],
      });
    }
    if (system.includes("edit one section")) {
      return JSON.stringify({ sectionMarkdown: "## What to do\n\nRewritten section body with a checklist." });
    }
    if (system.includes("lifecycle email copywriter")) {
      return JSON.stringify({
        name: "Unlock nudge",
        subject: "Finish {{matterTitle}}",
        preheader: "Your research is saved",
        headline: "Your documents are waiting",
        bodyMarkdown: "Hi {{firstName}},\n\nLex proposed:\n\n{{proposedDocsList}}\n\nUnlock to draft them.",
        ctaLabel: "Unlock",
        ctaUrl: "{{unlockUrl}}",
        artworkPrompt: "folder",
        bannerKicker: "Your matter",
      });
    }
    if (system.includes("SEO content strategist")) {
      return JSON.stringify({ ideas: [{ title: "Generated idea", kicker: "Guide", angle: "x", targetKeywords: ["k"], audience: "general" }] });
    }
    if (system.includes("studio card")) return JSON.stringify({ calloutTitle: "Refined", palette: "emerald" });
    const topic = /Topic: (.*)/.exec(user)?.[1] || "Topic";
    return JSON.stringify({
      title: topic,
      slug: topic,
      kicker: "Guide",
      excerpt: "Short excerpt",
      seoTitle: `${topic} | LexIt`,
      seoDescription: "Desc",
      targetKeywords: ["citations"],
      audience: "attorney",
      bodyMarkdown: longBody,
      faqItems: [{ question: "Is LexIt a law firm?", answer: "No." }],
      ctaLabel: "Start free",
      ctaUrl: "/auth?mode=register",
      artworkPrompt: "desk",
    });
  },
};

const sent: Array<{ to: string; subject: string; html: string; headers?: Record<string, string> }> = [];
const contacts: MarketingContact[] = [
  { id: "u1", tenantId: "legalai", email: "a@example.com", firstName: "Ana", name: "Ana B", planTier: "free", lifecycleState: "locked", marketingOptIn: true, unsubscribeToken: "", matterTitle: "Ana v. <Landlord>", proposedDocsList: "- Answer\n- Motion", unlockUrl: "https://lexit.legal/cases/1?unlock=1" },
  { id: "u2", tenantId: "legalai", email: "B@Example.com", firstName: "Bo", name: "Bo C", planTier: "free", lifecycleState: "locked", marketingOptIn: true, unsubscribeToken: "" },
  { id: "u3", tenantId: "legalai", email: "optout@example.com", firstName: "No", name: "No", planTier: "free", lifecycleState: "locked", marketingOptIn: false, unsubscribeToken: "" },
];

const WEBHOOK_SECRET = `whsec_${Buffer.from("super-secret-key").toString("base64")}`;
let server: Server;
let base = "";
let adminCookie = true;
const kit = createMarketingKit({
  tenantId: "legalai",
  db: sqliteDb(),
  brand,
  brandsByTenant: { legalai: brand, lalia: { ...brand, tenantId: "lalia", name: "Lalia", domain: "lalia.cloud" } },
  llm: fakeLlm,
  imageGen: {
    async generateImage() {
      return { data: Buffer.from("PNGDATA"), contentType: "image/png" };
    },
  },
  email: {
    async sendEmail(m) {
      sent.push(m);
      return { status: "sent", providerMessageId: `msg_${sent.length}` };
    },
    async sendBatch(ms) {
      return ms.map((m) => {
        sent.push(m);
        return { to: m.to, status: "sent" as const, providerMessageId: `msg_${sent.length}` };
      });
    },
  },
  resolveUser: () => (adminCookie ? { id: "admin", role: "admin", email: "admin@lexit.legal" } : null),
  opsKeys: () => ["ops-secret"],
  listSegments: async () => [{ id: "free_matter_locked", label: "Free matter locked", description: "", count: contacts.length }],
  resolveSegmentContacts: async () => contacts,
  resendWebhookSecret: async () => WEBHOOK_SECRET,
  logger: { info() {}, warn() {}, error() {} },
});

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/marketing${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function waitForJob(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const r = await api("GET", `/blog/jobs/${jobId}`);
    if (r.json?.job?.status !== "running") return r.json.job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job timeout");
}

before(async () => {
  server = createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/marketing")) {
      req.url = url.slice("/marketing".length) || "/";
      return void kit.handler(req, res);
    }
    if (url === "/blog") return void kit.publicHandlers.blogIndex(req, res);
    if (url === "/sitemap.xml") return void kit.publicHandlers.sitemap(req, res);
    if (url.startsWith("/blog/")) return void kit.publicHandlers.blogPost(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => server.close());

describe("marketing-kit router", () => {
  it("rejects unauthenticated admin calls and accepts ops keys", async () => {
    adminCookie = false;
    assert.equal((await api("GET", "/blog/posts")).status, 401);
    assert.equal((await api("GET", "/blog/posts", undefined, { "X-Ops-Key": "wrong" })).status, 401);
    assert.equal((await api("GET", "/blog/posts", undefined, { "X-Ops-Key": "ops-secret" })).status, 200);
    adminCookie = true;
  });

  it("copilot returns grounded reply with one-click actions", async () => {
    const r = await api("POST", "/copilot/chat", { message: "What should we write about citations?" });
    assert.equal(r.status, 200);
    assert.match(r.json.message.content, /citation/);
    assert.equal(r.json.message.suggestedActions[0].kind, "blog_batch");
    const history = await api("GET", "/copilot/messages");
    assert.equal(history.json.messages.length, 2);
  });

  let postId = "";
  let slug = "";
  it("generates a blog batch with SEO fields and stored artwork", async () => {
    const r = await api("POST", "/blog/generate-batch", { topics: ["Catch bad citations", "Draft from the record"], audience: "attorney" });
    assert.equal(r.status, 202);
    const job = await waitForJob(r.json.job.id);
    assert.equal(job.completed, 2);
    const list = await api("GET", "/blog/posts");
    const post = list.json.posts.find((p: any) => p.title === "Catch bad citations");
    assert.ok(post);
    assert.equal(post.status, "draft");
    assert.equal(post.slug, "catch-bad-citations");
    assert.equal(post.seoTitle, "Catch bad citations | LexIt");
    assert.deepEqual(post.targetKeywords, ["citations"]);
    assert.match(post.heroImageUrl, /^\/marketing\/media\/asset_.+\.png$/);
    const media = await fetch(`${base}${post.heroImageUrl}`);
    assert.equal(media.headers.get("content-type"), "image/png");
    assert.equal(await media.text(), "PNGDATA");
    postId = post.id;
    slug = post.slug;
  });

  it("keeps drafts off the public blog until published", async () => {
    assert.equal((await fetch(`${base}/blog/${slug}`)).status, 404);
    const preview = await api("GET", `/blog/posts/${postId}/preview`);
    assert.equal(preview.status, 200);
    assert.match(preview.text, /noindex/);
  });

  it("rewrites a single section and records a revision", async () => {
    const r = await api("POST", `/blog/posts/${postId}/rewrite`, { instruction: "Add a checklist", sectionHeading: "What to do" });
    assert.equal(r.status, 200);
    assert.match(r.json.post.bodyMarkdown, /Rewritten section body/);
    assert.match(r.json.post.bodyMarkdown, /## Why it matters/);
    const detail = await api("GET", `/blog/posts/${postId}`);
    assert.ok(detail.json.revisions.length >= 1);
  });

  it("regenerates studio-card artwork from a custom instruction", async () => {
    const r = await api("POST", `/blog/posts/${postId}/artwork`, { mode: "studio_card", instruction: "use emerald" });
    assert.equal(r.status, 200);
    assert.equal(r.json.post.artworkMode, "studio_card");
    assert.equal(r.json.post.studioCardSpec.calloutTitle, "Refined");
    assert.match(r.json.post.heroImageUrl, /\.svg$/);
  });

  it("publishes and renders SSR blog, post JSON-LD, and sitemap", async () => {
    const pub = await api("POST", `/blog/posts/${postId}/publish`, {});
    assert.equal(pub.json.post.status, "published");
    const index = await (await fetch(`${base}/blog`)).text();
    assert.match(index, /Catch bad citations/);
    const page = await (await fetch(`${base}/blog/${slug}`)).text();
    assert.match(page, /"@type":\s*"Article"/);
    assert.match(page, /FAQPage/);
    assert.doesNotMatch(page, /javascript:alert/);
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, new RegExp(`/blog/${slug}`));
    const missing = await fetch(`${base}/blog/no-such-article`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Article not found/);
  });

  let campaignId = "";
  it("drafts a personalized responsive campaign with banner art", async () => {
    const r = await api("POST", "/email/campaigns", { segmentId: "free_matter_locked", goal: "Nudge unlocks" });
    assert.equal(r.status, 200);
    campaignId = r.json.campaign.id;
    assert.match(r.json.campaign.bannerImageUrl, /\/marketing\/media\//);
    const preview = await api("GET", `/email/campaigns/${campaignId}/preview`);
    assert.match(preview.text, /Ana v\. &lt;Landlord&gt;/);
    assert.match(preview.text, /<li style="margin:0 0 6px;">Answer<\/li>/);
    assert.match(preview.text, /max-width:600px/);
  });

  it("refines layout from an instruction", async () => {
    const r = await api("POST", `/email/campaigns/${campaignId}/refine`, { target: "layout", instruction: "make it minimal" });
    assert.equal(r.json.campaign.layout, "minimal");
  });

  it("test-sends to the admin", async () => {
    const before = sent.length;
    const r = await api("POST", `/email/campaigns/${campaignId}/test-send`, {});
    assert.equal(r.status, 200);
    assert.equal(sent[before].to, "admin@lexit.legal");
    assert.match(sent[before].subject, /^\[Test\]/);
  });

  it("requires approval, then batch-sends with List-Unsubscribe and suppression", async () => {
    assert.equal((await api("POST", `/email/campaigns/${campaignId}/send`, {})).status, 409);
    await api("POST", `/email/campaigns/${campaignId}/approve`, {});
    const before = sent.length;
    const r = await api("POST", `/email/campaigns/${campaignId}/send`, {});
    assert.equal(r.status, 202);
    for (let i = 0; i < 50; i++) {
      const c = await api("GET", `/email/campaigns/${campaignId}`);
      if (c.json.campaign.status === "sent") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const batch = sent.slice(before);
    assert.deepEqual(batch.map((m) => m.to).sort(), ["a@example.com", "b@example.com"]);
    assert.match(batch[0].headers!["List-Unsubscribe"], /\/marketing\/unsubscribe\?token=/);
    assert.equal(batch[0].headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.equal((await api("POST", `/email/campaigns/${campaignId}/send`, { confirm: true })).status, 409);
  });

  it("verifies Resend webhooks and records opens idempotently", async () => {
    const payload = JSON.stringify({ type: "email.opened", data: { email_id: "msg_2" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(WEBHOOK_SECRET.slice(6), "base64");
    const sig = createHmac("sha256", key).update(`evt_1.${ts}.${payload}`).digest("base64");
    const bad = await fetch(`${base}/marketing/webhooks/resend`, { method: "POST", headers: { "svix-id": "evt_1", "svix-timestamp": ts, "svix-signature": "v1,bad" }, body: payload });
    assert.equal(bad.status, 401);
    for (let i = 0; i < 2; i++) {
      const ok = await fetch(`${base}/marketing/webhooks/resend`, { method: "POST", headers: { "svix-id": "evt_1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` }, body: payload });
      assert.equal(ok.status, 200);
    }
    const c = await api("GET", `/email/campaigns/${campaignId}`);
    assert.equal(c.json.campaign.openedCount, 1);
  });

  it("one-click unsubscribe suppresses future sends", async () => {
    const msg = sent.find((m) => m.to === "a@example.com" && m.headers)!;
    const url = /<([^>]+)>/.exec(msg.headers!["List-Unsubscribe"])![1];
    const path = new URL(url).pathname + new URL(url).search;
    const page = await fetch(`${base}${path}`);
    assert.match(await page.text(), /<form method="post"/);
    const done = await fetch(`${base}${path}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    assert.equal(done.status, 200);
    const preview = await api("POST", "/segments/preview", { segmentId: "free_matter_locked" });
    assert.equal(preview.json.count, 1);
    const c = await api("GET", `/email/campaigns/${campaignId}`);
    assert.equal(c.json.campaign.unsubscribedCount, 1);
  });

  it("scopes data per tenant and supports the all-tenant overview", async () => {
    const lalia = await api("GET", "/t/lalia/blog/posts");
    assert.equal(lalia.json.posts.length, 0);
    const all = await api("GET", "/t/all/overview");
    assert.equal(all.json.overview.publishedPosts, 1);
    assert.equal((await api("POST", "/t/all/blog/generate-batch", { topics: ["x"] })).status, 400);
    assert.equal((await api("GET", "/t/nope/blog/posts")).status, 404);
  });

  it("schedules a campaign and the scheduler sends it when due", async () => {
    const r = await api("POST", "/email/campaigns", { segmentId: "free_matter_locked", goal: "Second" });
    const id = r.json.campaign.id;
    await api("POST", `/email/campaigns/${id}/approve`, {});
    const sched = await api("POST", `/email/campaigns/${id}/send`, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(sched.json.campaign.status, "scheduled");
    await kit.store.updateCampaign("legalai", id, { scheduledAt: new Date(Date.now() - 1000).toISOString() });
    const result = await kit.runScheduledWork();
    assert.equal(result.campaignsSent, 1);
    assert.equal((await kit.store.getCampaign("legalai", id))!.status, "sent");
  });
});

describe("generation resilience", () => {
  it("falls back to a template draft when the LLM hangs", async () => {
    const hung = createMarketingKit({
      tenantId: "legalai",
      db: sqliteDb(),
      brand,
      llm: { complete: () => new Promise<string>(() => {}) },
      llmTimeoutMs: 30,
      resolveUser: () => ({ id: "admin", role: "admin" }),
      logger: { info() {}, warn() {}, error() {} },
    });
    const srv = createServer((req, res) => void hung.handler(req, res));
    await new Promise<void>((resolve) => srv.listen(0, resolve));
    const port = (srv.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/blog/generate-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: ["Answering a small claims case"], count: 1 }),
      });
      assert.equal(res.status, 202);
      const { job } = (await res.json()) as any;
      let status = "running";
      for (let i = 0; i < 100 && status === "running"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        status = ((await (await fetch(`http://127.0.0.1:${port}/blog/jobs/${job.id}`)).json()) as any).job.status;
      }
      assert.equal(status, "completed");
      const post = await hung.store.getPost("legalai", job.postIds[0]);
      assert.equal(post!.status, "draft");
      assert.match(post!.generationError || "", /timed out/);
      assert.ok(post!.bodyMarkdown.length > 200);
    } finally {
      srv.close();
    }
  });

  it("recovers drafts stuck in generating after a restart", async () => {
    const db = sqliteDb();
    const k = createMarketingKit({ tenantId: "legalai", db, brand, llm: fakeLlm, logger: { info() {}, warn() {}, error() {} } });
    await k.ensureSchema();
    const stuck = await k.store.createPost("legalai", { title: "Orphaned draft", status: "generating" });
    const fresh = await k.store.createPost("legalai", { title: "Fresh draft", status: "generating" });
    await db.run(`UPDATE mkt_posts SET updated_at = ? WHERE id = ?`, ["2020-01-01T00:00:00.000Z", stuck.id]);
    await k.runScheduledWork();
    const recovered = await k.store.getPost("legalai", stuck.id);
    assert.equal(recovered!.status, "draft");
    assert.match(recovered!.generationError || "", /interrupted/);
    assert.equal((await k.store.getPost("legalai", fresh.id))!.status, "generating");
  });
});

describe("renderers", () => {
  it("strips unsafe link schemes", () => {
    const { html } = renderMarkdownToHtmlAndToc("[x](javascript:alert(1)) [y](/pricing)");
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /href="\/pricing"/);
  });

  it("renders a table banner when no image exists and absolutizes links", () => {
    const html = buildResponsiveEmailHtml({ brand, subject: "S", preheader: "P", headline: "H", bodyMarkdown: "See [pricing](/pricing)", ctaLabel: "Go", ctaUrl: "/x", bannerImageUrl: null });
    assert.match(html, /background-color:#0c1931;background-image:linear-gradient/);
    assert.match(html, /href="https:\/\/lexit\.legal\/pricing"/);
    assert.match(html, /href="https:\/\/lexit\.legal\/x"/);
  });

  it("rejects stale svix timestamps", () => {
    assert.equal(verifySvixSignature({ secret: WEBHOOK_SECRET, id: "a", timestamp: "1", signatureHeader: "v1,x", payload: "{}" }), false);
  });
});
