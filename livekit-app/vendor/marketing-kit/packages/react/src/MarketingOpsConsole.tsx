import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AudienceSegmentInfo,
  BlogGenerationJob,
  CopilotIdeaAction,
  CopilotMessage,
  EmailCampaign,
  EmailLayout,
  MarketingArtworkAsset,
  MarketingOverview,
  MarketingPost,
  MarketingPostRevision,
  MarketingProductContextSnapshot,
} from "@rhule/marketing-shared";

export interface MarketingTenantOption {
  id: string;
  label: string;
}

export interface MarketingOpsConsoleProps {
  /** Base URL of the marketing router, e.g. `/marketing` or `/api/v1/marketing`. */
  apiBase: string;
  /** When provided, a tenant selector is shown and requests go to `${apiBase}/t/<tenant>`. */
  tenants?: MarketingTenantOption[];
  defaultTenantId?: string;
  /** Origin used to resolve relative media URLs per tenant (needed when the console runs on another domain). */
  assetOrigins?: Record<string, string>;
  /** Public site origin per tenant, used for "View live" links. */
  publicOrigins?: Record<string, string>;
  getAccessToken?: () => string | null | undefined;
  className?: string;
}

type Tab = "copilot" | "blog" | "email" | "audiences" | "analytics";

const C = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  surface: "#f8fafc",
  primary: "#173b7a",
  accent: "#2563eb",
  good: "#047857",
  warn: "#b45309",
  bad: "#b91c1c",
};

const card: CSSProperties = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 };
const label: CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: "9px 11px",
  fontSize: 14,
  fontFamily: "inherit",
  color: C.ink,
  background: "#fff",
};
const sectionTitle: CSSProperties = { margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: C.ink };

function btn(kind: "primary" | "secondary" | "ghost" | "danger" = "secondary", small = false): CSSProperties {
  const base: CSSProperties = {
    border: "1px solid transparent",
    borderRadius: 10,
    padding: small ? "6px 10px" : "9px 14px",
    fontSize: small ? 12 : 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };
  if (kind === "primary") return { ...base, background: C.primary, color: "#fff" };
  if (kind === "danger") return { ...base, background: "#fff", color: C.bad, borderColor: "#fecaca" };
  if (kind === "ghost") return { ...base, background: "transparent", color: C.accent };
  return { ...base, background: "#fff", color: C.ink, borderColor: C.line };
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  generating: { bg: "#e0e7ff", fg: "#3730a3" },
  draft: { bg: "#f1f5f9", fg: "#334155" },
  approved: { bg: "#dcfce7", fg: "#166534" },
  scheduled: { bg: "#fef3c7", fg: "#92400e" },
  published: { bg: "#d1fae5", fg: "#065f46" },
  archived: { bg: "#f1f5f9", fg: "#94a3b8" },
  sending: { bg: "#e0e7ff", fg: "#3730a3" },
  sent: { bg: "#d1fae5", fg: "#065f46" },
  failed: { bg: "#fee2e2", fg: "#991b1b" },
};

function Badge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>
      {status}
    </span>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal markdown for chat bubbles: bold, inline code, bullet lists, paragraphs. */
