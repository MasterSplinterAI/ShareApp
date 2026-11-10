// src/MarketingOpsConsole.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var C = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  surface: "#f8fafc",
  primary: "#173b7a",
  accent: "#2563eb",
  good: "#047857",
  warn: "#b45309",
  bad: "#b91c1c"
};
var card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 };
var label = { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 };
var input = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${C.line}`,
  borderRadius: 10,
  padding: "9px 11px",
  fontSize: 14,
  fontFamily: "inherit",
  color: C.ink,
  background: "#fff"
};
var sectionTitle = { margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: C.ink };
function btn(kind = "secondary", small = false) {
  const base = {
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
    whiteSpace: "nowrap"
  };
  if (kind === "primary") return { ...base, background: C.primary, color: "#fff" };
  if (kind === "danger") return { ...base, background: "#fff", color: C.bad, borderColor: "#fecaca" };
  if (kind === "ghost") return { ...base, background: "transparent", color: C.accent };
  return { ...base, background: "#fff", color: C.ink, borderColor: C.line };
}
var STATUS_COLORS = {
  generating: { bg: "#e0e7ff", fg: "#3730a3" },
  draft: { bg: "#f1f5f9", fg: "#334155" },
  approved: { bg: "#dcfce7", fg: "#166534" },
  scheduled: { bg: "#fef3c7", fg: "#92400e" },
  published: { bg: "#d1fae5", fg: "#065f46" },
  archived: { bg: "#f1f5f9", fg: "#94a3b8" },
  sending: { bg: "#e0e7ff", fg: "#3730a3" },
  sent: { bg: "#d1fae5", fg: "#065f46" },
  failed: { bg: "#fee2e2", fg: "#991b1b" }
};
function Badge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return /* @__PURE__ */ jsx("span", { style: { display: "inline-block", padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }, children: status });
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function miniMarkdown(md) {
  const lines = escapeHtml(md || "").split(/\n/);
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const inline = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
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
function fmtDate(iso) {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "\u2014" : d.toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}
function MarketingOpsConsole(props) {
  const { apiBase, tenants, assetOrigins = {}, publicOrigins = {}, getAccessToken, className } = props;
  const multiTenant = Boolean(tenants && tenants.length);
  const [tenant, setTenant] = useState(props.defaultTenantId || (multiTenant ? tenants[0].id : ""));
  const [tab, setTab] = useState(multiTenant && (props.defaultTenantId || tenants[0].id) === "all" ? "analytics" : "copilot");
  const [toast, setToast] = useState(null);
  const [context, setContext] = useState(null);
  const [segments, setSegments] = useState([]);
  const [focusPostId, setFocusPostId] = useState(null);
  const [focusCampaignId, setFocusCampaignId] = useState(null);
  const [emailPrefill, setEmailPrefill] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const base = useMemo(() => {
    const root = apiBase.replace(/\/$/, "");
    return multiTenant && tenant ? `${root}/t/${tenant}` : root;
  }, [apiBase, multiTenant, tenant]);
  const isAll = multiTenant && tenant === "all";
  const assetOrigin = (assetOrigins[tenant] || "").replace(/\/$/, "");
  const publicOrigin = (publicOrigins[tenant] || (!multiTenant && typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  const resolveAsset = useCallback((url) => url && url.startsWith("/") ? `${assetOrigin}${url}` : url || "", [assetOrigin]);
  const call = useCallback(
    async (path, init = {}) => {
      const token = getAccessToken?.()?.trim();
      const { json, headers, ...rest } = init;
      const res = await fetch(`${base}${path}`, {
        credentials: "include",
        ...rest,
        method: rest.method || (json !== void 0 ? "POST" : "GET"),
        headers: {
          Accept: "application/json",
          ...json !== void 0 ? { "Content-Type": "application/json" } : {},
          ...token ? { Authorization: `Bearer ${token}` } : {},
          ...headers || {}
        },
        body: json !== void 0 ? JSON.stringify(json) : rest.body
      });
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("json") ? await res.json().catch(() => ({})) : await res.text();
      if (!res.ok) throw new Error(data && typeof data === "object" && data.error || `Request failed (${res.status})`);
      return data;
    },
    [base, getAccessToken]
  );
  const notify = useCallback((kind, text) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => t?.text === text ? null : t), 4500);
  }, []);
  useEffect(() => {
    if (isAll) {
      setContext(null);
      setSegments([]);
      return;
    }
    let cancelled = false;
    call("/context").then((r) => !cancelled && setContext(r)).catch(() => !cancelled && setContext(null));
    call("/segments").then((r) => !cancelled && setSegments(r.segments)).catch(() => !cancelled && setSegments([]));
    return () => {
      cancelled = true;
    };
  }, [call, isAll, refreshKey]);
  const runAction = useCallback(
    async (action) => {
      try {
        if (action.kind === "blog_batch") {
          const r = await call("/blog/generate-batch", {
            json: { topics: action.seedTopics, count: action.count || action.seedTopics?.length || 3, audience: action.audience || "general" }
          });
          notify("ok", `Generating ${r.posts.length} draft${r.posts.length === 1 ? "" : "s"}\u2026`);
          setFocusPostId(r.posts[0]?.id || null);
          setTab("blog");
        } else {
          notify("ok", "Drafting campaign\u2026");
          const r = await call("/email/campaigns", {
            json: { segmentId: action.segmentId, goal: action.campaignGoal || action.title, instruction: action.subjectHint ? `Subject idea: ${action.subjectHint}` : void 0 }
          });
          if (r.warning) notify("err", r.warning);
          setFocusCampaignId(r.campaign.id);
          setTab("email");
        }
        setRefreshKey((k) => k + 1);
      } catch (err) {
        notify("err", err.message);
      }
    },
    [call, notify]
  );
  const tabs = [
    { id: "copilot", label: "Copilot" },
    { id: "blog", label: "Blog Studio" },
    { id: "email", label: "Email Studio" },
    { id: "audiences", label: "Audiences" },
    { id: "analytics", label: "Analytics" }
  ];
  return /* @__PURE__ */ jsxs("div", { className, "data-testid": "marketing-ops-console", style: { fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: C.ink }, children: [
    /* @__PURE__ */ jsxs("div", { style: { ...card, padding: 0, overflow: "hidden" }, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 18px", background: "linear-gradient(135deg,#0c1931 0%,#173b7a 100%)", color: "#fff" }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { style: { fontSize: 17, fontWeight: 700, fontFamily: "Georgia,serif" }, children: "Marketing & SEO" }),
          /* @__PURE__ */ jsxs("div", { style: { fontSize: 12, color: "#cbd5e1" }, children: [
            isAll ? "Portfolio overview across all apps" : context ? `${context.context.productName} \xB7 ${context.context.domain}` : "Loading product context\u2026",
            context && !isAll && /* @__PURE__ */ jsxs("span", { style: { marginLeft: 8 }, children: [
              "\xB7 Images ",
              context.capabilities.imageGen ? "AI" : "studio cards",
              " \xB7 Email ",
              context.capabilities.email ? "Resend" : "not configured"
            ] })
          ] })
        ] }),
        multiTenant && /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, "data-testid": "marketing-tenant-selector", children: tenants.map((t) => /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => {
              setTenant(t.id);
              setFocusPostId(null);
              setFocusCampaignId(null);
              if (t.id === "all") setTab("analytics");
            },
            style: {
              ...btn("secondary", true),
              background: tenant === t.id ? "#fff" : "rgba(255,255,255,0.08)",
              color: tenant === t.id ? C.primary : "#e2e8f0",
              borderColor: "rgba(255,255,255,0.25)"
            },
            children: t.label
          },
          t.id
        )) })
      ] }),
      /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 2, borderBottom: `1px solid ${C.line}`, padding: "0 10px", overflowX: "auto", background: "#fff" }, children: tabs.map((t) => {
        const disabled = isAll && t.id !== "analytics";
        return /* @__PURE__ */ jsx(
          "button",
          {
            "data-testid": `marketing-tab-${t.id}`,
            disabled,
            onClick: () => setTab(t.id),
            style: {
              border: 0,
              background: "transparent",
              padding: "12px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              color: disabled ? "#cbd5e1" : tab === t.id ? C.primary : C.muted,
              borderBottom: `2px solid ${tab === t.id ? C.primary : "transparent"}`,
              fontFamily: "inherit"
            },
            children: t.label
          },
          t.id
        );
      }) }),
      /* @__PURE__ */ jsxs("div", { style: { padding: 16, background: C.surface }, children: [
        tab === "copilot" && !isAll && /* @__PURE__ */ jsx(CopilotPanel, { call, context: context?.context || null, onAction: runAction, notify }),
        tab === "blog" && !isAll && /* @__PURE__ */ jsx(BlogStudio, { call, notify, resolveAsset, publicOrigin, focusId: focusPostId, onFocus: setFocusPostId, refreshKey, assetOrigin, apiRoot: base }),
        tab === "email" && !isAll && /* @__PURE__ */ jsx(
          EmailStudio,
          {
            call,
            notify,
            segments,
            focusId: focusCampaignId,
            onFocus: setFocusCampaignId,
            refreshKey,
            prefill: emailPrefill,
            clearPrefill: () => setEmailPrefill(null),
            assetOrigin,
            emailEnabled: Boolean(context?.capabilities.email)
          }
        ),
        tab === "audiences" && !isAll && /* @__PURE__ */ jsx(
          AudiencesPanel,
          {
            call,
            segments,
            onDraft: (p) => {
              setEmailPrefill(p);
              setFocusCampaignId(null);
              setTab("email");
            }
          }
        ),
        tab === "analytics" && /* @__PURE__ */ jsx(AnalyticsPanel, { call, isAll, tenants, apiBase, getAccessToken })
      ] })
    ] }),
    toast && /* @__PURE__ */ jsx(
      "div",
      {
        role: "status",
        style: {
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
          boxShadow: "0 10px 30px rgba(15,23,42,0.25)"
        },
        children: toast.text
      }
    )
  ] });
}
function CopilotPanel({ call, context, onAction, notify }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningAction, setRunningAction] = useState(null);
  const scroller = useRef(null);
  useEffect(() => {
    call("/copilot/messages").then((r) => setMessages(r.messages)).catch(() => setMessages([]));
  }, [call]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  const send = async (text) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    const optimistic = { id: `tmp_${Date.now()}`, tenantId: "", role: "user", content: message, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await call("/copilot/chat", { json: { message } });
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), r.userMessage, r.message]);
    } catch (err) {
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
    "Plan an SEO cluster for attorneys about citation checking"
  ];
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16 }, "data-testid": "marketing-copilot", children: [
    /* @__PURE__ */ jsxs("div", { style: { ...card, display: "flex", flexDirection: "column", height: 620, padding: 0 }, children: [
      /* @__PURE__ */ jsxs("div", { style: { padding: "12px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { style: { fontWeight: 700, fontSize: 14 }, children: "Marketing Copilot" }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted }, children: "Grounded in the codebase, pricing, support gaps, and live metrics" })
        ] }),
        messages.length > 0 && /* @__PURE__ */ jsx(
          "button",
          {
            style: btn("ghost", true),
            onClick: async () => {
              await call("/copilot/messages", { method: "DELETE" });
              setMessages([]);
            },
            children: "Clear"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { ref: scroller, style: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }, children: [
        messages.length === 0 && /* @__PURE__ */ jsxs("div", { style: { margin: "auto", textAlign: "center", maxWidth: 460 }, children: [
          /* @__PURE__ */ jsx("div", { style: { fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700, marginBottom: 8 }, children: "Turn any idea into content" }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: C.muted, marginBottom: 16 }, children: "Ask for ideas, then turn any suggestion into a blog batch or an email campaign with one click. Nothing publishes or sends without your approval." }),
          /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 8 }, children: starters.map((s) => /* @__PURE__ */ jsx("button", { onClick: () => send(s), style: { ...btn("secondary"), justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }, children: s }, s)) })
        ] }),
        messages.map((m) => /* @__PURE__ */ jsxs("div", { style: { alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%" }, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                padding: "10px 14px",
                borderRadius: 14,
                fontSize: 14,
                lineHeight: 1.55,
                background: m.role === "user" ? C.primary : "#fff",
                color: m.role === "user" ? "#fff" : C.ink,
                border: m.role === "user" ? "none" : `1px solid ${C.line}`
              },
              dangerouslySetInnerHTML: { __html: miniMarkdown(m.content) }
            }
          ),
          m.suggestedActions && m.suggestedActions.length > 0 && /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 8, marginTop: 8 }, children: m.suggestedActions.map((a, i) => {
            const key = `${m.id}_${i}`;
            return /* @__PURE__ */ jsxs("div", { style: { ...card, padding: 12, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", borderColor: a.kind === "blog_batch" ? "#bfdbfe" : "#fde68a" }, children: [
              /* @__PURE__ */ jsxs("div", { style: { minWidth: 0 }, children: [
                /* @__PURE__ */ jsx("div", { style: { fontSize: 11, fontWeight: 700, color: a.kind === "blog_batch" ? "#1d4ed8" : "#b45309", textTransform: "uppercase", letterSpacing: "0.05em" }, children: a.kind === "blog_batch" ? `Blog batch \xB7 ${a.count || a.seedTopics?.length || 3} posts` : `Email \xB7 ${a.segmentId}` }),
                /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600 }, children: a.title }),
                a.description && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted }, children: a.description }),
                a.seedTopics && a.seedTopics.length > 1 && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted, marginTop: 4 }, children: a.seedTopics.join(" \xB7 ") })
              ] }),
              /* @__PURE__ */ jsx(
                "button",
                {
                  style: btn("primary", true),
                  disabled: runningAction === key,
                  "data-testid": "copilot-action-run",
                  onClick: async () => {
                    setRunningAction(key);
                    await onAction(a);
                    setRunningAction(null);
                  },
                  children: runningAction === key ? "Working\u2026" : a.kind === "blog_batch" ? "Generate posts" : "Draft email"
                }
              )
            ] }, key);
          }) }),
          m.codebaseSources && m.codebaseSources.length > 0 && /* @__PURE__ */ jsxs("div", { style: { fontSize: 11, color: C.muted, marginTop: 6 }, children: [
            "Sources: ",
            m.codebaseSources.slice(0, 4).join(", ")
          ] })
        ] }, m.id)),
        busy && /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: C.muted }, children: "Copilot is thinking\u2026" })
      ] }),
      /* @__PURE__ */ jsxs(
        "form",
        {
          onSubmit: (e) => {
            e.preventDefault();
            void send(draft);
          },
          style: { display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${C.line}` },
          children: [
            /* @__PURE__ */ jsx("input", { value: draft, onChange: (e) => setDraft(e.target.value), placeholder: "Ask about positioning, topics, launches, or campaigns\u2026", style: input, "data-testid": "copilot-input" }),
            /* @__PURE__ */ jsx("button", { type: "submit", style: btn("primary"), disabled: busy || !draft.trim(), children: "Send" })
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12, alignContent: "start" }, children: [
      /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Product context" }),
        !context && /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: C.muted }, children: "Loading\u2026" }),
        context && /* @__PURE__ */ jsxs("div", { style: { fontSize: 12, color: "#334155", display: "grid", gap: 10 }, children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: context.productName }),
            " \u2014 ",
            context.tagline
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("div", { style: { fontWeight: 700, marginBottom: 4 }, children: "Pricing" }),
            context.pricingSummary
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("div", { style: { fontWeight: 700, marginBottom: 4 }, children: "Features" }),
            /* @__PURE__ */ jsx("ul", { style: { margin: 0, paddingLeft: 16 }, children: context.coreFeatures.slice(0, 6).map((f) => /* @__PURE__ */ jsx("li", { children: f }, f)) })
          ] }),
          context.liveMetrics && Object.keys(context.liveMetrics).length > 0 && /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("div", { style: { fontWeight: 700, marginBottom: 4 }, children: "Live metrics" }),
            Object.entries(context.liveMetrics).map(([k, v]) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between" }, children: [
              /* @__PURE__ */ jsx("span", { style: { color: C.muted }, children: k.replace(/_/g, " ") }),
              /* @__PURE__ */ jsx("strong", { children: String(v) })
            ] }, k))
          ] })
        ] })
      ] }),
      context?.supportKnowledgeGaps && context.supportKnowledgeGaps.length > 0 && /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Support gaps \u2192 content" }),
        /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 6 }, children: context.supportKnowledgeGaps.slice(0, 6).map((g) => /* @__PURE__ */ jsx("button", { onClick: () => send(`Turn this unanswered support question into content: "${g}"`), style: { ...btn("secondary", true), whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start" }, children: g }, g)) })
      ] }),
      context?.recentCommitsOrChanges && context.recentCommitsOrChanges.length > 0 && /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Recent product changes" }),
        /* @__PURE__ */ jsx("ul", { style: { margin: 0, paddingLeft: 16, fontSize: 12, color: "#334155" }, children: context.recentCommitsOrChanges.slice(0, 6).map((c) => /* @__PURE__ */ jsx("li", { style: { marginBottom: 4 }, children: c }, c)) })
      ] })
    ] })
  ] });
}
function BlogStudio({
  call,
  notify,
  resolveAsset,
  publicOrigin,
  focusId,
  onFocus,
  refreshKey,
  assetOrigin,
  apiRoot
}) {
  const coverUrl = (slug) => `${apiRoot}/blog/${encodeURIComponent(slug)}/cover.png`;
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState(null);
  const [topics, setTopics] = useState("");
  const [count, setCount] = useState(3);
  const [audience, setAudience] = useState("general");
  const [artworkMode, setArtworkMode] = useState("ai_illustration");
  const [instruction, setInstruction] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const load = useCallback(async () => {
    const r = await call(`/blog/posts${filter ? `?status=${filter}` : ""}`);
    setPosts(r.posts);
    return r.posts;
  }, [call, filter]);
  const loadDetail = useCallback(
    async (id) => {
      const r = await call(`/blog/posts/${id}`);
      setDetail(r);
    },
    [call]
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
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      notify("err", err.message);
    } finally {
      setBusy(null);
    }
  };
  const generate = () => act("generate", async () => {
    const list = topics.split("\n").map((t) => t.trim()).filter(Boolean);
    const r = await call("/blog/generate-batch", {
      json: { topics: list, count: Math.max(count, list.length ? Math.min(list.length, 12) : count), audience, artworkMode, instruction: instruction || void 0 }
    });
    notify("ok", `Generating ${r.posts.length} draft${r.posts.length === 1 ? "" : "s"}. They appear below as they finish.`);
    setTopics("");
    setIdeas([]);
    await load();
    onFocus(r.posts[0]?.id || null);
  });
  const post = detail?.post;
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "340px minmax(0,1fr)", gap: 16 }, "data-testid": "marketing-blog-studio", children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, alignContent: "start", minWidth: 0 }, children: [
      /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Generate a batch" }),
        /* @__PURE__ */ jsx("label", { style: label, children: "Topics (one per line, optional)" }),
        /* @__PURE__ */ jsx("textarea", { value: topics, onChange: (e) => setTopics(e.target.value), rows: 4, placeholder: "Leave blank to let Copilot pick topics", style: { ...input, resize: "vertical" } }),
        /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginTop: 10 }, children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { style: label, children: "Posts" }),
            /* @__PURE__ */ jsx("input", { type: "number", min: 1, max: 12, value: count, onChange: (e) => setCount(Math.min(12, Math.max(1, Number(e.target.value) || 1))), style: input })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { style: label, children: "Audience" }),
            /* @__PURE__ */ jsxs("select", { value: audience, onChange: (e) => setAudience(e.target.value), style: input, children: [
              /* @__PURE__ */ jsx("option", { value: "general", children: "General" }),
              /* @__PURE__ */ jsx("option", { value: "individual", children: "Individuals" }),
              /* @__PURE__ */ jsx("option", { value: "attorney", children: "Attorneys" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Artwork" }),
        /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6 }, children: ["ai_illustration", "studio_card"].map((m) => /* @__PURE__ */ jsx("button", { onClick: () => setArtworkMode(m), style: { ...btn(artworkMode === m ? "primary" : "secondary", true), flex: 1, justifyContent: "center" }, children: m === "ai_illustration" ? "AI illustration" : "Studio card" }, m)) }),
        /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Instructions" }),
        /* @__PURE__ */ jsx("input", { value: instruction, onChange: (e) => setInstruction(e.target.value), placeholder: "e.g. Focus on Texas tenants, warm tone", style: input }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 12 }, children: [
          /* @__PURE__ */ jsx("button", { style: { ...btn("primary"), flex: 1, justifyContent: "center" }, onClick: generate, disabled: busy === "generate", "data-testid": "blog-generate", children: busy === "generate" ? "Starting\u2026" : `Generate ${Math.max(count, topics.split("\n").filter((t) => t.trim()).length)} drafts` }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: btn("secondary"),
              disabled: busy === "ideas",
              onClick: () => act("ideas", async () => {
                const r = await call("/blog/ideas", { json: { count: 6, audience, theme: instruction } });
                setIdeas(r.ideas);
              }),
              children: busy === "ideas" ? "\u2026" : "Ideas"
            }
          )
        ] }),
        ideas.length > 0 && /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 6, marginTop: 12 }, children: ideas.map((i) => /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: () => setTopics((t) => t.includes(i.title) ? t : `${t ? `${t}
` : ""}${i.title}`),
            style: { ...btn("secondary", true), whiteSpace: "normal", textAlign: "left", justifyContent: "flex-start", display: "block" },
            children: [
              /* @__PURE__ */ jsxs("div", { style: { fontWeight: 700 }, children: [
                "+ ",
                i.title
              ] }),
              /* @__PURE__ */ jsx("div", { style: { fontWeight: 400, color: C.muted }, children: i.angle })
            ]
          },
          i.title
        )) })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { ...card, padding: 0 }, children: [
        /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 4, padding: 10, borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }, children: ["", "draft", "approved", "scheduled", "published"].map((s) => /* @__PURE__ */ jsx("button", { onClick: () => setFilter(s), style: { ...btn(filter === s ? "primary" : "secondary", true), textTransform: "capitalize" }, children: s || "All" }, s || "all")) }),
        /* @__PURE__ */ jsxs("div", { style: { maxHeight: 520, overflowY: "auto" }, children: [
          posts.length === 0 && /* @__PURE__ */ jsx("div", { style: { padding: 16, fontSize: 13, color: C.muted }, children: "No posts yet." }),
          posts.map((p) => /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => onFocus(p.id),
              "data-testid": `blog-post-row-${p.slug}`,
              style: {
                display: "flex",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: 10,
                border: 0,
                borderBottom: `1px solid ${C.line}`,
                background: focusId === p.id ? "#eff6ff" : "#fff",
                cursor: "pointer",
                fontFamily: "inherit"
              },
              children: [
                /* @__PURE__ */ jsx("div", { style: { width: 64, height: 40, borderRadius: 6, flexShrink: 0, background: "#e2e8f0", overflow: "hidden" }, children: (p.heroImageUrl || p.status === "published") && /* @__PURE__ */ jsx(
                  "img",
                  {
                    src: p.heroImageUrl ? resolveAsset(p.heroImageUrl) : coverUrl(p.slug),
                    alt: "",
                    onError: (e) => e.currentTarget.style.display = "none",
                    style: { width: "100%", height: "100%", objectFit: "cover" }
                  }
                ) }),
                /* @__PURE__ */ jsxs("div", { style: { minWidth: 0 }, children: [
                  /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: p.title }),
                  /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", marginTop: 3 }, children: [
                    /* @__PURE__ */ jsx(Badge, { status: p.status }),
                    /* @__PURE__ */ jsx("span", { style: { fontSize: 11, color: C.muted }, children: p.audience })
                  ] })
                ] })
              ]
            },
            p.id
          ))
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { children: [
      !post && /* @__PURE__ */ jsxs("div", { style: { ...card, textAlign: "center", padding: 48, color: C.muted }, children: [
        /* @__PURE__ */ jsx("div", { style: { fontFamily: "Georgia,serif", fontSize: 20, color: C.ink, marginBottom: 6 }, children: "Select a post" }),
        "Generate a batch or pick a draft to review SEO, rewrite sections, regenerate artwork, and publish."
      ] }),
      post && detail && /* @__PURE__ */ jsx(
        PostEditor,
        {
          detail,
          busy,
          act,
          call,
          notify,
          resolveAsset,
          publicOrigin,
          onChanged: async (next) => {
            if (next) setDetail((d) => d ? { ...d, post: next } : d);
            await loadDetail(post.id);
            await load();
          },
          onPreview: async () => {
            const html = await call(`/blog/posts/${post.id}/preview`, { headers: { Accept: "text/html" } });
            setPreview(assetOrigin ? html.replace("<head>", `<head><base href="${assetOrigin}/">`) : html);
          }
        },
        post.id + post.updatedAt
      )
    ] }),
    preview && /* @__PURE__ */ jsx("div", { style: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }, onClick: () => setPreview(null), children: /* @__PURE__ */ jsxs("div", { style: { width: "min(1100px,100%)", height: "90vh", background: "#fff", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }, onClick: (e) => e.stopPropagation(), children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.line}` }, children: [
        /* @__PURE__ */ jsx("strong", { style: { fontSize: 13 }, children: "Preview (not indexed)" }),
        /* @__PURE__ */ jsx("button", { style: btn("secondary", true), onClick: () => setPreview(null), children: "Close" })
      ] }),
      /* @__PURE__ */ jsx("iframe", { title: "Post preview", srcDoc: preview, sandbox: "allow-same-origin", style: { flex: 1, border: 0 } })
    ] }) })
  ] });
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
  onPreview
}) {
  const { post, revisions, assets, sections } = detail;
  const [edit, setEdit] = useState({
    title: post.title,
    slug: post.slug,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    excerpt: post.excerpt,
    targetKeywords: post.targetKeywords.join(", "),
    bodyMarkdown: post.bodyMarkdown
  });
  const [rewrite, setRewrite] = useState("");
  const [scope, setScope] = useState("");
  const [artInstruction, setArtInstruction] = useState("");
  const [artMode, setArtMode] = useState(post.artworkMode);
  const [publishAt, setPublishAt] = useState("");
  const dirty = edit.title !== post.title || edit.slug !== post.slug || edit.seoTitle !== post.seoTitle || edit.seoDescription !== post.seoDescription || edit.excerpt !== post.excerpt || edit.targetKeywords !== post.targetKeywords.join(", ") || edit.bodyMarkdown !== post.bodyMarkdown;
  const isGenerating = post.status === "generating";
  const liveUrl = `${publicOrigin}/blog/${post.slug}`;
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12 }, "data-testid": "blog-post-editor", children: [
    /* @__PURE__ */ jsxs("div", { style: { ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxs("div", { style: { minWidth: 0 }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
          /* @__PURE__ */ jsx(Badge, { status: post.status }),
          /* @__PURE__ */ jsxs("span", { style: { fontSize: 12, color: C.muted }, children: [
            post.readingTimeMinutes,
            " min read \xB7 updated ",
            fmtDate(post.updatedAt)
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { style: { fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700, marginTop: 4 }, children: post.title }),
        post.generationError && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.warn, marginTop: 4 }, children: post.generationError })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ jsx("button", { style: btn("secondary", true), onClick: () => act("preview", onPreview), disabled: isGenerating, children: "Preview" }),
        /* @__PURE__ */ jsx(
          "button",
          {
            style: btn("secondary", true),
            disabled: isGenerating || busy === "regen",
            "data-testid": "blog-regenerate",
            onClick: () => act("regen", async () => {
              await call(`/blog/posts/${post.id}/regenerate`, { json: { instruction: rewrite || void 0, artworkMode: artMode } });
              notify("ok", "Regenerating post and artwork\u2026");
              await onChanged();
            }),
            children: busy === "regen" ? "\u2026" : "1-Click Regenerate"
          }
        ),
        post.status !== "published" && post.status !== "approved" && /* @__PURE__ */ jsx(
          "button",
          {
            style: btn("secondary", true),
            disabled: isGenerating,
            "data-testid": "blog-approve",
            onClick: () => act("approve", async () => {
              const r = await call(`/blog/posts/${post.id}/approve`, { json: {} });
              notify("ok", "Approved");
              await onChanged(r.post);
            }),
            children: "Approve"
          }
        ),
        post.status === "published" ? /* @__PURE__ */ jsxs(Fragment, { children: [
          publicOrigin !== void 0 && /* @__PURE__ */ jsx("a", { href: liveUrl, target: "_blank", rel: "noreferrer", style: { ...btn("secondary", true), textDecoration: "none" }, children: "View live" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: btn("danger", true),
              onClick: () => act("unpublish", async () => {
                const r = await call(`/blog/posts/${post.id}/unpublish`, { json: {} });
                await onChanged(r.post);
              }),
              children: "Unpublish"
            }
          )
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("input", { type: "datetime-local", value: publishAt, onChange: (e) => setPublishAt(e.target.value), style: { ...input, width: 190, padding: "5px 8px", fontSize: 12 }, title: "Optional: schedule publish" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: btn("primary", true),
              disabled: isGenerating || dirty,
              title: dirty ? "Save edits first" : void 0,
              "data-testid": "blog-publish",
              onClick: () => act("publish", async () => {
                const r = await call(`/blog/posts/${post.id}/publish`, { json: publishAt ? { publishAt: new Date(publishAt).toISOString() } : {} });
                notify("ok", r.post.status === "scheduled" ? `Scheduled for ${fmtDate(r.post.publishedAt)}` : "Published");
                await onChanged(r.post);
              }),
              children: publishAt ? "Schedule" : "Publish"
            }
          )
        ] })
      ] })
    ] }),
    isGenerating ? /* @__PURE__ */ jsx("div", { style: { ...card, padding: 40, textAlign: "center", color: C.muted }, children: "Writing the article and creating artwork\u2026 this usually takes under a minute." }) : /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 12 }, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12, alignContent: "start" }, children: [
        /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }, children: [
            /* @__PURE__ */ jsx("h4", { style: { ...sectionTitle, margin: 0 }, children: "Hero artwork" }),
            /* @__PURE__ */ jsx(Badge, { status: post.artworkStatus === "approved" ? "approved" : post.artworkStatus === "generating" ? "generating" : "draft" })
          ] }),
          /* @__PURE__ */ jsx("div", { style: { aspectRatio: "1200 / 630", background: "#e2e8f0", borderRadius: 10, overflow: "hidden" }, children: post.heroImageUrl ? /* @__PURE__ */ jsx("img", { src: resolveAsset(post.heroImageUrl), alt: post.title, style: { width: "100%", height: "100%", objectFit: "cover" }, "data-testid": "blog-hero-image" }) : /* @__PURE__ */ jsx("div", { style: { display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }, children: "No artwork yet" }) }),
          assets.length > 1 && /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, marginTop: 8, overflowX: "auto" }, children: assets.map((a) => /* @__PURE__ */ jsx(
            "button",
            {
              title: a.customInstruction || a.mode,
              onClick: () => act("pick-art", async () => {
                const r = await call(`/blog/posts/${post.id}/artwork/approve`, { json: { assetUrl: a.imageUrl } });
                await onChanged(r.post);
              }),
              style: { padding: 0, border: `2px solid ${a.imageUrl === post.heroImageUrl ? C.accent : "transparent"}`, borderRadius: 6, background: "none", cursor: "pointer", flexShrink: 0 },
              children: /* @__PURE__ */ jsx("img", { src: resolveAsset(a.imageUrl), alt: "", style: { width: 72, height: 38, objectFit: "cover", borderRadius: 4, display: "block" } })
            },
            a.id
          )) }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, marginTop: 10 }, children: ["ai_illustration", "studio_card"].map((m) => /* @__PURE__ */ jsx("button", { onClick: () => setArtMode(m), style: { ...btn(artMode === m ? "primary" : "secondary", true), flex: 1, justifyContent: "center" }, children: m === "ai_illustration" ? "AI illustration" : "Studio card" }, m)) }),
          /* @__PURE__ */ jsx("input", { value: artInstruction, onChange: (e) => setArtInstruction(e.target.value), placeholder: "Art direction, e.g. warmer light, show a kitchen table", style: { ...input, marginTop: 8 }, "data-testid": "blog-artwork-instruction" }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, marginTop: 8 }, children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                style: { ...btn("secondary", true), flex: 1, justifyContent: "center" },
                disabled: busy === "art",
                "data-testid": "blog-artwork-regenerate",
                onClick: () => act("art", async () => {
                  const r = await call(`/blog/posts/${post.id}/artwork`, { json: { mode: artMode, instruction: artInstruction || void 0 } });
                  if (r.warning) notify("err", r.warning);
                  setArtInstruction("");
                  await onChanged(r.post);
                }),
                children: busy === "art" ? "Generating\u2026" : "Regenerate artwork"
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                style: { ...btn("secondary", true), flex: 1, justifyContent: "center" },
                disabled: post.artworkStatus === "approved",
                onClick: () => act("art-approve", async () => {
                  const r = await call(`/blog/posts/${post.id}/artwork/approve`, { json: {} });
                  await onChanged(r.post);
                }),
                children: "Approve artwork"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Rewrite with instructions" }),
          /* @__PURE__ */ jsxs("select", { value: scope, onChange: (e) => setScope(e.target.value), style: input, children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Whole post" }),
            sections.map((s) => /* @__PURE__ */ jsxs("option", { value: s, children: [
              "Section: ",
              s
            ] }, s))
          ] }),
          /* @__PURE__ */ jsx("textarea", { value: rewrite, onChange: (e) => setRewrite(e.target.value), rows: 3, placeholder: "e.g. Shorten the intro, add a Texas-specific checklist, make the tone warmer", style: { ...input, marginTop: 8, resize: "vertical" }, "data-testid": "blog-rewrite-instruction" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn("primary", true), marginTop: 8 },
              disabled: !rewrite.trim() || busy === "rewrite",
              "data-testid": "blog-rewrite",
              onClick: () => act("rewrite", async () => {
                const r = await call(`/blog/posts/${post.id}/rewrite`, { json: { instruction: rewrite, sectionHeading: scope || void 0 } });
                notify("ok", scope ? `Rewrote "${scope}"` : "Rewrote post");
                setRewrite("");
                await onChanged(r.post);
              }),
              children: busy === "rewrite" ? "Rewriting\u2026" : "Rewrite"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }, children: [
            /* @__PURE__ */ jsx("h4", { style: { ...sectionTitle, margin: 0 }, children: "Article (markdown)" }),
            dirty && /* @__PURE__ */ jsx("span", { style: { fontSize: 12, color: C.warn }, children: "Unsaved changes" })
          ] }),
          /* @__PURE__ */ jsx("textarea", { value: edit.bodyMarkdown, onChange: (e) => setEdit({ ...edit, bodyMarkdown: e.target.value }), rows: 18, style: { ...input, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12.5, lineHeight: 1.55, resize: "vertical" } })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12, alignContent: "start" }, children: [
        /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "SEO" }),
          /* @__PURE__ */ jsx("label", { style: label, children: "Title (H1)" }),
          /* @__PURE__ */ jsx("input", { value: edit.title, onChange: (e) => setEdit({ ...edit, title: e.target.value }), style: input }),
          /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Slug" }),
          /* @__PURE__ */ jsx("input", { value: edit.slug, onChange: (e) => setEdit({ ...edit, slug: e.target.value }), style: input }),
          /* @__PURE__ */ jsxs("label", { style: { ...label, marginTop: 10, display: "flex", justifyContent: "space-between" }, children: [
            /* @__PURE__ */ jsx("span", { children: "SEO title" }),
            /* @__PURE__ */ jsxs("span", { style: { color: edit.seoTitle.length > 60 ? C.bad : C.muted, fontWeight: 400 }, children: [
              edit.seoTitle.length,
              "/60"
            ] })
          ] }),
          /* @__PURE__ */ jsx("input", { value: edit.seoTitle, onChange: (e) => setEdit({ ...edit, seoTitle: e.target.value }), style: input }),
          /* @__PURE__ */ jsxs("label", { style: { ...label, marginTop: 10, display: "flex", justifyContent: "space-between" }, children: [
            /* @__PURE__ */ jsx("span", { children: "Meta description" }),
            /* @__PURE__ */ jsxs("span", { style: { color: edit.seoDescription.length > 155 ? C.bad : C.muted, fontWeight: 400 }, children: [
              edit.seoDescription.length,
              "/155"
            ] })
          ] }),
          /* @__PURE__ */ jsx("textarea", { value: edit.seoDescription, onChange: (e) => setEdit({ ...edit, seoDescription: e.target.value }), rows: 3, style: { ...input, resize: "vertical" } }),
          /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Excerpt" }),
          /* @__PURE__ */ jsx("textarea", { value: edit.excerpt, onChange: (e) => setEdit({ ...edit, excerpt: e.target.value }), rows: 2, style: { ...input, resize: "vertical" } }),
          /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Target keywords" }),
          /* @__PURE__ */ jsx("input", { value: edit.targetKeywords, onChange: (e) => setEdit({ ...edit, targetKeywords: e.target.value }), style: input }),
          /* @__PURE__ */ jsxs("div", { style: { marginTop: 12, padding: 12, borderRadius: 10, background: C.surface, border: `1px solid ${C.line}` }, children: [
            /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: C.muted, marginBottom: 2 }, children: "Search preview" }),
            /* @__PURE__ */ jsx("div", { style: { color: "#1a0dab", fontSize: 16, lineHeight: 1.3 }, children: edit.seoTitle || edit.title }),
            /* @__PURE__ */ jsxs("div", { style: { color: "#006621", fontSize: 12 }, children: [
              (publicOrigin || "").replace(/^https?:\/\//, "") || "yourdomain",
              "/blog/",
              edit.slug
            ] }),
            /* @__PURE__ */ jsx("div", { style: { color: "#4d5156", fontSize: 13 }, children: edit.seoDescription })
          ] }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn("primary", true), marginTop: 12 },
              disabled: !dirty || busy === "save",
              onClick: () => act("save", async () => {
                const r = await call(`/blog/posts/${post.id}`, {
                  method: "PATCH",
                  json: { ...edit, targetKeywords: edit.targetKeywords.split(",").map((k) => k.trim()).filter(Boolean) }
                });
                notify("ok", "Saved");
                await onChanged(r.post);
              }),
              children: busy === "save" ? "Saving\u2026" : "Save changes"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "FAQ (FAQPage schema)" }),
          post.faqItems.length === 0 && /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: C.muted }, children: "No FAQ items." }),
          post.faqItems.map((f) => /* @__PURE__ */ jsxs("div", { style: { marginBottom: 10 }, children: [
            /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600 }, children: f.question }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted }, children: f.answer })
          ] }, f.question)),
          /* @__PURE__ */ jsxs("div", { style: { fontSize: 12, color: C.muted, borderTop: `1px solid ${C.line}`, paddingTop: 8 }, children: [
            "CTA: ",
            /* @__PURE__ */ jsx("strong", { children: post.ctaLabel }),
            " \u2192 ",
            post.ctaUrl
          ] })
        ] }),
        revisions.length > 0 && /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Revision history" }),
          /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }, children: revisions.map((r) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, alignItems: "center" }, children: [
            /* @__PURE__ */ jsxs("div", { style: { minWidth: 0 }, children: [
              /* @__PURE__ */ jsx("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: r.instruction }),
              /* @__PURE__ */ jsx("div", { style: { color: C.muted }, children: fmtDate(r.createdAt) })
            ] }),
            /* @__PURE__ */ jsx(
              "button",
              {
                style: btn("ghost", true),
                onClick: () => act("restore", async () => {
                  const res = await call(`/blog/posts/${post.id}/revisions/${r.id}/restore`, { json: {} });
                  notify("ok", "Restored previous version");
                  await onChanged(res.post);
                }),
                children: "Restore"
              }
            )
          ] }, r.id)) })
        ] })
      ] })
    ] })
  ] });
}
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
  emailEnabled
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [detail, setDetail] = useState(null);
  const [segmentId, setSegmentId] = useState(prefill?.segmentId || "");
  const [goal, setGoal] = useState(prefill?.goal || "");
  const [filter, setFilter] = useState(prefill?.filter || null);
  const [layout, setLayout] = useState("editorial");
  const [artworkMode, setArtworkMode] = useState("ai_illustration");
  const [ideas, setIdeas] = useState([]);
  const [busy, setBusy] = useState(null);
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
    const r = await call("/email/campaigns");
    setCampaigns(r.campaigns);
  }, [call]);
  const loadDetail = useCallback(async (id) => setDetail(await call(`/email/campaigns/${id}`)), [call]);
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
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      notify("err", err.message);
    } finally {
      setBusy(null);
    }
  };
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "340px minmax(0,1fr)", gap: 16 }, "data-testid": "marketing-email-studio", children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, alignContent: "start", minWidth: 0 }, children: [
      /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "New campaign" }),
        /* @__PURE__ */ jsx("label", { style: label, children: "Audience" }),
        /* @__PURE__ */ jsx("select", { value: segmentId, onChange: (e) => setSegmentId(e.target.value), style: input, "data-testid": "email-segment", children: segments.map((s) => /* @__PURE__ */ jsxs("option", { value: s.id, children: [
          s.label,
          s.id !== "custom" ? ` (${s.count})` : ""
        ] }, s.id)) }),
        filter && /* @__PURE__ */ jsxs("div", { style: { fontSize: 12, color: C.muted, marginTop: 6 }, children: [
          "Custom filter: ",
          Object.entries(filter).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`).join(", ")
        ] }),
        /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Goal / brief" }),
        /* @__PURE__ */ jsx("textarea", { value: goal, onChange: (e) => setGoal(e.target.value), rows: 3, placeholder: "e.g. Remind free users their research is saved and documents unlock for $29", style: { ...input, resize: "vertical" }, "data-testid": "email-goal" }),
        /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginTop: 10 }, children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { style: label, children: "Layout" }),
            /* @__PURE__ */ jsxs("select", { value: layout, onChange: (e) => setLayout(e.target.value), style: input, children: [
              /* @__PURE__ */ jsx("option", { value: "editorial", children: "Editorial" }),
              /* @__PURE__ */ jsx("option", { value: "spotlight", children: "Spotlight" }),
              /* @__PURE__ */ jsx("option", { value: "minimal", children: "Minimal letter" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("label", { style: label, children: "Banner" }),
            /* @__PURE__ */ jsxs("select", { value: artworkMode, onChange: (e) => setArtworkMode(e.target.value), style: input, children: [
              /* @__PURE__ */ jsx("option", { value: "ai_illustration", children: "AI illustration" }),
              /* @__PURE__ */ jsx("option", { value: "studio_card", children: "Studio card" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 12 }, children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn("primary"), flex: 1, justifyContent: "center" },
              disabled: !goal.trim() || !segmentId || busy === "create",
              "data-testid": "email-create",
              onClick: () => act("create", async () => {
                const r = await call("/email/campaigns", { json: { segmentId, goal, layout, artworkMode, filter: segmentId === "custom" ? filter : void 0 } });
                if (r.warning) notify("err", r.warning);
                else notify("ok", "Campaign drafted");
                setGoal("");
                setIdeas([]);
                await load();
                onFocus(r.campaign.id);
              }),
              children: busy === "create" ? "Designing\u2026" : "Design email"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: btn("secondary"),
              disabled: busy === "ideas" || !segmentId,
              onClick: () => act("ideas", async () => {
                const r = await call("/email/ideas", { json: { segmentId, goal } });
                setIdeas(r.ideas);
              }),
              children: busy === "ideas" ? "\u2026" : "Ideas"
            }
          )
        ] }),
        ideas.length > 0 && /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: 6, marginTop: 12 }, children: ideas.map((i) => /* @__PURE__ */ jsxs("button", { onClick: () => setGoal(`${i.name}: ${i.angle} Subject idea: "${i.subject}"`), style: { ...btn("secondary", true), whiteSpace: "normal", textAlign: "left", display: "block" }, children: [
          /* @__PURE__ */ jsx("div", { style: { fontWeight: 700 }, children: i.subject }),
          /* @__PURE__ */ jsx("div", { style: { fontWeight: 400, color: C.muted }, children: i.angle })
        ] }, i.subject)) })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { ...card, padding: 0 }, children: [
        /* @__PURE__ */ jsx("div", { style: { padding: "10px 12px", borderBottom: `1px solid ${C.line}`, fontSize: 13, fontWeight: 700 }, children: "Campaigns" }),
        /* @__PURE__ */ jsxs("div", { style: { maxHeight: 460, overflowY: "auto" }, children: [
          campaigns.length === 0 && /* @__PURE__ */ jsx("div", { style: { padding: 16, fontSize: 13, color: C.muted }, children: "No campaigns yet." }),
          campaigns.map((c) => /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => onFocus(c.id),
              style: { display: "block", width: "100%", textAlign: "left", padding: 10, border: 0, borderBottom: `1px solid ${C.line}`, background: focusId === c.id ? "#eff6ff" : "#fff", cursor: "pointer", fontFamily: "inherit" },
              children: [
                /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.name }),
                c.subject && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }, children: c.subject }),
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", marginTop: 3 }, children: [
                  /* @__PURE__ */ jsx(Badge, { status: c.status }),
                  /* @__PURE__ */ jsxs("span", { style: { fontSize: 11, color: C.muted }, children: [
                    c.segmentId,
                    c.sentCount ? ` \xB7 ${c.sentCount} sent \xB7 ${c.openedCount} opens` : ""
                  ] })
                ] })
              ]
            },
            c.id
          ))
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { children: [
      !detail && /* @__PURE__ */ jsxs("div", { style: { ...card, textAlign: "center", padding: 48, color: C.muted }, children: [
        /* @__PURE__ */ jsx("div", { style: { fontFamily: "Georgia,serif", fontSize: 20, color: C.ink, marginBottom: 6 }, children: "Design a campaign" }),
        "Pick an audience and describe the goal. Every campaign gets responsive HTML, banner artwork, a desktop/mobile preview, and test sends before anything goes out."
      ] }),
      detail && /* @__PURE__ */ jsx(
        CampaignEditor,
        {
          detail,
          call,
          notify,
          busy,
          act,
          assetOrigin,
          emailEnabled,
          onChanged: async () => {
            await loadDetail(detail.campaign.id);
            await load();
          }
        },
        detail.campaign.id + detail.campaign.updatedAt
      )
    ] })
  ] });
}
function CampaignEditor({
  detail,
  call,
  notify,
  busy,
  act,
  assetOrigin,
  emailEnabled,
  onChanged
}) {
  const c = detail.campaign;
  const [device, setDevice] = useState("desktop");
  const [html, setHtml] = useState("");
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState("all");
  const [subject, setSubject] = useState(c.subject);
  const [preheader, setPreheader] = useState(c.preheader);
  const [testTo, setTestTo] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const editable = !["sending", "sent"].includes(c.status);
  useEffect(() => {
    call(`/email/campaigns/${c.id}/preview`, { headers: { Accept: "text/html" } }).then((h) => setHtml(assetOrigin ? h.replace("<head>", `<head><base href="${assetOrigin}/">`) : h)).catch(() => setHtml(""));
  }, [call, c.id, c.updatedAt, assetOrigin]);
  const stats = [
    ["Recipients", c.recipientCount],
    ["Sent", c.sentCount],
    ["Delivered", c.deliveredCount],
    ["Opened", c.openedCount],
    ["Clicked", c.clickedCount],
    ["Bounced", c.bouncedCount],
    ["Unsubscribed", c.unsubscribedCount]
  ];
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12 }, "data-testid": "email-campaign-editor", children: [
    /* @__PURE__ */ jsxs("div", { style: { ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
          /* @__PURE__ */ jsx(Badge, { status: c.status }),
          /* @__PURE__ */ jsxs("span", { style: { fontSize: 12, color: C.muted }, children: [
            c.segmentId,
            " \xB7 ",
            c.layout,
            " layout",
            c.scheduledAt && c.status === "scheduled" ? ` \xB7 sends ${fmtDate(c.scheduledAt)}` : "",
            c.sentAt ? ` \xB7 sent ${fmtDate(c.sentAt)}` : ""
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { style: { fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 700, marginTop: 4 }, children: c.name }),
        c.lastError && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.warn, marginTop: 4 }, children: c.lastError })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [
        editable && c.status !== "approved" && c.status !== "scheduled" && /* @__PURE__ */ jsx(
          "button",
          {
            style: btn("secondary", true),
            "data-testid": "email-approve",
            onClick: () => act("approve", async () => {
              await call(`/email/campaigns/${c.id}/approve`, { json: {} });
              notify("ok", "Approved \u2014 ready to send");
              await onChanged();
            }),
            children: "Approve"
          }
        ),
        c.status === "scheduled" && /* @__PURE__ */ jsx(
          "button",
          {
            style: btn("secondary", true),
            onClick: () => act("unschedule", async () => {
              await call(`/email/campaigns/${c.id}/cancel-schedule`, { json: {} });
              await onChanged();
            }),
            children: "Cancel schedule"
          }
        ),
        c.status === "approved" && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("input", { type: "datetime-local", value: scheduleAt, onChange: (e) => setScheduleAt(e.target.value), style: { ...input, width: 190, padding: "5px 8px", fontSize: 12 }, title: "Optional: schedule" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: btn("primary", true),
              disabled: !emailEnabled || busy === "send",
              title: emailEnabled ? void 0 : "Configure Resend first",
              "data-testid": "email-send",
              onClick: () => act("send", async () => {
                if (!scheduleAt && !window.confirm(`Send "${c.subject}" to the ${c.segmentId} audience now?`)) return;
                await call(`/email/campaigns/${c.id}/send`, { json: scheduleAt ? { scheduledAt: new Date(scheduleAt).toISOString() } : {} });
                notify("ok", scheduleAt ? "Scheduled" : "Sending\u2026");
                await onChanged();
              }),
              children: scheduleAt ? "Schedule" : "Send now"
            }
          )
        ] })
      ] })
    ] }),
    (c.status === "sent" || c.status === "sending") && /* @__PURE__ */ jsx("div", { style: { ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10 }, children: stats.map(([k, v]) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }, children: k }),
      /* @__PURE__ */ jsx("div", { style: { fontSize: 20, fontWeight: 700 }, children: v })
    ] }, k)) }),
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 12 }, children: [
      /* @__PURE__ */ jsxs("div", { style: { ...card, padding: 0, overflow: "hidden" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${C.line}` }, children: [
          /* @__PURE__ */ jsxs("div", { style: { fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
            /* @__PURE__ */ jsx("strong", { style: { color: C.ink }, children: c.subject }),
            " \u2014 ",
            c.preheader
          ] }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 4 }, "data-testid": "email-device-toggle", children: ["desktop", "mobile"].map((d) => /* @__PURE__ */ jsx("button", { onClick: () => setDevice(d), style: { ...btn(device === d ? "primary" : "secondary", true), textTransform: "capitalize" }, children: d }, d)) })
        ] }),
        /* @__PURE__ */ jsx("div", { style: { background: "#e2e8f0", padding: device === "mobile" ? "18px 0" : 0, display: "flex", justifyContent: "center" }, children: /* @__PURE__ */ jsx(
          "iframe",
          {
            title: "Email preview",
            srcDoc: html,
            sandbox: "allow-same-origin",
            "data-testid": "email-preview-frame",
            style: {
              width: device === "mobile" ? 375 : "100%",
              height: 680,
              border: device === "mobile" ? "10px solid #0f172a" : 0,
              borderRadius: device === "mobile" ? 28 : 0,
              background: "#fff"
            }
          }
        ) })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12, alignContent: "start" }, children: [
        editable && /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Refine with instructions" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }, children: ["all", "copy", "layout", "artwork"].map((t) => /* @__PURE__ */ jsx("button", { onClick: () => setTarget(t), style: { ...btn(target === t ? "primary" : "secondary", true), textTransform: "capitalize" }, children: t }, t)) }),
          /* @__PURE__ */ jsx("textarea", { value: instruction, onChange: (e) => setInstruction(e.target.value), rows: 3, placeholder: target === "layout" ? "e.g. make it a minimal personal letter" : target === "artwork" ? "e.g. sunrise over a city, warmer palette" : "e.g. Shorter, friendlier, mention the $29 unlock", style: { ...input, resize: "vertical" }, "data-testid": "email-refine-instruction" }),
          target === "layout" && /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 4, marginTop: 8 }, children: ["editorial", "spotlight", "minimal"].map((l) => /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn(c.layout === l ? "primary" : "secondary", true), textTransform: "capitalize" },
              onClick: () => act("layout", async () => {
                await call(`/email/campaigns/${c.id}/refine`, { json: { target: "layout", layout: l, instruction: `Switch to ${l}` } });
                await onChanged();
              }),
              children: l
            },
            l
          )) }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn("primary", true), marginTop: 8 },
              disabled: busy === "refine" || !instruction.trim() && target !== "artwork",
              "data-testid": "email-refine",
              onClick: () => act("refine", async () => {
                const r = await call(`/email/campaigns/${c.id}/refine`, { json: { target, instruction } });
                if (r.warning) notify("err", r.warning);
                else notify("ok", "Updated");
                setInstruction("");
                await onChanged();
              }),
              children: busy === "refine" ? "Refining\u2026" : target === "artwork" ? "Regenerate banner" : "Apply"
            }
          )
        ] }),
        editable && /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Subject & preheader" }),
          /* @__PURE__ */ jsx("input", { value: subject, onChange: (e) => setSubject(e.target.value), style: input }),
          /* @__PURE__ */ jsx("input", { value: preheader, onChange: (e) => setPreheader(e.target.value), style: { ...input, marginTop: 8 } }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn("secondary", true), marginTop: 8 },
              disabled: subject === c.subject && preheader === c.preheader || busy === "save",
              onClick: () => act("save", async () => {
                await call(`/email/campaigns/${c.id}`, { method: "PATCH", json: { subject, preheader } });
                notify("ok", "Saved");
                await onChanged();
              }),
              children: "Save"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Test send" }),
          /* @__PURE__ */ jsx("input", { value: testTo, onChange: (e) => setTestTo(e.target.value), placeholder: "Defaults to your admin email", style: input }),
          /* @__PURE__ */ jsx(
            "button",
            {
              style: { ...btn("secondary", true), marginTop: 8 },
              disabled: !emailEnabled || busy === "test",
              "data-testid": "email-test-send",
              onClick: () => act("test", async () => {
                const r = await call(`/email/campaigns/${c.id}/test-send`, { json: testTo ? { to: testTo } : {} });
                notify("ok", `Test sent to ${r.to}`);
              }),
              children: busy === "test" ? "Sending\u2026" : "Send test"
            }
          ),
          !emailEnabled && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.warn, marginTop: 6 }, children: "Resend is not configured for this app." })
        ] }),
        detail.recipients.length > 0 && /* @__PURE__ */ jsxs("div", { style: card, children: [
          /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Recipients" }),
          /* @__PURE__ */ jsx("div", { style: { maxHeight: 200, overflowY: "auto", fontSize: 12 }, children: detail.recipients.map((r) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.line}` }, children: [
            /* @__PURE__ */ jsx("span", { children: r.email }),
            /* @__PURE__ */ jsx("span", { style: { color: C.muted }, children: r.unsubscribed_at ? "unsubscribed" : r.bounced_at ? "bounced" : r.clicked_at ? "clicked" : r.opened_at ? "opened" : r.status })
          ] }, r.email)) })
        ] })
      ] })
    ] })
  ] });
}
function AudiencesPanel({ call, segments, onDraft }) {
  const [userTypes, setUserTypes] = useState([]);
  const [planTiers, setPlanTiers] = useState("");
  const [signedUpAfter, setSignedUpAfter] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [hasLockedMatter, setHasLockedMatter] = useState(false);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const filter = useMemo(() => {
    const f = {};
    if (userTypes.length) f.userTypes = userTypes;
    if (planTiers.trim()) f.planTiers = planTiers.split(",").map((s) => s.trim()).filter(Boolean);
    if (signedUpAfter) f.signedUpAfter = new Date(signedUpAfter).toISOString();
    if (emailDomain.trim()) f.emailDomain = emailDomain.trim().replace(/^@/, "");
    if (hasLockedMatter) f.hasLockedMatter = true;
    return f;
  }, [userTypes, planTiers, signedUpAfter, emailDomain, hasLockedMatter]);
  const preview = async (segmentId, f) => {
    setSelected(segmentId);
    setError(null);
    try {
      setResult(await call(`/segments/preview`, { json: { segmentId, filter: f } }));
    } catch (err) {
      setError(err.message);
      setResult(null);
    }
  };
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 16 }, "data-testid": "marketing-audiences", children: [
    /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12, alignContent: "start" }, children: segments.filter((s) => s.id !== "custom").map((s) => /* @__PURE__ */ jsxs("div", { style: { ...card, borderColor: selected === s.id ? C.accent : C.line }, children: [
      /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted, fontFamily: "ui-monospace,Menlo,monospace" }, children: s.id }),
      /* @__PURE__ */ jsx("div", { style: { fontSize: 15, fontWeight: 700, marginTop: 2 }, children: s.label }),
      /* @__PURE__ */ jsx("div", { style: { fontSize: 28, fontWeight: 700, color: C.primary, margin: "6px 0" }, children: s.count.toLocaleString() }),
      /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted, minHeight: 32 }, children: s.description }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, marginTop: 10 }, children: [
        /* @__PURE__ */ jsx("button", { style: btn("secondary", true), onClick: () => preview(s.id), children: "Preview" }),
        /* @__PURE__ */ jsx("button", { style: btn("primary", true), onClick: () => onDraft({ segmentId: s.id }), children: "Draft email" })
      ] })
    ] }, s.id)) }),
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12, alignContent: "start" }, children: [
      /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Custom filter" }),
        /* @__PURE__ */ jsx("label", { style: label, children: "User type" }),
        /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: ["individual", "attorney", "firm_admin", "firm_member"].map((t) => /* @__PURE__ */ jsx("button", { onClick: () => setUserTypes((u) => u.includes(t) ? u.filter((x) => x !== t) : [...u, t]), style: btn(userTypes.includes(t) ? "primary" : "secondary", true), children: t }, t)) }),
        /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Plan tiers (comma-separated)" }),
        /* @__PURE__ */ jsx("input", { value: planTiers, onChange: (e) => setPlanTiers(e.target.value), placeholder: "free, pro", style: input }),
        /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Signed up after" }),
        /* @__PURE__ */ jsx("input", { type: "date", value: signedUpAfter, onChange: (e) => setSignedUpAfter(e.target.value), style: input }),
        /* @__PURE__ */ jsx("label", { style: { ...label, marginTop: 10 }, children: "Email domain" }),
        /* @__PURE__ */ jsx("input", { value: emailDomain, onChange: (e) => setEmailDomain(e.target.value), placeholder: "example.com", style: input }),
        /* @__PURE__ */ jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 10 }, children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: hasLockedMatter, onChange: (e) => setHasLockedMatter(e.target.checked) }),
          " Has a locked free matter"
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6, marginTop: 12 }, children: [
          /* @__PURE__ */ jsx("button", { style: btn("secondary", true), onClick: () => preview("custom", filter), children: "Preview audience" }),
          /* @__PURE__ */ jsx("button", { style: btn("primary", true), onClick: () => onDraft({ segmentId: "custom", filter }), children: "Draft email" })
        ] })
      ] }),
      (result || error) && /* @__PURE__ */ jsxs("div", { style: card, children: [
        /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: selected === "custom" ? "Custom audience" : selected }),
        error && /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: C.bad }, children: error }),
        result && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { style: { fontSize: 13 }, children: [
            /* @__PURE__ */ jsx("strong", { children: result.count }),
            " eligible \xB7 ",
            result.suppressed,
            " suppressed (unsubscribed or opted out)"
          ] }),
          /* @__PURE__ */ jsx("div", { style: { marginTop: 8, fontSize: 12 }, children: result.sample.map((s) => /* @__PURE__ */ jsxs("div", { style: { padding: "4px 0", borderBottom: `1px solid ${C.line}` }, children: [
            s.name || s.email,
            " ",
            /* @__PURE__ */ jsxs("span", { style: { color: C.muted }, children: [
              "\xB7 ",
              s.userType || s.planTier,
              s.matterTitle ? ` \xB7 ${s.matterTitle}` : ""
            ] })
          ] }, s.email)) })
        ] })
      ] })
    ] })
  ] });
}
function Stat({ label: l, value, hint }) {
  return /* @__PURE__ */ jsxs("div", { style: card, children: [
    /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }, children: l }),
    /* @__PURE__ */ jsx("div", { style: { fontSize: 26, fontWeight: 700, marginTop: 4 }, children: value }),
    hint && /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: C.muted }, children: hint })
  ] });
}
function AnalyticsPanel({ call, isAll, tenants, apiBase, getAccessToken }) {
  const [overview, setOverview] = useState(null);
  const [perTenant, setPerTenant] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  useEffect(() => {
    call("/overview").then((r) => setOverview(r.overview)).catch(() => setOverview(null));
    if (!isAll) {
      call("/email/campaigns").then((r) => setCampaigns(r.campaigns.filter((c) => c.status === "sent"))).catch(() => setCampaigns([]));
    }
  }, [call, isAll]);
  useEffect(() => {
    if (!isAll || !tenants) return;
    const root = apiBase.replace(/\/$/, "");
    const token = getAccessToken?.()?.trim();
    void Promise.all(
      tenants.filter((t) => t.id !== "all").map(async (t) => {
        try {
          const res = await fetch(`${root}/t/${t.id}/overview`, { credentials: "include", headers: { Accept: "application/json", ...token ? { Authorization: `Bearer ${token}` } : {} } });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
          return { tenant: t, overview: data.overview };
        } catch (err) {
          return { tenant: t, overview: null, error: err.message };
        }
      })
    ).then(setPerTenant);
  }, [isAll, tenants, apiBase, getAccessToken]);
  const rows = isAll ? perTenant.filter((r) => r.overview).map((r) => r.overview) : overview ? [overview] : [];
  const total = rows.reduce(
    (acc, o) => ({
      published: acc.published + o.publishedPosts,
      drafts: acc.drafts + (o.posts.draft || 0) + (o.posts.approved || 0),
      sent: acc.sent + o.emailsSent,
      delivered: acc.delivered + o.delivered,
      opened: acc.opened + o.opened,
      clicked: acc.clicked + o.clicked,
      subscribers: acc.subscribers + o.subscribers,
      unsub: acc.unsub + o.unsubscribed
    }),
    { published: 0, drafts: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, subscribers: 0, unsub: 0 }
  );
  const denom = total.delivered || total.sent;
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 12 }, "data-testid": "marketing-analytics", children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }, children: [
      /* @__PURE__ */ jsx(Stat, { label: "Published posts", value: total.published, hint: `${total.drafts} in review` }),
      /* @__PURE__ */ jsx(Stat, { label: "Emails sent", value: total.sent.toLocaleString(), hint: `${total.delivered.toLocaleString()} delivered` }),
      /* @__PURE__ */ jsx(Stat, { label: "Open rate", value: denom ? pct(total.opened / denom) : "\u2014", hint: `${total.opened} opens` }),
      /* @__PURE__ */ jsx(Stat, { label: "Click rate", value: denom ? pct(total.clicked / denom) : "\u2014", hint: `${total.clicked} clicks` }),
      /* @__PURE__ */ jsx(Stat, { label: "Subscribers", value: total.subscribers, hint: `${total.unsub} unsubscribed` })
    ] }),
    isAll && /* @__PURE__ */ jsxs("div", { style: card, children: [
      /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "By app" }),
      /* @__PURE__ */ jsxs("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 }, children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { style: { textAlign: "left", color: C.muted }, children: ["App", "Published", "In review", "Campaigns", "Sent", "Open rate", "Click rate", "Last campaign"].map((h) => /* @__PURE__ */ jsx("th", { style: { padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }, children: h }, h)) }) }),
        /* @__PURE__ */ jsx("tbody", { children: perTenant.map(({ tenant, overview: o, error }) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { style: { padding: "8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }, children: tenant.label }),
          o ? /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: o.publishedPosts }),
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: (o.posts.draft || 0) + (o.posts.approved || 0) }),
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: o.campaigns }),
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: o.emailsSent }),
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: o.emailsSent ? pct(o.openRate) : "\u2014" }),
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: o.emailsSent ? pct(o.clickRate) : "\u2014" }),
            /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: fmtDate(o.lastCampaignAt) })
          ] }) : /* @__PURE__ */ jsx("td", { colSpan: 7, style: { padding: 8, borderBottom: `1px solid ${C.line}`, color: C.bad }, children: error || "Loading\u2026" })
        ] }, tenant.id)) })
      ] })
    ] }),
    !isAll && /* @__PURE__ */ jsxs("div", { style: card, children: [
      /* @__PURE__ */ jsx("h4", { style: sectionTitle, children: "Campaign performance" }),
      campaigns.length === 0 && /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: C.muted }, children: "No sent campaigns yet." }),
      campaigns.length > 0 && /* @__PURE__ */ jsxs("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 }, children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { style: { textAlign: "left", color: C.muted }, children: ["Campaign", "Audience", "Sent", "Delivered", "Opens", "Clicks", "Bounces", "Unsubs", "Sent at"].map((h) => /* @__PURE__ */ jsx("th", { style: { padding: "6px 8px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }, children: h }, h)) }) }),
        /* @__PURE__ */ jsx("tbody", { children: campaigns.map((c) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}`, fontWeight: 600 }, children: c.name }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.segmentId }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.sentCount }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.deliveredCount }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.openedCount }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.clickedCount }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.bouncedCount }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: c.unsubscribedCount }),
          /* @__PURE__ */ jsx("td", { style: { padding: 8, borderBottom: `1px solid ${C.line}` }, children: fmtDate(c.sentAt) })
        ] }, c.id)) })
      ] })
    ] })
  ] });
}
export {
  MarketingOpsConsole
};