function miniMarkdown(md: string): string {
  const lines = escapeHtml(md || "").split(/\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const inline = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const li = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (li) {
      if (!inList) out.push('<ul style="margin:6px 0;padding-left:18px">');
      inList = true;
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(`<div style="font-weight:700;margin:8px 0 4px">${inline(h[1])}</div>`);
    else if (line) out.push(`<p style="margin:0 0 8px">${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function MarketingOpsConsole(props: MarketingOpsConsoleProps) {
  const { apiBase, tenants, assetOrigins = {}, publicOrigins = {}, getAccessToken, className } = props;
  const multiTenant = Boolean(tenants && tenants.length);
  const [tenant, setTenant] = useState<string>(props.defaultTenantId || (multiTenant ? tenants![0].id : ""));
  const [tab, setTab] = useState<Tab>(multiTenant && (props.defaultTenantId || tenants![0].id) === "all" ? "analytics" : "copilot");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [context, setContext] = useState<{ context: MarketingProductContextSnapshot; capabilities: { imageGen: boolean; email: boolean; codebase: string | null } } | null>(null);
  const [segments, setSegments] = useState<AudienceSegmentInfo[]>([]);
  const [focusPostId, setFocusPostId] = useState<string | null>(null);
  const [focusCampaignId, setFocusCampaignId] = useState<string | null>(null);
  const [emailPrefill, setEmailPrefill] = useState<{ segmentId?: string; goal?: string; filter?: Record<string, unknown> } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const base = useMemo(() => {
    const root = apiBase.replace(/\/$/, "");
    return multiTenant && tenant ? `${root}/t/${tenant}` : root;
  }, [apiBase, multiTenant, tenant]);
  const isAll = multiTenant && tenant === "all";
  const assetOrigin = (assetOrigins[tenant] || "").replace(/\/$/, "");
  const publicOrigin = (publicOrigins[tenant] || (!multiTenant && typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  const resolveAsset = useCallback((url?: string | null) => (url && url.startsWith("/") ? `${assetOrigin}${url}` : url || ""), [assetOrigin]);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
      const token = getAccessToken?.()?.trim();
      const { json, headers, ...rest } = init;
      const res = await fetch(`${base}${path}`, {
        credentials: "include",
        ...rest,
        method: rest.method || (json !== undefined ? "POST" : "GET"),
        headers: {
          Accept: "application/json",
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...((headers as Record<string, string>) || {}),
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
      const ct = res.headers.get("content-type") || "";
      const data: any = ct.includes("json") ? await res.json().catch(() => ({})) : await res.text();
      if (!res.ok) throw new Error((data && typeof data === "object" && data.error) || `Request failed (${res.status})`);
      return data as T;
    },
    [base, getAccessToken],
  );

  const notify = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4500);
  }, []);

  useEffect(() => {
    if (isAll) {
      setContext(null);
      setSegments([]);
      return;
    }
    let cancelled = false;
    call<any>("/context")
      .then((r) => !cancelled && setContext(r))
      .catch(() => !cancelled && setContext(null));
    call<{ segments: AudienceSegmentInfo[] }>("/segments")
      .then((r) => !cancelled && setSegments(r.segments))
      .catch(() => !cancelled && setSegments([]));
    return () => {
      cancelled = true;
    };
  }, [call, isAll, refreshKey]);

  const runAction = useCallback(
    async (action: CopilotIdeaAction) => {
      try {
        if (action.kind === "blog_batch") {
          const r = await call<{ job: BlogGenerationJob; posts: MarketingPost[] }>("/blog/generate-batch", {
            json: { topics: action.seedTopics, count: action.count || action.seedTopics?.length || 3, audience: action.audience || "general" },
          });
          notify("ok", `Generating ${r.posts.length} draft${r.posts.length === 1 ? "" : "s"}…`);
          setFocusPostId(r.posts[0]?.id || null);
          setTab("blog");
        } else {
          notify("ok", "Drafting campaign…");
          const r = await call<{ campaign: EmailCampaign; warning?: string }>("/email/campaigns", {
            json: { segmentId: action.segmentId, goal: action.campaignGoal || action.title, instruction: action.subjectHint ? `Subject idea: ${action.subjectHint}` : undefined },
          });
          if (r.warning) notify("err", r.warning);
          setFocusCampaignId(r.campaign.id);
          setTab("email");
        }
        setRefreshKey((k) => k + 1);
      } catch (err: any) {
        notify("err", err.message);
      }
    },
    [call, notify],
  );

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "copilot", label: "Copilot" },
    { id: "blog", label: "Blog Studio" },
    { id: "email", label: "Email Studio" },
    { id: "audiences", label: "Audiences" },
    { id: "analytics", label: "Analytics" },
  ];

  return (
    <div className={className} data-testid="marketing-ops-console" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: C.ink }}>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 18px", background: "linear-gradient(135deg,#0c1931 0%,#173b7a 100%)", color: "#fff" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "Georgia,serif" }}>Marketing &amp; SEO</div>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>
              {isAll ? "Portfolio overview across all apps" : context ? `${context.context.productName} · ${context.context.domain}` : "Loading product context…"}
              {context && !isAll && (
                <span style={{ marginLeft: 8 }}>
                  · Images {context.capabilities.imageGen ? "AI" : "studio cards"} · Email {context.capabilities.email ? "Resend" : "not configured"}
                </span>
              )}
            </div>
          </div>
          {multiTenant && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="marketing-tenant-selector">
              {tenants!.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTenant(t.id);
                    setFocusPostId(null);
                    setFocusCampaignId(null);
                    if (t.id === "all") setTab("analytics");
                  }}
                  style={{
                    ...btn("secondary", true),
                    background: tenant === t.id ? "#fff" : "rgba(255,255,255,0.08)",
                    color: tenant === t.id ? C.primary : "#e2e8f0",
                    borderColor: "rgba(255,255,255,0.25)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.line}`, padding: "0 10px", overflowX: "auto", background: "#fff" }}>
          {tabs.map((t) => {
            const disabled = isAll && t.id !== "analytics";
            return (
              <button
                key={t.id}
                data-testid={`marketing-tab-${t.id}`}
                disabled={disabled}
                onClick={() => setTab(t.id)}
                style={{
                  border: 0,
                  background: "transparent",
                  padding: "12px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  color: disabled ? "#cbd5e1" : tab === t.id ? C.primary : C.muted,
                  borderBottom: `2px solid ${tab === t.id ? C.primary : "transparent"}`,
                  fontFamily: "inherit",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ padding: 16, background: C.surface }}>
          {tab === "copilot" && !isAll && <CopilotPanel call={call} context={context?.context || null} onAction={runAction} notify={notify} />}
          {tab === "blog" && !isAll && (
            <BlogStudio call={call} notify={notify} resolveAsset={resolveAsset} publicOrigin={publicOrigin} focusId={focusPostId} onFocus={setFocusPostId} refreshKey={refreshKey} assetOrigin={assetOrigin} apiRoot={base} />
          )}
          {tab === "email" && !isAll && (
            <EmailStudio
              call={call}
              notify={notify}
              segments={segments}
              focusId={focusCampaignId}
              onFocus={setFocusCampaignId}
              refreshKey={refreshKey}
              prefill={emailPrefill}
              clearPrefill={() => setEmailPrefill(null)}
              assetOrigin={assetOrigin}
              emailEnabled={Boolean(context?.capabilities.email)}
            />
          )}
          {tab === "audiences" && !isAll && (
            <AudiencesPanel
              call={call}
              segments={segments}
              onDraft={(p) => {
                setEmailPrefill(p);
                setFocusCampaignId(null);
                setTab("email");
              }}
            />
          )}
          {tab === "analytics" && <AnalyticsPanel call={call} isAll={isAll} tenants={tenants} apiBase={apiBase} getAccessToken={getAccessToken} />}
        </div>
      </div>
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 60,
            maxWidth: 420,
            padding: "12px 16px",
            borderRadius: 12,
            background: toast.kind === "ok" ? "#0c1931" : "#7f1d1d",
            color: "#fff",
            fontSize: 13,
            boxShadow: "0 10px 30px rgba(15,23,42,0.25)",
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

type CallFn = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
type NotifyFn = (kind: "ok" | "err", text: string) => void;

// ---------------------------------------------------------------- Copilot

function CopilotPanel({ call, context, onAction, notify }: { call: CallFn; context: MarketingProductContextSnapshot | null; onAction: (a: CopilotIdeaAction) => Promise<void>; notify: NotifyFn }) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    call<{ messages: CopilotMessage[] }>("/copilot/messages")
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]));
  }, [call]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    const optimistic: CopilotMessage = { id: `tmp_${Date.now()}`, tenantId: "", role: "user", content: message, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await call<{ userMessage: CopilotMessage; message: CopilotMessage }>("/copilot/chat", { json: { message } });
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), r.userMessage, r.message]);
    } catch (err: any) {
      notify("err", err.message);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(message);
    } finally {
      setBusy(false);
    }
  };

  const starters = [
    "What should we blog about this month based on support gaps?",
    "Draft a campaign to free users who haven't unlocked their matter",
    "Which recent product changes deserve a launch email?",
    "Plan an SEO cluster for attorneys about citation checking",
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16 }} data-testid="marketing-copilot">
      <div style={{ ...card, display: "flex", flexDirection: "column", height: 620, padding: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Marketing Copilot</div>
            <div style={{ fontSize: 12, color: C.muted }}>Grounded in the codebase, pricing, support gaps, and live metrics</div>
          </div>
          {messages.length > 0 && (
            <button
              style={btn("ghost", true)}
              onClick={async () => {
                await call("/copilot/messages", { method: "DELETE" });
                setMessages([]);
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", maxWidth: 460 }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Turn any idea into content</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Ask for ideas, then turn any suggestion into a blog batch or an email campaign with one click. Nothing publishes or sends without your approval.</div>
              <div style={{ display: "grid", gap: 8 }}>
                {starters.map((s) => (
                  <button key={s} onClick={() => send(s)} style={{ ...btn("secondary"), justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                  lineHeight: 1.55,
                  background: m.role === "user" ? C.primary : "#fff",
                  color: m.role === "user" ? "#fff" : C.ink,
                  border: m.role === "user" ? "none" : `1px solid ${C.line}`,
                }}
                dangerouslySetInnerHTML={{ __html: miniMarkdown(m.content) }}
              />
              {m.suggestedActions && m.suggestedActions.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {m.suggestedActions.map((a, i) => {
                    const key = `${m.id}_${i}`;
                    return (
                      <div key={key} style={{ ...card, padding: 12, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", borderColor: a.kind === "blog_batch" ? "#bfdbfe" : "#fde68a" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: a.kind === "blog_batch" ? "#1d4ed8" : "#b45309", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {a.kind === "blog_batch" ? `Blog batch · ${a.count || a.seedTopics?.length || 3} posts` : `Email · ${a.segmentId}`}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</div>
                          {a.description && <div style={{ fontSize: 12, color: C.muted }}>{a.description}</div>}
                          {a.seedTopics && a.seedTopics.length > 1 && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{a.seedTopics.join(" · ")}</div>}
                        </div>
                        <button
                          style={btn("primary", true)}
                          disabled={runningAction === key}
                          data-testid="copilot-action-run"
                          onClick={async () => {
                            setRunningAction(key);
                            await onAction(a);
                            setRunningAction(null);
                          }}
                        >
                          {runningAction === key ? "Working…" : a.kind === "blog_batch" ? "Generate posts" : "Draft email"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {m.codebaseSources && m.codebaseSources.length > 0 && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Sources: {m.codebaseSources.slice(0, 4).join(", ")}</div>}
            </div>
          ))}
          {busy && <div style={{ fontSize: 13, color: C.muted }}>Copilot is thinking…</div>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${C.line}` }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about positioning, topics, launches, or campaigns…" style={input} data-testid="copilot-input" />
          <button type="submit" style={btn("primary")} disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      </div>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <div style={card}>
          <h4 style={sectionTitle}>Product context</h4>
          {!context && <div style={{ fontSize: 13, color: C.muted }}>Loading…</div>}
          {context && (
            <div style={{ fontSize: 12, color: "#334155", display: "grid", gap: 10 }}>
              <div>
                <strong>{context.productName}</strong> — {context.tagline}
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Pricing</div>
                {context.pricingSummary}
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Features</div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {context.coreFeatures.slice(0, 6).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
              {context.liveMetrics && Object.keys(context.liveMetrics).length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Live metrics</div>
                  {Object.entries(context.liveMetrics).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.muted }}>{k.replace(/_/g, " ")}</span>
                      <strong>{String(v)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {context?.supportKnowledgeGaps && context.supportKnowledgeGaps.length > 0 && (
          <div style={card}>
            <h4 style={sectionTitle}>Support gaps → content</h4>
            <div style={{ display: "grid", gap: 6 }}>
              {context.supportKnowledgeGaps.slice(0, 6).map((g) => (
                <button key={g} onClick={() => send(`Turn this unanswered support question into content: "${g}"`)} style={{ ...btn("secondary", true), whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start" }}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
        {context?.recentCommitsOrChanges && context.recentCommitsOrChanges.length > 0 && (
          <div style={card}>
            <h4 style={sectionTitle}>Recent product changes</h4>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#334155" }}>
              {context.recentCommitsOrChanges.slice(0, 6).map((c) => (
                <li key={c} style={{ marginBottom: 4 }}>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Blog Studio

type PostDetail = { post: MarketingPost; revisions: MarketingPostRevision[]; assets: MarketingArtworkAsset[]; sections: string[] };

function BlogStudio({
  call,
  notify,
  resolveAsset,
  publicOrigin,
  focusId,
  onFocus,
  refreshKey,
  assetOrigin,
  apiRoot,
}: {
  call: CallFn;
  notify: NotifyFn;
  resolveAsset: (u?: string | null) => string;
  publicOrigin: string;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  refreshKey: number;
  assetOrigin: string;
  apiRoot: string;
}) {
  const coverUrl = (slug: string) => `${apiRoot}/blog/${encodeURIComponent(slug)}/cover.png`;
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [topics, setTopics] = useState("");
  const [count, setCount] = useState(3);
  const [audience, setAudience] = useState<"general" | "individual" | "attorney">("general");
  const [artworkMode, setArtworkMode] = useState<"ai_illustration" | "studio_card">("ai_illustration");
  const [instruction, setInstruction] = useState("");
  const [ideas, setIdeas] = useState<Array<{ title: string; kicker: string; angle: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call<{ posts: MarketingPost[] }>(`/blog/posts${filter ? `?status=${filter}` : ""}`);
    setPosts(r.posts);
    return r.posts;
  }, [call, filter]);

  const loadDetail = useCallback(
    async (id: string) => {
      const r = await call<PostDetail>(`/blog/posts/${id}`);
      setDetail(r);
    },
    [call],
  );

  useEffect(() => {
    void load().catch((e) => notify("err", e.message));
  }, [load, refreshKey, notify]);

  useEffect(() => {
    if (focusId) void loadDetail(focusId).catch(() => setDetail(null));
    else setDetail(null);
  }, [focusId, loadDetail]);

  const generating = posts.some((p) => p.status === "generating") || detail?.post.status === "generating" || detail?.post.artworkStatus === "generating";
  useEffect(() => {
    if (!generating) return;
    const t = window.setInterval(() => {
      void load();
      if (focusId) void loadDetail(focusId);
    }, 2500);
    return () => window.clearInterval(t);
  }, [generating, load, loadDetail, focusId]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err: any) {
      notify("err", err.message);
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    act("generate", async () => {
      const list = topics.split("\n").map((t) => t.trim()).filter(Boolean);
      const r = await call<{ posts: MarketingPost[] }>("/blog/generate-batch", {
        json: { topics: list, count: Math.max(count, list.length ? Math.min(list.length, 12) : count), audience, artworkMode, instruction: instruction || undefined },
      });
      notify("ok", `Generating ${r.posts.length} draft${r.posts.length === 1 ? "" : "s"}. They appear below as they finish.`);
      setTopics("");
      setIdeas([]);
      await load();
      onFocus(r.posts[0]?.id || null);
    });

  const post = detail?.post;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr)", gap: 16 }} data-testid="marketing-blog-studio">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, alignContent: "start", minWidth: 0 }}>
        <div style={card}>
          <h4 style={sectionTitle}>Generate a batch</h4>
          <label style={label}>Topics (one per line, optional)</label>
          <textarea value={topics} onChange={(e) => setTopics(e.target.value)} rows={4} placeholder="Leave blank to let Copilot pick topics" style={{ ...input, resize: "vertical" }} />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginTop: 10 }}>
            <div>
              <label style={label}>Posts</label>
              <input type="number" min={1} max={12} value={count} onChange={(e) => setCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} style={input} />
            </div>
            <div>
              <label style={label}>Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value as any)} style={input}>
                <option value="general">General</option>
                <option value="individual">Individuals</option>
                <option value="attorney">Attorneys</option>
              </select>
            </div>
          </div>
          <label style={{ ...label, marginTop: 10 }}>Artwork</label>
          <div style={{ display: "flex", gap: 6 }}>
            {(["ai_illustration", "studio_card"] as const).map((m) => (
              <button key={m} onClick={() => setArtworkMode(m)} style={{ ...btn(artworkMode === m ? "primary" : "secondary", true), flex: 1, justifyContent: "center" }}>
                {m === "ai_illustration" ? "AI illustration" : "Studio card"}
              </button>
            ))}
          </div>
          <label style={{ ...label, marginTop: 10 }}>Instructions</label>
          <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Focus on Texas tenants, warm tone" style={input} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={{ ...btn("primary"), flex: 1, justifyContent: "center" }} onClick={generate} disabled={busy === "generate"} data-testid="blog-generate">
              {busy === "generate" ? "Starting…" : `Generate ${Math.max(count, topics.split("\n").filter((t) => t.trim()).length)} drafts`}
            </button>
            <button
              style={btn("secondary")}
              disabled={busy === "ideas"}
              onClick={() =>
                act("ideas", async () => {
                  const r = await call<{ ideas: Array<{ title: string; kicker: string; angle: string }> }>("/blog/ideas", { json: { count: 6, audience, theme: instruction } });
                  setIdeas(r.ideas);
                })
              }
            >
              {busy === "ideas" ? "…" : "Ideas"}
            </button>
          </div>
          {ideas.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              {ideas.map((i) => (
                <button
                  key={i.title}
                  onClick={() => setTopics((t) => (t.includes(i.title) ? t : `${t ? `${t}\n` : ""}${i.title}`))}
                  style={{ ...btn("secondary", true), whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start", display: "block" }}
                >
                  <div style={{ fontWeight: 700 }}>+ {i.title}</div>
                  <div style={{ fontWeight: 400, color: C.muted }}>{i.angle}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ ...card, padding: 0 }}>
          <div style={{ display: "flex", gap: 4, padding: 10, borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
            {["", "draft", "approved", "scheduled", "published"].map((s) => (
              <button key={s || "all"} onClick={() => setFilter(s)} style={{ ...btn(filter === s ? "primary" : "secondary", true), textTransform: "capitalize" }}>
                {s || "All"}
              </button>
            ))}
          </div>
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {posts.length === 0 && <div style={{ padding: 16, fontSize: 13, color: C.muted }}>No posts yet.</div>}
            {posts.map((p) => (
              <button
                key={p.id}
                onClick={() => onFocus(p.id)}
                data-testid={`blog-post-row-${p.slug}`}
                style={{
                  display: "flex",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: 10,
                  border: 0,
                  borderBottom: `1px solid ${C.line}`,
                  background: focusId === p.id ? "#eff6ff" : "#fff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ width: 64, height: 40, borderRadius: 6, flexShrink: 0, background: "#e2e8f0", overflow: "hidden" }}>
                  {(p.heroImageUrl || p.status === "published") && (
                    <img
                      src={p.heroImageUrl ? resolveAsset(p.heroImageUrl) : coverUrl(p.slug)}
                      alt=""
                      onError={(e) => (e.currentTarget.style.display = "none")}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                    <Badge status={p.status} />
                    <span style={{ fontSize: 11, color: C.muted }}>{p.audience}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        {!post && (
          <div style={{ ...card, textAlign: "center", padding: 48, color: C.muted }}>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: C.ink, marginBottom: 6 }}>Select a post</div>
            Generate a batch or pick a draft to review SEO, rewrite sections, regenerate artwork, and publish.
          </div>
        )}
        {post && detail && (
          <PostEditor
            key={post.id + post.updatedAt}
            detail={detail}
            busy={busy}
            act={act}
            call={call}
            notify={notify}
            resolveAsset={resolveAsset}
            publicOrigin={publicOrigin}
            onChanged={async (next) => {
              if (next) setDetail((d) => (d ? { ...d, post: next } : d));
              await loadDetail(post.id);
              await load();
            }}
            onPreview={async () => {
              const html = await call<string>(`/blog/posts/${post.id}/preview`, { headers: { Accept: "text/html" } });
              setPreview(assetOrigin ? html.replace("<head>", `<head><base href="${assetOrigin}/">`) : html);
            }}
          />
        )}
      </div>
      {preview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setPreview(null)}>
          <div style={{ width: "min(1100px,100%)", height: "90vh", background: "#fff", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
              <strong style={{ fontSize: 13 }}>Preview (not indexed)</strong>
              <button style={btn("secondary", true)} onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <iframe title="Post preview" srcDoc={preview} sandbox="allow-same-origin" style={{ flex: 1, border: 0 }} />
          </div>
        </div>
      )}
    </div>
  );
}

function PostEditor({
  detail,
  busy,
  act,
  call,
  notify,
  resolveAsset,
  publicOrigin,
  onChanged,
  onPreview,
}: {
  detail: PostDetail;
  busy: string | null;
  act: (key: string, fn: () => Promise<void>) => Promise<void>;
  call: CallFn;
  notify: NotifyFn;
  resolveAsset: (u?: string | null) => string;
  publicOrigin: string;
  onChanged: (next?: MarketingPost | null) => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  const { post, revisions, assets, sections } = detail;
  const [edit, setEdit] = useState({
    title: post.title,
    slug: post.slug,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    excerpt: post.excerpt,
    targetKeywords: post.targetKeywords.join(", "),
    bodyMarkdown: post.bodyMarkdown,
  });
  const [rewrite, setRewrite] = useState("");
  const [scope, setScope] = useState<string>("");
  const [artInstruction, setArtInstruction] = useState("");
  const [artMode, setArtMode] = useState(post.artworkMode);
  const [publishAt, setPublishAt] = useState("");
  const dirty =
    edit.title !== post.title ||
    edit.slug !== post.slug ||
    edit.seoTitle !== post.seoTitle ||
    edit.seoDescription !== post.seoDescription ||
    edit.excerpt !== post.excerpt ||
    edit.targetKeywords !== post.targetKeywords.join(", ") ||
    edit.bodyMarkdown !== post.bodyMarkdown;
  const isGenerating = post.status === "generating";
  const liveUrl = `${publicOrigin}/blog/${post.slug}`;

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="blog-post-editor">
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Badge status={post.status} />
            <span style={{ fontSize: 12, color: C.muted }}>
              {post.readingTimeMinutes} min read · updated {fmtDate(post.updatedAt)}
            </span>
          </div>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700, marginTop: 4 }}>{post.title}</div>
          {post.generationError && <div style={{ fontSize: 12, color: C.warn, marginTop: 4 }}>{post.generationError}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={btn("secondary", true)} onClick={() => act("preview", onPreview)} disabled={isGenerating}>
            Preview
          </button>
          <button
            style={btn("secondary", true)}
            disabled={isGenerating || busy === "regen"}
            data-testid="blog-regenerate"
            onClick={() =>
              act("regen", async () => {
                await call(`/blog/posts/${post.id}/regenerate`, { json: { instruction: rewrite || undefined, artworkMode: artMode } });
                notify("ok", "Regenerating post and artwork…");
                await onChanged();
              })
            }
          >
            {busy === "regen" ? "…" : "1-Click Regenerate"}
          </button>
          {post.status !== "published" && post.status !== "approved" && (
            <button
              style={btn("secondary", true)}
              disabled={isGenerating}
              data-testid="blog-approve"
              onClick={() =>
                act("approve", async () => {
                  const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/approve`, { json: {} });
                  notify("ok", "Approved");
                  await onChanged(r.post);
                })
              }
            >
              Approve
            </button>
          )}
          {post.status === "published" ? (
            <>
              {publicOrigin !== undefined && (
                <a href={liveUrl} target="_blank" rel="noreferrer" style={{ ...btn("secondary", true), textDecoration: "none" }}>
                  View live
                </a>
              )}
              <button
                style={btn("danger", true)}
                onClick={() =>
                  act("unpublish", async () => {
                    const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/unpublish`, { json: {} });
                    await onChanged(r.post);
                  })
                }
              >
                Unpublish
              </button>
            </>
          ) : (
            <>
              <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} style={{ ...input, width: 190, padding: "5px 8px", fontSize: 12 }} title="Optional: schedule publish" />
              <button
                style={btn("primary", true)}
                disabled={isGenerating || dirty}
                title={dirty ? "Save edits first" : undefined}
                data-testid="blog-publish"
                onClick={() =>
                  act("publish", async () => {
                    const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/publish`, { json: publishAt ? { publishAt: new Date(publishAt).toISOString() } : {} });
                    notify("ok", r.post.status === "scheduled" ? `Scheduled for ${fmtDate(r.post.publishedAt)}` : "Published");
                    await onChanged(r.post);
                  })
                }
              >
                {publishAt ? "Schedule" : "Publish"}
              </button>
            </>
          )}
        </div>
      </div>

      {isGenerating ? (
        <div style={{ ...card, padding: 40, textAlign: "center", color: C.muted }}>Writing the article and creating artwork… this usually takes under a minute.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h4 style={{ ...sectionTitle, margin: 0 }}>Hero artwork</h4>
                <Badge status={post.artworkStatus === "approved" ? "approved" : post.artworkStatus === "generating" ? "generating" : "draft"} />
              </div>
              <div style={{ aspectRatio: "1200 / 630", background: "#e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                {post.heroImageUrl ? (
                  <img src={resolveAsset(post.heroImageUrl)} alt={post.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} data-testid="blog-hero-image" />
                ) : (
                  <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>No artwork yet</div>
                )}
              </div>
              {assets.length > 1 && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto" }}>
                  {assets.map((a) => (
                    <button
                      key={a.id}
                      title={a.customInstruction || a.mode}
                      onClick={() =>
                        act("pick-art", async () => {
                          const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/artwork/approve`, { json: { assetUrl: a.imageUrl } });
                          await onChanged(r.post);
                        })
                      }
                      style={{ padding: 0, border: `2px solid ${a.imageUrl === post.heroImageUrl ? C.accent : "transparent"}`, borderRadius: 6, background: "none", cursor: "pointer", flexShrink: 0 }}
                    >
                      <img src={resolveAsset(a.imageUrl)} alt="" style={{ width: 72, height: 38, objectFit: "cover", borderRadius: 4, display: "block" }} />
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {(["ai_illustration", "studio_card"] as const).map((m) => (
                  <button key={m} onClick={() => setArtMode(m)} style={{ ...btn(artMode === m ? "primary" : "secondary", true), flex: 1, justifyContent: "center" }}>
                    {m === "ai_illustration" ? "AI illustration" : "Studio card"}
                  </button>
                ))}
              </div>
              <input value={artInstruction} onChange={(e) => setArtInstruction(e.target.value)} placeholder="Art direction, e.g. warmer light, show a kitchen table" style={{ ...input, marginTop: 8 }} data-testid="blog-artwork-instruction" />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  style={{ ...btn("secondary", true), flex: 1, justifyContent: "center" }}
                  disabled={busy === "art"}
                  data-testid="blog-artwork-regenerate"
                  onClick={() =>
                    act("art", async () => {
                      const r = await call<{ post: MarketingPost; warning?: string }>(`/blog/posts/${post.id}/artwork`, { json: { mode: artMode, instruction: artInstruction || undefined } });
                      if (r.warning) notify("err", r.warning);
                      setArtInstruction("");
                      await onChanged(r.post);
                    })
                  }
                >
                  {busy === "art" ? "Generating…" : "Regenerate artwork"}
                </button>
                <button
                  style={{ ...btn("secondary", true), flex: 1, justifyContent: "center" }}
                  disabled={post.artworkStatus === "approved"}
                  onClick={() =>
                    act("art-approve", async () => {
                      const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/artwork/approve`, { json: {} });
                      await onChanged(r.post);
                    })
                  }
                >
                  Approve artwork
                </button>
              </div>
            </div>

            <div style={card}>
              <h4 style={sectionTitle}>Rewrite with instructions</h4>
              <select value={scope} onChange={(e) => setScope(e.target.value)} style={input}>
                <option value="">Whole post</option>
                {sections.map((s) => (
                  <option key={s} value={s}>
                    Section: {s}
                  </option>
                ))}
              </select>
              <textarea value={rewrite} onChange={(e) => setRewrite(e.target.value)} rows={3} placeholder="e.g. Shorten the intro, add a Texas-specific checklist, make the tone warmer" style={{ ...input, marginTop: 8, resize: "vertical" }} data-testid="blog-rewrite-instruction" />
              <button
                style={{ ...btn("primary", true), marginTop: 8 }}
                disabled={!rewrite.trim() || busy === "rewrite"}
                data-testid="blog-rewrite"
                onClick={() =>
                  act("rewrite", async () => {
                    const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/rewrite`, { json: { instruction: rewrite, sectionHeading: scope || undefined } });
                    notify("ok", scope ? `Rewrote "${scope}"` : "Rewrote post");
                    setRewrite("");
                    await onChanged(r.post);
                  })
                }
              >
                {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
              </button>
            </div>

            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ ...sectionTitle, margin: 0 }}>Article (markdown)</h4>
                {dirty && <span style={{ fontSize: 12, color: C.warn }}>Unsaved changes</span>}
              </div>
              <textarea value={edit.bodyMarkdown} onChange={(e) => setEdit({ ...edit, bodyMarkdown: e.target.value })} rows={18} style={{ ...input, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12.5, lineHeight: 1.55, resize: "vertical" }} />
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <div style={card}>
              <h4 style={sectionTitle}>SEO</h4>
              <label style={label}>Title (H1)</label>
              <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={input} />
              <label style={{ ...label, marginTop: 10 }}>Slug</label>
              <input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} style={input} />
              <label style={{ ...label, marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                <span>SEO title</span>
                <span style={{ color: edit.seoTitle.length > 60 ? C.bad : C.muted, fontWeight: 400 }}>{edit.seoTitle.length}/60</span>
              </label>
              <input value={edit.seoTitle} onChange={(e) => setEdit({ ...edit, seoTitle: e.target.value })} style={input} />
              <label style={{ ...label, marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                <span>Meta description</span>
                <span style={{ color: edit.seoDescription.length > 155 ? C.bad : C.muted, fontWeight: 400 }}>{edit.seoDescription.length}/155</span>
              </label>
              <textarea value={edit.seoDescription} onChange={(e) => setEdit({ ...edit, seoDescription: e.target.value })} rows={3} style={{ ...input, resize: "vertical" }} />
              <label style={{ ...label, marginTop: 10 }}>Excerpt</label>
              <textarea value={edit.excerpt} onChange={(e) => setEdit({ ...edit, excerpt: e.target.value })} rows={2} style={{ ...input, resize: "vertical" }} />
              <label style={{ ...label, marginTop: 10 }}>Target keywords</label>
              <input value={edit.targetKeywords} onChange={(e) => setEdit({ ...edit, targetKeywords: e.target.value })} style={input} />
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: C.surface, border: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Search preview</div>
                <div style={{ color: "#1a0dab", fontSize: 16, lineHeight: 1.3 }}>{edit.seoTitle || edit.title}</div>
                <div style={{ color: "#006621", fontSize: 12 }}>{(publicOrigin || "").replace(/^https?:\/\//, "") || "yourdomain"}/blog/{edit.slug}</div>
                <div style={{ color: "#4d5156", fontSize: 13 }}>{edit.seoDescription}</div>
              </div>
              <button
                style={{ ...btn("primary", true), marginTop: 12 }}
                disabled={!dirty || busy === "save"}
                onClick={() =>
                  act("save", async () => {
                    const r = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}`, {
                      method: "PATCH",
                      json: { ...edit, targetKeywords: edit.targetKeywords.split(",").map((k) => k.trim()).filter(Boolean) },
                    });
                    notify("ok", "Saved");
                    await onChanged(r.post);
                  })
                }
              >
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
            </div>
            <div style={card}>
              <h4 style={sectionTitle}>FAQ (FAQPage schema)</h4>
              {post.faqItems.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No FAQ items.</div>}
              {post.faqItems.map((f) => (
                <div key={f.question} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.question}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{f.answer}</div>
                </div>
              ))}
              <div style={{ fontSize: 12, color: C.muted, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                CTA: <strong>{post.ctaLabel}</strong> → {post.ctaUrl}
              </div>
            </div>
            {revisions.length > 0 && (
              <div style={card}>
                <h4 style={sectionTitle}>Revision history</h4>
                <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {revisions.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.instruction}</div>
                        <div style={{ color: C.muted }}>{fmtDate(r.createdAt)}</div>
                      </div>
                      <button
                        style={btn("ghost", true)}
                        onClick={() =>
                          act("restore", async () => {
                            const res = await call<{ post: MarketingPost }>(`/blog/posts/${post.id}/revisions/${r.id}/restore`, { json: {} });
                            notify("ok", "Restored previous version");
                            await onChanged(res.post);
                          })
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Email Studio

type CampaignDetail = { campaign: EmailCampaign; recipients: Array<Record<string, any>>; assets: MarketingArtworkAsset[] };

function EmailStudio({
  call,
  notify,
  segments,
  focusId,
  onFocus,
  refreshKey,
  prefill,
  clearPrefill,
  assetOrigin,
  emailEnabled,
}: {
  call: CallFn;
  notify: NotifyFn;
  segments: AudienceSegmentInfo[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  refreshKey: number;
  prefill: { segmentId?: string; goal?: string; filter?: Record<string, unknown> } | null;
  clearPrefill: () => void;
  assetOrigin: string;
  emailEnabled: boolean;
}) {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [segmentId, setSegmentId] = useState(prefill?.segmentId || "");
  const [goal, setGoal] = useState(prefill?.goal || "");
  const [filter, setFilter] = useState<Record<string, unknown> | null>(prefill?.filter || null);
  const [layout, setLayout] = useState<EmailLayout>("editorial");
  const [artworkMode, setArtworkMode] = useState<"ai_illustration" | "studio_card">("ai_illustration");
  const [ideas, setIdeas] = useState<Array<{ name: string; subject: string; angle: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) {
      setSegmentId(prefill.segmentId || "");
      setGoal(prefill.goal || "");
      setFilter(prefill.filter || null);
      clearPrefill();
    }
  }, [prefill, clearPrefill]);

  useEffect(() => {
    if (!segmentId && segments.length) setSegmentId(segments[0].id);
  }, [segments, segmentId]);

  const load = useCallback(async () => {
    const r = await call<{ campaigns: EmailCampaign[] }>("/email/campaigns");
    setCampaigns(r.campaigns);
  }, [call]);

  const loadDetail = useCallback(async (id: string) => setDetail(await call<CampaignDetail>(`/email/campaigns/${id}`)), [call]);

  useEffect(() => {
    void load().catch((e) => notify("err", e.message));
  }, [load, refreshKey, notify]);

  useEffect(() => {
    if (focusId) void loadDetail(focusId).catch(() => setDetail(null));
    else setDetail(null);
  }, [focusId, loadDetail]);

  useEffect(() => {
    if (detail?.campaign.status !== "sending") return;
    const t = window.setInterval(() => {
      void loadDetail(detail.campaign.id);
      void load();
    }, 2500);
    return () => window.clearInterval(t);
  }, [detail?.campaign.status, detail?.campaign.id, load, loadDetail]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err: any) {
      notify("err", err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px minmax(0,1fr)", gap: 16 }} data-testid="marketing-email-studio">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, alignContent: "start", minWidth: 0 }}>
        <div style={card}>
          <h4 style={sectionTitle}>New campaign</h4>
          <label style={label}>Audience</label>
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} style={input} data-testid="email-segment">
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.id !== "custom" ? ` (${s.count})` : ""}
              </option>
            ))}
          </select>
          {filter && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Custom filter: {Object.entries(filter).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`).join(", ")}</div>}
          <label style={{ ...label, marginTop: 10 }}>Goal / brief</label>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} placeholder="e.g. Remind free users their research is saved and documents unlock for $29" style={{ ...input, resize: "vertical" }} data-testid="email-goal" />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginTop: 10 }}>
            <div>
              <label style={label}>Layout</label>
              <select value={layout} onChange={(e) => setLayout(e.target.value as EmailLayout)} style={input}>
                <option value="editorial">Editorial</option>
                <option value="spotlight">Spotlight</option>
                <option value="minimal">Minimal letter</option>
              </select>
            </div>
            <div>
              <label style={label}>Banner</label>
              <select value={artworkMode} onChange={(e) => setArtworkMode(e.target.value as any)} style={input}>
                <option value="ai_illustration">AI illustration</option>
                <option value="studio_card">Studio card</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              style={{ ...btn("primary"), flex: 1, justifyContent: "center" }}
              disabled={!goal.trim() || !segmentId || busy === "create"}
              data-testid="email-create"
              onClick={() =>
                act("create", async () => {
                  const r = await call<{ campaign: EmailCampaign; warning?: string }>("/email/campaigns", { json: { segmentId, goal, layout, artworkMode, filter: segmentId === "custom" ? filter : undefined } });
                  if (r.warning) notify("err", r.warning);
                  else notify("ok", "Campaign drafted");
                  setGoal("");
                  setIdeas([]);
                  await load();
                  onFocus(r.campaign.id);
                })
              }
            >
              {busy === "create" ? "Designing…" : "Design email"}
            </button>
            <button
              style={btn("secondary")}
              disabled={busy === "ideas" || !segmentId}
              onClick={() =>
                act("ideas", async () => {
                  const r = await call<{ ideas: Array<{ name: string; subject: string; angle: string }> }>("/email/ideas", { json: { segmentId, goal } });
                  setIdeas(r.ideas);
                })
              }
            >
              {busy === "ideas" ? "…" : "Ideas"}
            </button>
          </div>
          {ideas.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              {ideas.map((i) => (
                <button key={i.subject} onClick={() => setGoal(`${i.name}: ${i.angle} Subject idea: "${i.subject}"`)} style={{ ...btn("secondary", true), whiteSpace: "normal", textAlign: "left", display: "block" }}>
                  <div style={{ fontWeight: 700 }}>{i.subject}</div>
                  <div style={{ fontWeight: 400, color: C.muted }}>{i.angle}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ ...card, padding: 0 }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.line}`, fontSize: 13, fontWeight: 700 }}>Campaigns</div>
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            {campaigns.length === 0 && <div style={{ padding: 16, fontSize: 13, color: C.muted }}>No campaigns yet.</div>}
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => onFocus(c.id)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: 10, border: 0, borderBottom: `1px solid ${C.line}`, background: focusId === c.id ? "#eff6ff" : "#fff", cursor: "pointer", fontFamily: "inherit" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                {c.subject && <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{c.subject}</div>}
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
                  <Badge status={c.status} />
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {c.segmentId}
                    {c.sentCount ? ` · ${c.sentCount} sent · ${c.openedCount} opens` : ""}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        {!detail && (
          <div style={{ ...card, textAlign: "center", padding: 48, color: C.muted }}>
            <div style={{ fontFamily: "Georgia,serif", fontSize: 20, color: C.ink, marginBottom: 6 }}>Design a campaign</div>
            Pick an audience and describe the goal. Every campaign gets responsive HTML, banner artwork, a desktop/mobile preview, and test sends before anything goes out.
          </div>
        )}
        {detail && (
          <CampaignEditor
            key={detail.campaign.id + detail.campaign.updatedAt}
            detail={detail}
            call={call}
            notify={notify}
            busy={busy}
            act={act}
            assetOrigin={assetOrigin}
            emailEnabled={emailEnabled}
            onChanged={async () => {
              await loadDetail(detail.campaign.id);
              await load();
            }}
          />
        )}
      </div>
    </div>
  );
}

function CampaignEditor({
  detail,
  call,
  notify,
  busy,
  act,
  assetOrigin,
  emailEnabled,
  onChanged,
}: {
  detail: CampaignDetail;
  call: CallFn;
  notify: NotifyFn;
  busy: string | null;
  act: (key: string, fn: () => Promise<void>) => Promise<void>;
  assetOrigin: string;
  emailEnabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const c = detail.campaign;
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [html, setHtml] = useState<string>("");
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState<"all" | "copy" | "layout" | "artwork">("all");
  const [subject, setSubject] = useState(c.subject);
  const [preheader, setPreheader] = useState(c.preheader);
  const [testTo, setTestTo] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const editable = !["sending", "sent"].includes(c.status);

  useEffect(() => {
    call<string>(`/email/campaigns/${c.id}/preview`, { headers: { Accept: "text/html" } })
      .then((h) => setHtml(assetOrigin ? h.replace("<head>", `<head><base href="${assetOrigin}/">`) : h))
      .catch(() => setHtml(""));
  }, [call, c.id, c.updatedAt, assetOrigin]);

  const stats: Array<[string, number | string]> = [
    ["Recipients", c.recipientCount],
    ["Sent", c.sentCount],
    ["Delivered", c.deliveredCount],
    ["Opened", c.openedCount],
    ["Clicked", c.clickedCount],
    ["Bounced", c.bouncedCount],
    ["Unsubscribed", c.unsubscribedCount],
  ];

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="email-campaign-editor">
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Badge status={c.status} />
            <span style={{ fontSize: 12, color: C.muted }}>
              {c.segmentId} · {c.layout} layout{c.scheduledAt && c.status === "scheduled" ? ` · sends ${fmtDate(c.scheduledAt)}` : ""}
              {c.sentAt ? ` · sent ${fmtDate(c.sentAt)}` : ""}
            </span>
          </div>
          <div style={{ fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 700, marginTop: 4 }}>{c.name}</div>
          {c.lastError && <div style={{ fontSize: 12, color: C.warn, marginTop: 4 }}>{c.lastError}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {editable && c.status !== "approved" && c.status !== "scheduled" && (
            <button
              style={btn("secondary", true)}
              data-testid="email-approve"
              onClick={() =>
                act("approve", async () => {
                  await call(`/email/campaigns/${c.id}/approve`, { json: {} });
                  notify("ok", "Approved — ready to send");
                  await onChanged();
                })
              }
            >
              Approve
            </button>
          )}
          {c.status === "scheduled" && (
            <button
              style={btn("secondary", true)}
              onClick={() =>
                act("unschedule", async () => {
                  await call(`/email/campaigns/${c.id}/cancel-schedule`, { json: {} });
                  await onChanged();
                })
              }
            >
              Cancel schedule
            </button>
          )}
          {c.status === "approved" && (
            <>
              <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} style={{ ...input, width: 190, padding: "5px 8px", fontSize: 12 }} title="Optional: schedule" />
              <button
                style={btn("primary", true)}
                disabled={!emailEnabled || busy === "send"}
                title={emailEnabled ? undefined : "Configure Resend first"}
                data-testid="email-send"
                onClick={() =>
                  act("send", async () => {
                    if (!scheduleAt && !window.confirm(`Send "${c.subject}" to the ${c.segmentId} audience now?`)) return;
                    await call(`/email/campaigns/${c.id}/send`, { json: scheduleAt ? { scheduledAt: new Date(scheduleAt).toISOString() } : {} });
                    notify("ok", scheduleAt ? "Scheduled" : "Sending…");
                    await onChanged();
                  })
                }
              >
                {scheduleAt ? "Schedule" : "Send now"}
              </button>
            </>
          )}
        </div>
      </div>

      {(c.status === "sent" || c.status === "sending") && (
        <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10 }}>
          {stats.map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 12 }}>
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong style={{ color: C.ink }}>{c.subject}</strong> — {c.preheader}
            </div>
            <div style={{ display: "flex", gap: 4 }} data-testid="email-device-toggle">
              {(["desktop", "mobile"] as const).map((d) => (
                <button key={d} onClick={() => setDevice(d)} style={{ ...btn(device === d ? "primary" : "secondary", true), textTransform: "capitalize" }}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div style={{ background: "#e2e8f0", padding: device === "mobile" ? "18px 0" : 0, display: "flex", justifyContent: "center" }}>
            <iframe
              title="Email preview"
              srcDoc={html}
              sandbox="allow-same-origin"
              data-testid="email-preview-frame"
              style={{
                width: device === "mobile" ? 375 : "100%",
                height: 680,
                border: device === "mobile" ? "10px solid #0f172a" : 0,
                borderRadius: device === "mobile" ? 28 : 0,
                background: "#fff",
              }}
            />
          </div>
        </div>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {editable && (
            <div style={card}>
              <h4 style={sectionTitle}>Refine with instructions</h4>
              <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
                {(["all", "copy", "layout", "artwork"] as const).map((t) => (
                  <button key={t} onClick={() => setTarget(t)} style={{ ...btn(target === t ? "primary" : "secondary", true), textTransform: "capitalize" }}>
                    {t}
                  </button>
                ))}
              </div>
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} placeholder={target === "layout" ? "e.g. make it a minimal personal letter" : target === "artwork" ? "e.g. sunrise over a city, warmer palette" : "e.g. Shorter, friendlier, mention the $29 unlock"} style={{ ...input, resize: "vertical" }} data-testid="email-refine-instruction" />
              {target === "layout" && (
                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                  {(["editorial", "spotlight", "minimal"] as const).map((l) => (
                    <button
                      key={l}
                      style={{ ...btn(c.layout === l ? "primary" : "secondary", true), textTransform: "capitalize" }}
                      onClick={() =>
                        act("layout", async () => {
                          await call(`/email/campaigns/${c.id}/refine`, { json: { target: "layout", layout: l, instruction: `Switch to ${l}` } });
                          await onChanged();
                        })
                      }
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              <button
                style={{ ...btn("primary", true), marginTop: 8 }}
                disabled={busy === "refine" || (!instruction.trim() && target !== "artwork")}
                data-testid="email-refine"
                onClick={() =>
                  act("refine", async () => {
                    const r = await call<{ warning?: string }>(`/email/campaigns/${c.id}/refine`, { json: { target, instruction } });
                    if (r.warning) notify("err", r.warning);
                    else notify("ok", "Updated");
                    setInstruction("");
                    await onChanged();
                  })
                }
              >
                {busy === "refine" ? "Refining…" : target === "artwork" ? "Regenerate banner" : "Apply"}
              </button>
            </div>
          )}
          {editable && (
            <div style={card}>
              <h4 style={sectionTitle}>Subject &amp; preheader</h4>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} />
              <input value={preheader} onChange={(e) => setPreheader(e.target.value)} style={{ ...input, marginTop: 8 }} />
              <button
                style={{ ...btn("secondary", true), marginTop: 8 }}
                disabled={(subject === c.subject && preheader === c.preheader) || busy === "save"}
                onClick={() =>
                  act("save", async () => {
                    await call(`/email/campaigns/${c.id}`, { method: "PATCH", json: { subject, preheader } });
                    notify("ok", "Saved");
                    await onChanged();
                  })
                }
              >
                Save
              </button>
            </div>
          )}
          <div style={card}>
            <h4 style={sectionTitle}>Test send</h4>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Defaults to your admin email" style={input} />
            <button
              style={{ ...btn("secondary", true), marginTop: 8 }}
              disabled={!emailEnabled || busy === "test"}
              data-testid="email-test-send"
              onClick={() =>
                act("test", async () => {
                  const r = await call<{ to: string }>(`/email/campaigns/${c.id}/test-send`, { json: testTo ? { to: testTo } : {} });
                  notify("ok", `Test sent to ${r.to}`);
                })
              }
            >
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
            {!emailEnabled && <div style={{ fontSize: 12, color: C.warn, marginTop: 6 }}>Resend is not configured for this app.</div>}
          </div>
          {detail.recipients.length > 0 && (
            <div style={card}>
              <h4 style={sectionTitle}>Recipients</h4>
              <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 12 }}>
                {detail.recipients.map((r) => (
                  <div key={r.email} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.line}` }}>
                    <span>{r.email}</span>
                    <span style={{ color: C.muted }}>{r.unsubscribed_at ? "unsubscribed" : r.bounced_at ? "bounced" : r.clicked_at ? "clicked" : r.opened_at ? "opened" : r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Audiences

function AudiencesPanel({ call, segments, onDraft }: { call: CallFn; segments: AudienceSegmentInfo[]; onDraft: (p: { segmentId: string; goal?: string; filter?: Record<string, unknown> }) => void }) {
  const [userTypes, setUserTypes] = useState<string[]>([]);
  const [planTiers, setPlanTiers] = useState("");
  const [signedUpAfter, setSignedUpAfter] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [hasLockedMatter, setHasLockedMatter] = useState(false);
  const [result, setResult] = useState<{ count: number; suppressed: number; sample: Array<Record<string, any>> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (userTypes.length) f.userTypes = userTypes;
    if (planTiers.trim()) f.planTiers = planTiers.split(",").map((s) => s.trim()).filter(Boolean);
    if (signedUpAfter) f.signedUpAfter = new Date(signedUpAfter).toISOString();
    if (emailDomain.trim()) f.emailDomain = emailDomain.trim().replace(/^@/, "");
    if (hasLockedMatter) f.hasLockedMatter = true;
    return f;
  }, [userTypes, planTiers, signedUpAfter, emailDomain, hasLockedMatter]);

  const preview = async (segmentId: string, f?: Record<string, unknown>) => {
    setSelected(segmentId);
    setError(null);
    try {
      setResult(await call(`/segments/preview`, { json: { segmentId, filter: f } }));
    } catch (err: any) {
      setError(err.message);
      setResult(null);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 16 }} data-testid="marketing-audiences">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12, alignContent: "start" }}>
        {segments
          .filter((s) => s.id !== "custom")
          .map((s) => (
            <div key={s.id} style={{ ...card, borderColor: selected === s.id ? C.accent : C.line }}>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace,Menlo,monospace" }}>{s.id}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: C.primary, margin: "6px 0" }}>{s.count.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: C.muted, minHeight: 32 }}>{s.description}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button style={btn("secondary", true)} onClick={() => preview(s.id)}>
                  Preview
                </button>
                <button style={btn("primary", true)} onClick={() => onDraft({ segmentId: s.id })}>
                  Draft email
                </button>
              </div>
            </div>
          ))}
      </div>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <div style={card}>
          <h4 style={sectionTitle}>Custom filter</h4>
          <label style={label}>User type</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["individual", "attorney", "firm_admin", "firm_member"].map((t) => (
              <button key={t} onClick={() => setUserTypes((u) => (u.includes(t) ? u.filter((x) => x !== t) : [...u, t]))} style={btn(userTypes.includes(t) ? "primary" : "secondary", true)}>
                {t}
              </button>
            ))}
          </div>
          <label style={{ ...label, marginTop: 10 }}>Plan tiers (comma-separated)</label>
          <input value={planTiers} onChange={(e) => setPlanTiers(e.target.value)} placeholder="free, pro" style={input} />
          <label style={{ ...label, marginTop: 10 }}>Signed up after</label>
          <input type="date" value={signedUpAfter} onChange={(e) => setSignedUpAfter(e.target.value)} style={input} />
          <label style={{ ...label, marginTop: 10 }}>Email domain</label>
          <input value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} placeholder="example.com" style={input} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 10 }}>
            <input type="checkbox" checked={hasLockedMatter} onChange={(e) => setHasLockedMatter(e.target.checked)} /> Has a locked free matter
          </label>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button style={btn("secondary", true)} onClick={() => preview("custom", filter)}>
              Preview audience
            </button>
            <button style={btn("primary", true)} onClick={() => onDraft({ segmentId: "custom", filter })}>
              Draft email
            </button>
          </div>
        </div>
        {(result || error) && (
          <div style={card}>
            <h4 style={sectionTitle}>{selected === "custom" ? "Custom audience" : selected}</h4>
            {error && <div style={{ fontSize: 13, color: C.bad }}>{error}</div>}
            {result && (
              <>
                <div style={{ fontSize: 13 }}>
                  <strong>{result.count}</strong> eligible · {result.suppressed} suppressed (unsubscribed or opted out)
                </div>
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {result.sample.map((s) => (
                    <div key={s.email} style={{ padding: "4px 0", borderBottom: `1px solid ${C.line}` }}>
                      {s.name || s.email} <span style={{ color: C.muted }}>· {s.userType || s.planTier}{s.matterTitle ? ` · ${s.matterTitle}` : ""}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Analytics

function Stat({ label: l, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: C.muted }}>{hint}</div>}
    </div>
  );
}

function AnalyticsPanel({ call, isAll, tenants, apiBase, getAccessToken }: { call: CallFn; isAll: boolean; tenants?: MarketingTenantOption[]; apiBase: string; getAccessToken?: () => string | null | undefined }) {
  const [overview, setOverview] = useState<MarketingOverview | null>(null);
  const [perTenant, setPerTenant] = useState<Array<{ tenant: MarketingTenantOption; overview: MarketingOverview | null; error?: string }>>([]);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);

  useEffect(() => {
    call<{ overview: MarketingOverview }>("/overview")
      .then((r) => setOverview(r.overview))
      .catch(() => setOverview(null));
    if (!isAll) {
      call<{ campaigns: EmailCampaign[] }>("/email/campaigns")
        .then((r) => setCampaigns(r.campaigns.filter((c) => c.status === "sent")))
        .catch(() => setCampaigns([]));
    }
  }, [call, isAll]);

  useEffect(() => {
    if (!isAll || !tenants) return;
    const root = apiBase.replace(/\/$/, "");
    const token = getAccessToken?.()?.trim();
    void Promise.all(
      tenants
        .filter((t) => t.id !== "all")
        .map(async (t) => {
          try {
            const res = await fetch(`${root}/t/${t.id}/overview`, { credentials: "include", headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            return { tenant: t, overview: data.overview as MarketingOverview };
          } catch (err: any) {
            return { tenant: t, overview: null, error: err.message };
          }
        }),
    ).then(setPerTenant);
  }, [isAll, tenants, apiBase, getAccessToken]);

  const rows = isAll ? perTenant.filter((r) => r.overview).map((r) => r.overview!) : overview ? [overview] : [];
  const total = rows.reduce(
    (acc, o) => ({
      published: acc.published + o.publishedPosts,
      drafts: acc.drafts + (o.posts.draft || 0) + (o.posts.approved || 0),
      sent: acc.sent + o.emailsSent,
      delivered: acc.delivered + o.delivered,
      opened: acc.opened + o.opened,
      clicked: acc.clicked + o.clicked,
      subscribers: acc.subscribers + o.subscribers,
      unsub: acc.unsub + o.unsubscribed,
    }),
    { published: 0, drafts: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, subscribers: 0, unsub: 0 },
  );
  const denom = total.delivered || total.sent;

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="marketing-analytics">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        <Stat label="Published posts" value={total.published} hint={`${total.drafts} in review`} />
        <Stat label="Emails sent" value={total.sent.toLocaleString()} hint={`${total.delivered.toLocaleString()} delivered`} />
        <Stat label="Open rate" value={denom ? pct(total.opened / denom) : "—"} hint={`${total.opened} opens`} />
        <Stat label="Click rate" value={denom ? pct(total.clicked / denom) : "—"} hint={`${total.clicked} clicks`} />
        <Stat label="Subscribers" value={total.subscribers} hint={`${total.unsub} unsubscribed`} />
      </div>
      {isAll && (
        <div style={card}>
          <h4 style={sectionTitle}>By app</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.muted }}>
                {["App", "Published", "In review", "Campaigns", "Sent", "Open rate", "Click rate", "Last campaign"].map((h) => (
                  <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perTenant.map(({ tenant, overview: o, error }) => (
                <tr key={tenant.id}>
                  <td style={{ padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{tenant.label}</td>
                  {o ? (
                    <>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{o.publishedPosts}</td>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{(o.posts.draft || 0) + (o.posts.approved || 0)}</td>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{o.campaigns}</td>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{o.emailsSent}</td>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{o.emailsSent ? pct(o.openRate) : "—"}</td>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{o.emailsSent ? pct(o.clickRate) : "—"}</td>
                      <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{fmtDate(o.lastCampaignAt)}</td>
                    </>
                  ) : (
                    <td colSpan={7} style={{ padding: 8, borderBottom: `1px solid ${C.line}`, color: C.bad }}>
                      {error || "Loading…"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isAll && (
        <div style={card}>
          <h4 style={sectionTitle}>Campaign performance</h4>
          {campaigns.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No sent campaigns yet.</div>}
          {campaigns.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.muted }}>
                  {["Campaign", "Audience", "Sent", "Delivered", "Opens", "Clicks", "Bounces", "Unsubs", "Sent at"].map((h) => (
                    <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.segmentId}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.sentCount}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.deliveredCount}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.openedCount}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.clickedCount}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.bouncedCount}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{c.unsubscribedCount}</td>
                    <td style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>{fmtDate(c.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
