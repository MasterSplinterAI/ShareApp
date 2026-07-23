"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.tsx
var index_exports = {};
__export(index_exports, {
  SupportLauncher: () => SupportLauncher,
  SupportOpsConsole: () => SupportOpsConsole
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// src/markdown.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function normalizeSupportMarkdown(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/^[ \t]*\.\s+(?=\*\*|[_`]|[A-Za-z0-9])/gm, "- ").replace(/\n{3,}/g, "\n\n").trim();
}
function renderInline(text, keyPrefix) {
  const nodes = [];
  const re = /(`[^`]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const raw = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (raw.startsWith("`")) {
      nodes.push(
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "code",
          {
            style: {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.9em",
              background: "rgba(15, 23, 42, 0.06)",
              padding: "1px 4px",
              borderRadius: 4
            },
            children: raw.slice(1, -1)
          },
          k
        )
      );
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      nodes.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: raw.slice(2, -2) }, k));
    } else if (raw.startsWith("*") && raw.endsWith("*") || raw.startsWith("_") && raw.endsWith("_")) {
      nodes.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: raw.slice(1, -1) }, k));
    } else if (raw.startsWith("[")) {
      const link = raw.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        nodes.push(
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "a",
            {
              href: link[2],
              target: "_blank",
              rel: "noreferrer noopener",
              style: { color: "#2563eb", textDecoration: "underline" },
              children: link[1]
            },
            k
          )
        );
      } else {
        nodes.push(raw);
      }
    } else {
      nodes.push(raw);
    }
    last = m.index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
function parseBlocks(src) {
  const lines = src.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const ulMatch = line.match(/^[ \t]*[-*]\s+(.*)$/);
    if (ulMatch) {
      const items = [ulMatch[1]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].match(/^[ \t]*[-*]\s+(.*)$/);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const olMatch = line.match(/^[ \t]*(\d+)\.\s+(.*)$/);
    if (olMatch) {
      const items = [olMatch[2]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].match(/^[ \t]*\d+\.\s+(.*)$/);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const parts = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (/^[ \t]*[-*]\s+/.test(next) || /^[ \t]*\d+\.\s+/.test(next)) break;
      parts.push(next);
      i += 1;
    }
    blocks.push({ type: "p", text: parts.join(" ") });
  }
  return blocks;
}
function SupportMarkdown({ text }) {
  const normalized = normalizeSupportMarkdown(text);
  if (!normalized) return null;
  const blocks = parseBlocks(normalized);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      style: {
        fontSize: 14,
        lineHeight: 1.45,
        wordBreak: "break-word"
      },
      children: blocks.map((block, bi) => {
        if (block.type === "p") {
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: bi === 0 ? "0 0 0.55em" : "0.55em 0" }, children: renderInline(block.text, `p${bi}`) }, `p-${bi}`);
        }
        if (block.type === "ul") {
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "ul",
            {
              style: { margin: "0.4em 0", paddingLeft: "1.25em" },
              children: block.items.map((item, ii) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { style: { margin: "0.2em 0" }, children: renderInline(item, `ul${bi}-${ii}`) }, `uli-${bi}-${ii}`))
            },
            `ul-${bi}`
          );
        }
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "ol",
          {
            style: { margin: "0.4em 0", paddingLeft: "1.25em" },
            children: block.items.map((item, ii) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { style: { margin: "0.2em 0" }, children: renderInline(item, `ol${bi}-${ii}`) }, `oli-${bi}-${ii}`))
          },
          `ol-${bi}`
        );
      })
    }
  );
}
function PlainMultiline({ text }) {
  const parts = String(text ?? "").split("\n");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: parts.map((line, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [
    i > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}) : null,
    line
  ] }, i)) });
}

// src/SupportOpsConsole.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var ACCENT = "#2563eb";
function normalizeApiBase(apiBase) {
  return apiBase.replace(/\/$/, "");
}
async function opsFetch(apiBase, path, init, getAccessToken) {
  const url = `${normalizeApiBase(apiBase)}${path.startsWith("/") ? path : `/${path}`}`;
  const token = getAccessToken?.()?.trim() || null;
  const { headers: initHeaders, ...rest } = init ?? {};
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...rest.body ? { "Content-Type": "application/json" } : {},
      ...token ? { Authorization: `Bearer ${token}` } : {},
      ...initHeaders
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data && data.error ? String(data.error) : `Request failed (${res.status})`
    );
  }
  return data;
}
function parseContextSummary(contextJson) {
  if (!contextJson) return null;
  try {
    const parsed = JSON.parse(contextJson);
    return parsed.contextSummary?.trim() || null;
  } catch {
    return null;
  }
}
function parseDraftReply(bodyJson) {
  try {
    const parsed = JSON.parse(bodyJson);
    return parsed.draft_reply?.trim() || null;
  } catch {
    return null;
  }
}
function pendingProposal(proposals) {
  return proposals.find((p) => p.status === "pending_review" || p.status === "needs_info");
}
function actionGuide(p, kind) {
  if (!p) return "Reply to the customer or update status.";
  if (p.proposalType === "bug_fix" || kind === "bug") {
    return "Verify root cause, then Approve to create a GitHub issue \u2014 or Need info / Reject.";
  }
  if (p.proposalType === "feature" || kind === "feature") {
    return "Confirm MVP scope, then Approve to backlog \u2014 or Need info / Reject.";
  }
  if (p.proposalType === "escalate") {
    return "Take over or send an edited reply. Escalations stay human-owned.";
  }
  return "Review the AI draft: Send, Edit & send, Take over, or Need info.";
}
function SupportOpsConsole(props) {
  const { apiBase, className, pollMs = 8e3, getAccessToken } = props;
  const fetchApi = (0, import_react2.useCallback)(
    (path, init) => opsFetch(apiBase, path, init, getAccessToken),
    [apiBase, getAccessToken]
  );
  const [tab, setTab] = (0, import_react2.useState)("inbox");
  const [kindFilter, setKindFilter] = (0, import_react2.useState)("attention");
  const [tickets, setTickets] = (0, import_react2.useState)([]);
  const [counts, setCounts] = (0, import_react2.useState)({});
  const [selectedId, setSelectedId] = (0, import_react2.useState)(null);
  const [detail, setDetail] = (0, import_react2.useState)(null);
  const [draft, setDraft] = (0, import_react2.useState)("");
  const [editDraft, setEditDraft] = (0, import_react2.useState)("");
  const [error, setError] = (0, import_react2.useState)(null);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [kbFilter, setKbFilter] = (0, import_react2.useState)("draft");
  const [articles, setArticles] = (0, import_react2.useState)([]);
  const [gaps, setGaps] = (0, import_react2.useState)([]);
  const [selectedArticle, setSelectedArticle] = (0, import_react2.useState)(null);
  const [leads, setLeads] = (0, import_react2.useState)([]);
  const [leadsMarketingOnly, setLeadsMarketingOnly] = (0, import_react2.useState)(false);
  const [selectedLead, setSelectedLead] = (0, import_react2.useState)(null);
  const loadInbox = (0, import_react2.useCallback)(async () => {
    const q = kindFilter === "attention" ? "status=attention" : kindFilter === "all" ? "" : `kind=${encodeURIComponent(kindFilter)}`;
    const data = await fetchApi(`/admin/tickets${q ? `?${q}` : ""}`);
    setTickets(data.tickets ?? []);
    setCounts(data.counts ?? {});
  }, [fetchApi, kindFilter]);
  const loadDetail = (0, import_react2.useCallback)(
    async (id) => {
      const data = await fetchApi(`/admin/tickets/${id}`);
      setDetail({
        ticket: data.ticket,
        messages: data.messages ?? [],
        proposals: data.proposals ?? []
      });
      const pending2 = pendingProposal(data.proposals ?? []);
      setEditDraft(pending2 ? parseDraftReply(pending2.bodyJson) || "" : "");
      setSelectedId(id);
    },
    [fetchApi]
  );
  const loadKb = (0, import_react2.useCallback)(async () => {
    if (kbFilter === "gaps") {
      const data2 = await fetchApi("/admin/gaps");
      setGaps(data2.gaps ?? []);
      setArticles([]);
      return;
    }
    const data = await fetchApi(
      `/admin/kb?status=${encodeURIComponent(kbFilter)}`
    );
    setArticles(data.articles ?? []);
  }, [fetchApi, kbFilter]);
  const loadLeads = (0, import_react2.useCallback)(async () => {
    const q = leadsMarketingOnly ? "?marketing=1" : "";
    const data = await fetchApi(
      `/admin/leads${q}`
    );
    setLeads(data.leads ?? []);
  }, [apiBase, leadsMarketingOnly]);
  (0, import_react2.useEffect)(() => {
    if (tab === "inbox") {
      void loadInbox().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    } else if (tab === "kb") {
      void loadKb().catch((e) => setError(e instanceof Error ? e.message : "KB load failed"));
    } else if (tab === "leads") {
      void loadLeads().catch((e) => setError(e instanceof Error ? e.message : "Leads load failed"));
    }
  }, [tab, loadInbox, loadKb, loadLeads]);
  (0, import_react2.useEffect)(() => {
    if (tab === "leads") void loadLeads().catch(() => {
    });
  }, [leadsMarketingOnly, tab, loadLeads]);
  (0, import_react2.useEffect)(() => {
    const t = setInterval(() => {
      if (tab === "inbox") void loadInbox().catch(() => {
      });
      if (selectedId) void loadDetail(selectedId).catch(() => {
      });
    }, pollMs);
    return () => clearInterval(t);
  }, [tab, pollMs, loadInbox, loadDetail, selectedId]);
  const runProposal = async (action, message) => {
    if (!detail) return;
    const pending2 = pendingProposal(detail.proposals);
    if (!pending2 && action !== "reply") return;
    setBusy(true);
    setError(null);
    try {
      if (action === "reply") {
        await fetchApi(`/admin/tickets/${detail.ticket.id}/reply`, {
          method: "POST",
          body: JSON.stringify({ body: draft })
        });
        setDraft("");
      } else if (pending2) {
        await fetchApi(`/admin/proposals/${pending2.id}/action`, {
          method: "POST",
          body: JSON.stringify({
            action,
            draft_reply: editDraft || void 0,
            message
          })
        });
      }
      await loadDetail(detail.ticket.id);
      await loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (status) => {
    if (!detail) return;
    setBusy(true);
    try {
      await fetchApi(`/admin/tickets/${detail.ticket.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await loadDetail(detail.ticket.id);
      await loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setBusy(false);
    }
  };
  const promoteFromTicket = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await fetchApi(`/admin/tickets/${detail.ticket.id}/promote-kb`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setTab("kb");
      setKbFilter("draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promote failed");
    } finally {
      setBusy(false);
    }
  };
  const shell2 = {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 14,
    color: "#0f172a",
    display: "grid",
    gridTemplateColumns: "280px 1fr",
    gap: 12,
    minHeight: 520
  };
  const pending = detail ? pendingProposal(detail.proposals) : void 0;
  const ctx = detail ? parseContextSummary(detail.ticket.contextJson) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className, "data-support-kit": "ops-console", style: { ...shell2 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "aside",
      {
        style: {
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          background: "#fff",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "flex", borderBottom: "1px solid #e2e8f0" }, children: ["inbox", "kb", "leads"].map((t) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "button",
            {
              type: "button",
              onClick: () => setTab(t),
              style: {
                flex: 1,
                padding: 10,
                border: "none",
                background: tab === t ? "#eff6ff" : "#fff",
                color: tab === t ? ACCENT : "#475569",
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "uppercase",
                fontSize: 12
              },
              children: t
            },
            t
          )) }),
          tab === "inbox" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { padding: 8, display: "flex", flexWrap: "wrap", gap: 4 }, children: [
              ["attention", "Needs attention"],
              ["support", "Support"],
              ["bug", "Bugs"],
              ["feature", "Features"],
              ["all", "All"]
            ].map(([id, label]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "button",
              {
                type: "button",
                onClick: () => setKindFilter(id),
                style: {
                  border: `1px solid ${kindFilter === id ? ACCENT : "#e2e8f0"}`,
                  background: kindFilter === id ? "#eff6ff" : "#fff",
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 11,
                  cursor: "pointer"
                },
                children: [
                  label,
                  id === "attention" && counts.pending_review_proposals ? ` (${counts.pending_review_proposals})` : ""
                ]
              },
              id
            )) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { flex: 1, overflow: "auto" }, children: tickets.map((t) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "button",
              {
                type: "button",
                onClick: () => void loadDetail(t.id),
                style: {
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  background: selectedId === t.id ? "#f8fafc" : "#fff",
                  cursor: "pointer"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontWeight: 700 }, children: [
                    "#",
                    t.publicNumber,
                    " \xB7 ",
                    t.kind ?? "?",
                    t.hasPendingProposal ? " \xB7 AI" : ""
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, color: "#64748b" }, children: [
                    t.status,
                    t.topic ? ` \xB7 ${t.topic}` : "",
                    t.severity ? ` \xB7 ${t.severity}` : ""
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, marginTop: 2 }, children: (t.subject || "").slice(0, 80) })
                ]
              },
              t.id
            )) })
          ] }) : tab === "kb" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { padding: 8, display: "flex", flexWrap: "wrap", gap: 4 }, children: ["draft", "active", "deprecated", "gaps"].map((id) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "button",
              {
                type: "button",
                onClick: () => {
                  setKbFilter(id);
                  setSelectedArticle(null);
                },
                style: {
                  border: `1px solid ${kbFilter === id ? ACCENT : "#e2e8f0"}`,
                  background: kbFilter === id ? "#eff6ff" : "#fff",
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 11,
                  cursor: "pointer"
                },
                children: id
              },
              id
            )) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { flex: 1, overflow: "auto" }, children: kbFilter === "gaps" ? gaps.map((g) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "div",
              {
                style: {
                  padding: 10,
                  borderBottom: "1px solid #f1f5f9",
                  fontSize: 13
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontWeight: 600 }, children: g.userQuestion.slice(0, 120) }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { color: "#64748b", fontSize: 12 }, children: g.summary }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "button",
                      {
                        type: "button",
                        disabled: busy,
                        style: { fontSize: 12, cursor: "pointer" },
                        onClick: () => {
                          setBusy(true);
                          setError(null);
                          void fetchApi(`/admin/gaps/${g.id}/research`, {
                            method: "POST",
                            body: JSON.stringify({})
                          }).then((res) => {
                            if (res.article) {
                              setKbFilter("draft");
                              setSelectedArticle(res.article);
                              return loadKb();
                            }
                            throw new Error(res.error || "Research failed");
                          }).catch(
                            (e) => setError(
                              e instanceof Error ? e.message : "Codebase research failed"
                            )
                          ).finally(() => setBusy(false));
                        },
                        children: "Research codebase"
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "button",
                      {
                        type: "button",
                        style: { fontSize: 12, cursor: "pointer" },
                        onClick: () => void fetchApi(`/admin/gaps/${g.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ status: "dismissed" })
                        }).then(() => loadKb()),
                        children: "Dismiss"
                      }
                    )
                  ] })
                ]
              },
              g.id
            )) : articles.map((a) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
              "button",
              {
                type: "button",
                onClick: () => setSelectedArticle(a),
                style: {
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: 10,
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  background: selectedArticle?.id === a.id ? "#f8fafc" : "#fff",
                  cursor: "pointer"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontWeight: 700 }, children: a.title }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, color: "#64748b" }, children: [
                    a.sourceKind,
                    " \xB7 ",
                    a.visibility ?? "agent",
                    " \xB7 ",
                    a.status
                  ] })
                ]
              },
              a.id
            )) })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { padding: 8, display: "flex", flexWrap: "wrap", gap: 4 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  onClick: () => {
                    setLeadsMarketingOnly(false);
                    void loadLeads();
                  },
                  style: {
                    border: `1px solid ${!leadsMarketingOnly ? ACCENT : "#e2e8f0"}`,
                    background: !leadsMarketingOnly ? "#eff6ff" : "#fff",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    cursor: "pointer"
                  },
                  children: "All"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  onClick: () => {
                    setLeadsMarketingOnly(true);
                  },
                  style: {
                    border: `1px solid ${leadsMarketingOnly ? ACCENT : "#e2e8f0"}`,
                    background: leadsMarketingOnly ? "#eff6ff" : "#fff",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    cursor: "pointer"
                  },
                  children: "Marketing opt-in"
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { flex: 1, overflow: "auto" }, children: [
              leads.map((l) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "button",
                {
                  type: "button",
                  onClick: () => setSelectedLead(l),
                  style: {
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderBottom: "1px solid #f1f5f9",
                    background: selectedLead?.id === l.id ? "#f8fafc" : "#fff",
                    cursor: "pointer"
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontWeight: 700 }, children: l.name }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "#64748b" }, children: l.email }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 11, color: "#64748b", marginTop: 2 }, children: [
                      l.marketingEmailOptIn ? "Email opt-in" : "No email marketing",
                      l.marketingSmsOptIn ? " \xB7 SMS opt-in" : "",
                      l.phone ? ` \xB7 ${l.phone}` : ""
                    ] })
                  ]
                },
                l.id
              )),
              leads.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { padding: 12, color: "#64748b", fontSize: 13 }, children: "No leads yet." }) : null
            ] })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "section",
      {
        style: {
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          background: "#fff",
          padding: 16,
          overflow: "auto"
        },
        children: [
          error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { color: "#b91c1c", marginTop: 0 }, children: error }) : null,
          tab === "leads" && !selectedLead ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { color: "#64748b" }, children: "Select a lead to review consent details." }) : null,
          tab === "leads" && selectedLead ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: { marginTop: 0 }, children: selectedLead.name }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { margin: "4px 0" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Email:" }),
              " ",
              selectedLead.email
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { margin: "4px 0" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Phone:" }),
              " ",
              selectedLead.phone || "\u2014"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { margin: "4px 0" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Marketing email:" }),
              " ",
              selectedLead.marketingEmailOptIn ? "Opted in" : "Not opted in"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { margin: "4px 0" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "Marketing SMS:" }),
              " ",
              selectedLead.marketingSmsOptIn ? "Opted in" : "Not opted in"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { margin: "4px 0", fontSize: 13, color: "#64748b" }, children: [
              "Source: ",
              selectedLead.source,
              " \xB7 Consent at:",
              " ",
              selectedLead.consentAt || selectedLead.updatedAt
            ] }),
            selectedLead.consentText ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "blockquote",
              {
                style: {
                  margin: "12px 0",
                  padding: 12,
                  background: "#f8fafc",
                  borderLeft: `3px solid ${ACCENT}`,
                  fontSize: 13
                },
                children: selectedLead.consentText
              }
            ) : null
          ] }) : null,
          tab === "kb" && selectedArticle ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: { marginTop: 0 }, children: selectedArticle.title }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: { fontSize: 12, color: "#64748b" }, children: [
              selectedArticle.sourceKind,
              " \xB7 visibility=",
              selectedArticle.visibility,
              " \xB7",
              " ",
              selectedArticle.status
            ] }),
            selectedArticle.provenanceJson ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("pre", { style: { fontSize: 11, background: "#f8fafc", padding: 8 }, children: selectedArticle.provenanceJson }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "pre",
              {
                style: {
                  whiteSpace: "pre-wrap",
                  background: "#f8fafc",
                  padding: 12,
                  borderRadius: 8
                },
                children: selectedArticle.body
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 8, marginTop: 12 }, children: [
              selectedArticle.status === "draft" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  disabled: busy,
                  onClick: () => void fetchApi(`/admin/kb/${selectedArticle.id}/promote`, {
                    method: "POST",
                    body: JSON.stringify({ visibility: "agent" })
                  }).then(async () => {
                    await loadKb();
                    setSelectedArticle(null);
                  }),
                  style: {
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: 8,
                    background: ACCENT,
                    color: "#fff",
                    fontWeight: 600
                  },
                  children: "Promote"
                }
              ) : null,
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "button",
                {
                  type: "button",
                  disabled: busy,
                  onClick: () => void fetchApi(`/admin/kb/${selectedArticle.id}/deprecate`, {
                    method: "POST",
                    body: "{}"
                  }).then(async () => {
                    await loadKb();
                    setSelectedArticle(null);
                  }),
                  style: {
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: "#fff"
                  },
                  children: "Deprecate"
                }
              )
            ] })
          ] }) : null,
          tab === "inbox" && !detail ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { color: "#64748b" }, children: "Select a ticket to review the thread and proposals." }) : null,
          tab === "inbox" && detail ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h3", { style: { marginTop: 0 }, children: [
                "#",
                detail.ticket.publicNumber,
                " \xB7 ",
                detail.ticket.kind,
                " \xB7 ",
                detail.ticket.status
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                "div",
                {
                  style: {
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 12,
                    fontSize: 13
                  },
                  children: actionGuide(pending, detail.ticket.kind)
                }
              ),
              detail.messages.map((m) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "div",
                {
                  style: {
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 11, color: "#94a3b8", marginBottom: 4 }, children: [
                      m.authorType,
                      " \xB7 ",
                      new Date(m.createdAt).toLocaleString()
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { whiteSpace: "pre-wrap" }, children: m.body }),
                    m.citationJson ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 11, color: "#047857", marginTop: 6 }, children: [
                      "Sources: ",
                      m.citationJson
                    ] }) : null
                  ]
                },
                m.id
              )),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "form",
                {
                  onSubmit: (e) => {
                    e.preventDefault();
                    void runProposal("reply");
                  },
                  style: { display: "flex", gap: 8, marginTop: 8 },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "input",
                      {
                        value: draft,
                        onChange: (e) => setDraft(e.target.value),
                        placeholder: "Staff reply\u2026",
                        style: {
                          flex: 1,
                          padding: 8,
                          borderRadius: 8,
                          border: "1px solid #cbd5e1"
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "button",
                      {
                        type: "submit",
                        disabled: busy || !draft.trim(),
                        style: {
                          padding: "8px 12px",
                          border: "none",
                          borderRadius: 8,
                          background: ACCENT,
                          color: "#fff",
                          fontWeight: 600
                        },
                        children: "Send"
                      }
                    )
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
              ctx ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "div",
                {
                  style: {
                    background: "#f8fafc",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 12,
                    fontSize: 12,
                    whiteSpace: "pre-wrap"
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "User context" }),
                    "\n",
                    ctx
                  ]
                }
              ) : null,
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 13, marginBottom: 8 }, children: [
                "Topic: ",
                detail.ticket.topic ?? "\u2014",
                detail.ticket.severity ? ` \xB7 Severity: ${detail.ticket.severity}` : "",
                detail.ticket.githubIssueUrl ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                  " \xB7 ",
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: detail.ticket.githubIssueUrl, target: "_blank", rel: "noreferrer", children: "GitHub" })
                ] }) : null
              ] }),
              pending ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
                "div",
                {
                  style: {
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 12
                  },
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontWeight: 700 }, children: [
                      "Proposal \xB7 ",
                      pending.proposalType,
                      " \xB7 ",
                      pending.status
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 13, margin: "6px 0" }, children: pending.summary }),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                      "textarea",
                      {
                        value: editDraft,
                        onChange: (e) => setEditDraft(e.target.value),
                        rows: 6,
                        style: {
                          width: "100%",
                          boxSizing: "border-box",
                          padding: 8,
                          borderRadius: 8,
                          border: "1px solid #e2e8f0"
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }, children: [
                      pending.proposalType === "bug_fix" || pending.proposalType === "feature" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => void runProposal("approve"),
                          children: "Approve \u2192 GitHub"
                        }
                      ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => void runProposal("send_reply"),
                            children: "Send draft"
                          }
                        ),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => void runProposal("edit_send"),
                            children: "Edit & send"
                          }
                        ),
                        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                          "button",
                          {
                            type: "button",
                            disabled: busy,
                            onClick: () => void runProposal("take_over"),
                            children: "Take over"
                          }
                        )
                      ] }),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => void runProposal("need_info"),
                          children: "Need info"
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                        "button",
                        {
                          type: "button",
                          disabled: busy,
                          onClick: () => void runProposal("reject"),
                          children: "Reject"
                        }
                      )
                    ] })
                  ]
                }
              ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { color: "#64748b", fontSize: 13 }, children: "No pending proposal." }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => void setStatus("resolved"), children: "Resolve" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => void setStatus("closed"), children: "Close" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => void setStatus("pending_ops"), children: "Reopen ops" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: busy, onClick: () => void promoteFromTicket(), children: "Promote answer to KB" })
              ] })
            ] })
          ] }) : null,
          tab === "kb" && !selectedArticle && kbFilter !== "gaps" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { color: "#64748b" }, children: "Select a KB article to review and promote." }) : null
        ]
      }
    )
  ] });
}

// src/index.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var DEFAULT_ACCENT = "#2563eb";
var DEFAULT_MARKETING_LABEL = "I agree to receive product updates and marketing messages by email (and by SMS if I provided a phone number). I can unsubscribe anytime.";
function leadStorageKey(apiBase) {
  return `support-kit:leadId:${normalizeApiBase2(apiBase)}`;
}
function normalizeApiBase2(apiBase) {
  return apiBase.replace(/\/$/, "");
}
async function supportFetch(apiBase, path, init, getAccessToken) {
  const url = `${normalizeApiBase2(apiBase)}${path.startsWith("/") ? path : `/${path}`}`;
  const token = getAccessToken?.()?.trim() || null;
  const { headers: initHeaders, ...rest } = init ?? {};
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...rest.body ? { "Content-Type": "application/json" } : {},
      ...token ? { Authorization: `Bearer ${token}` } : {},
      ...initHeaders
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === "object" && data && "error" in data && data.error ? String(data.error) : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}
function statusLabel(status) {
  switch (status) {
    case "ai_working":
      return "AI answering";
    case "pending_ops":
      return "Waiting for our team";
    case "waiting_user":
    case "pending_user":
      return "We need more info / waiting on you";
    case "escalated":
      return "Escalated to our team";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}
var shell = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 14,
  lineHeight: 1.45,
  color: "#0f172a"
};
function SupportLauncher(props) {
  const {
    apiBase,
    user,
    brand,
    position = "bottom-right",
    offset,
    mode = "bubble",
    audience = "app",
    renderTrigger,
    className,
    getAccessToken
  } = props;
  const fetchApi = (0, import_react3.useCallback)(
    (path, init) => supportFetch(apiBase, path, init, getAccessToken),
    [apiBase, getAccessToken]
  );
  const accent = brand?.accent ?? DEFAULT_ACCENT;
  const label = brand?.name ?? "Support";
  const agentName = brand?.supportAgentName ?? `${label} Support`;
  const marketingLabel = brand?.marketingConsentLabel?.trim() || DEFAULT_MARKETING_LABEL;
  const isPublic = audience === "public" && !user?.id;
  const panelId = (0, import_react3.useId)();
  const listRef = (0, import_react3.useRef)(null);
  const [open, setOpen] = (0, import_react3.useState)(mode === "page");
  const [view, setView] = (0, import_react3.useState)(isPublic ? { name: "gate" } : { name: "home" });
  const [draft, setDraft] = (0, import_react3.useState)("");
  const [supportMessages, setSupportMessages] = (0, import_react3.useState)([]);
  const [supportTicketId, setSupportTicketId] = (0, import_react3.useState)(null);
  const [bugTitle, setBugTitle] = (0, import_react3.useState)("");
  const [bugSeverity, setBugSeverity] = (0, import_react3.useState)("medium");
  const [bugSteps, setBugSteps] = (0, import_react3.useState)("");
  const [bugExpected, setBugExpected] = (0, import_react3.useState)("");
  const [bugActual, setBugActual] = (0, import_react3.useState)("");
  const [featurePriority, setFeaturePriority] = (0, import_react3.useState)("important");
  const [coachTurn, setCoachTurn] = (0, import_react3.useState)(0);
  const [coachProblem, setCoachProblem] = (0, import_react3.useState)("");
  const [coachOutcome, setCoachOutcome] = (0, import_react3.useState)("");
  const [coachEnabled, setCoachEnabled] = (0, import_react3.useState)(null);
  const [coachMessages, setCoachMessages] = (0, import_react3.useState)([]);
  const [coachDraft, setCoachDraft] = (0, import_react3.useState)(null);
  const [coachReady, setCoachReady] = (0, import_react3.useState)(false);
  const [coachInput, setCoachInput] = (0, import_react3.useState)("");
  const [guestEmail, setGuestEmail] = (0, import_react3.useState)(user?.email ?? "");
  const [submittedTicket, setSubmittedTicket] = (0, import_react3.useState)(null);
  const [leadId, setLeadId] = (0, import_react3.useState)(null);
  const [gateName, setGateName] = (0, import_react3.useState)("");
  const [gateEmail, setGateEmail] = (0, import_react3.useState)("");
  const [gatePhone, setGatePhone] = (0, import_react3.useState)("");
  const [gateMarketing, setGateMarketing] = (0, import_react3.useState)(false);
  const [sending, setSending] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [tickets, setTickets] = (0, import_react3.useState)([]);
  const [thread, setThread] = (0, import_react3.useState)(null);
  const [threadDraft, setThreadDraft] = (0, import_react3.useState)("");
  const isOpen = mode === "page" || open;
  (0, import_react3.useEffect)(() => {
    if (!isPublic || typeof sessionStorage === "undefined") return;
    try {
      const stored = sessionStorage.getItem(leadStorageKey(apiBase));
      if (stored) {
        setLeadId(stored);
        setView((v) => v.name === "gate" ? { name: "home" } : v);
      }
    } catch {
    }
  }, [apiBase, isPublic]);
  const startSupportChat = (0, import_react3.useCallback)(() => {
    setSupportMessages([
      {
        id: "welcome",
        role: "assistant",
        text: isPublic ? `Hi \u2014 I'm ${agentName}. Ask about ${label}, pricing, or getting started. For account-specific help, please sign in.` : `Hi \u2014 I'm ${agentName}. Ask me anything about the product, your account, or billing. I'll figure out the details and help right here.`
      }
    ]);
    setSupportTicketId(null);
    setDraft("");
    setError(null);
    setView({ name: "supportChat" });
  }, [agentName, isPublic, label]);
  const submitGate = async (event) => {
    event?.preventDefault();
    if (sending) return;
    if (!gateName.trim() || !gateEmail.trim()) {
      setError("Name and email are required");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const data = await fetchApi("/leads", {
        method: "POST",
        body: JSON.stringify({
          name: gateName.trim(),
          email: gateEmail.trim(),
          ...gatePhone.trim() ? { phone: gatePhone.trim() } : {},
          marketingOptIn: gateMarketing,
          source: "public_launcher",
          consentText: marketingLabel
        })
      });
      setLeadId(data.leadId);
      setGuestEmail(gateEmail.trim());
      try {
        sessionStorage.setItem(leadStorageKey(apiBase), data.leadId);
      } catch {
      }
      setView({ name: "home" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact info");
    } finally {
      setSending(false);
    }
  };
  const resetFeatureCompose = (0, import_react3.useCallback)(() => {
    setCoachTurn(0);
    setCoachProblem("");
    setCoachOutcome("");
    setFeaturePriority("important");
    setCoachMessages([]);
    setCoachDraft(null);
    setCoachReady(false);
    setCoachInput("");
    setCoachEnabled(null);
    setError(null);
  }, []);
  (0, import_react3.useEffect)(() => {
    if (view.name !== "compose" || view.kind !== "feature") return;
    let cancelled = false;
    void fetchApi("/config").then((cfg) => {
      if (cancelled) return;
      const enabled = Boolean(cfg.coachEnabled);
      setCoachEnabled(enabled);
      if (enabled) {
        setCoachMessages(
          (prev) => prev.length === 0 ? [
            {
              id: "coach-welcome",
              role: "assistant",
              text: `Tell me what you'd like ${label} to do better \u2014 I'll help shape it into a clear feature request.`
            }
          ] : prev
        );
      }
    }).catch(() => {
      if (!cancelled) setCoachEnabled(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchApi, view.name, view.name === "compose" ? view.kind : null, label]);
  (0, import_react3.useEffect)(() => {
    if (view.name === "compose" && view.kind === "feature" && coachEnabled) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [view, coachMessages, coachEnabled, sending]);
  const sendCoachTurn = async (event) => {
    event?.preventDefault();
    const message = coachInput.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    const nextUser = {
      id: `u-${Date.now()}`,
      role: "user",
      text: message
    };
    const history = [...coachMessages, nextUser];
    setCoachMessages(history);
    setCoachInput("");
    try {
      const data = await fetchApi("/coach", {
        method: "POST",
        body: JSON.stringify({
          kind: "feature_request",
          messages: history.map((m) => ({
            role: m.role,
            body: m.text
          }))
        })
      });
      setCoachMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.reply
        }
      ]);
      setCoachDraft(data.draft);
      setCoachReady(Boolean(data.readyToSubmit));
      if (data.draft?.priority) setFeaturePriority(data.draft.priority);
      if (data.draft?.problem) setCoachProblem(data.draft.problem);
      if (data.draft?.solution) setCoachOutcome(data.draft.solution);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coach failed");
    } finally {
      setSending(false);
    }
  };
  const loadTickets = (0, import_react3.useCallback)(async () => {
    try {
      const data = await fetchApi(
        "/tickets"
      );
      setTickets(data.tickets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    }
  }, [fetchApi]);
  const openThread = (0, import_react3.useCallback)(
    async (id) => {
      setError(null);
      try {
        const data = await fetchApi(`/tickets/${id}`);
        setThread({ ticket: data.ticket, messages: data.messages ?? [] });
        setView({ name: "thread", ticketId: id });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load ticket");
      }
    },
    [fetchApi]
  );
  (0, import_react3.useEffect)(() => {
    if (isOpen && (view.name === "home" || view.name === "tickets") && !isPublic) {
      void loadTickets();
    }
  }, [isOpen, view.name, loadTickets, isPublic]);
  (0, import_react3.useEffect)(() => {
    if (view.name === "thread" && thread) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    if (view.name === "supportChat") {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [view, thread, supportMessages, sending]);
  (0, import_react3.useEffect)(() => {
    if (view.name !== "thread" || !thread) return;
    if (thread.ticket.status !== "ai_working") return;
    const t = setInterval(() => {
      void openThread(thread.ticket.id);
    }, 2500);
    return () => clearInterval(t);
  }, [view, thread, openThread]);
  const sendSupportChat = async (event) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    const userBubble = {
      id: `u-${Date.now()}`,
      role: "user",
      text: message
    };
    setSupportMessages((prev) => [...prev, userBubble]);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      if (supportTicketId && !isPublic) {
        await fetchApi(`/tickets/${supportTicketId}/messages`, {
          method: "POST",
          body: JSON.stringify({ body: message })
        });
        const data = await fetchApi(`/tickets/${supportTicketId}`);
        setSupportMessages(
          (data.messages ?? []).map((m) => ({
            id: m.id,
            role: m.authorType === "user" ? "user" : m.authorType === "system" ? "system" : "assistant",
            text: m.body
          }))
        );
      } else {
        if (isPublic && !leadId) {
          setError("Please complete the contact form first");
          setView({ name: "gate" });
          setSending(false);
          return;
        }
        const data = await fetchApi("/chat", {
          method: "POST",
          body: JSON.stringify({
            message,
            kind: "support",
            ...leadId ? { leadId } : {}
          })
        });
        if (data.ticket?.id && !isPublic) {
          setSupportTicketId(data.ticket.id);
        }
        const bot = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.reply ?? "Thanks \u2014 we're on it."
        };
        if (data.ticket?.publicNumber != null) {
          bot.ticketPublicNumber = data.ticket.publicNumber;
        }
        setSupportMessages((prev) => [...prev, bot]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setSending(false);
    }
  };
  const submitBug = async (event) => {
    event?.preventDefault();
    if (!bugTitle.trim() || sending) return;
    if (!user?.id && !guestEmail.trim()) {
      setError("Enter your email so we can follow up");
      return;
    }
    setSending(true);
    setError(null);
    const body = [
      `**Steps to reproduce**
${bugSteps || "(not provided)"}`,
      `**Expected**
${bugExpected || "(not provided)"}`,
      `**Actual**
${bugActual || "(not provided)"}`,
      `
URL: ${typeof window !== "undefined" ? window.location.href : ""}`,
      `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`
    ].join("\n\n");
    try {
      const data = await fetchApi("/tickets", {
        method: "POST",
        body: JSON.stringify({
          kind: "bug",
          topic: "other",
          subject: bugTitle.trim(),
          severity: bugSeverity,
          body,
          ...!user?.id ? { guestEmail: guestEmail.trim() } : {}
        })
      });
      if (!user?.id) {
        setSubmittedTicket(data.ticket);
        setView({ name: "home" });
      } else {
        await openThread(data.ticket.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit bug");
    } finally {
      setSending(false);
    }
  };
  const submitFeature = async () => {
    if (sending) return;
    const problem = (coachDraft?.problem || coachProblem).trim();
    const outcome = (coachDraft?.solution || coachOutcome).trim();
    if (!problem) {
      setError("Describe the problem before submitting");
      return;
    }
    if (!user?.id && !guestEmail.trim()) {
      setError("Enter your email so we can follow up");
      return;
    }
    setSending(true);
    setError(null);
    const priority = coachDraft?.priority || featurePriority;
    const body = [
      `**Problem**
${problem}`,
      `**Desired outcome**
${outcome || "(not provided)"}`,
      `**Priority**
${priority}`
    ].join("\n\n");
    try {
      const data = await fetchApi("/tickets", {
        method: "POST",
        body: JSON.stringify({
          kind: "feature",
          topic: "product",
          subject: (coachDraft?.subject || problem).slice(0, 120) || "Feature request",
          priority,
          body,
          ...!user?.id ? { guestEmail: guestEmail.trim() } : {}
        })
      });
      if (!user?.id) {
        setSubmittedTicket(data.ticket);
        resetFeatureCompose();
        setView({ name: "home" });
      } else {
        await openThread(data.ticket.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feature");
    } finally {
      setSending(false);
    }
  };
  const replyInThread = async (event) => {
    event?.preventDefault();
    if (!thread || !threadDraft.trim() || sending) return;
    if (thread.ticket.status === "closed") return;
    setSending(true);
    setError(null);
    try {
      await fetchApi(`/tickets/${thread.ticket.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: threadDraft.trim() })
      });
      setThreadDraft("");
      await openThread(thread.ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply failed");
    } finally {
      setSending(false);
    }
  };
  const panelStyle = mode === "page" ? {
    ...shell,
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minHeight: 520,
    borderRadius: 16,
    overflow: "hidden",
    background: "#fff",
    border: "1px solid #e2e8f0"
  } : {
    ...shell,
    display: "flex",
    flexDirection: "column",
    width: 380,
    maxWidth: "calc(100vw - 32px)",
    height: 560,
    maxHeight: "calc(100vh - 96px)",
    marginTop: 12,
    borderRadius: 16,
    overflow: "hidden",
    background: "#fff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 48px rgba(15, 23, 42, 0.18)"
  };
  const intentBtn = (active) => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    marginBottom: 10,
    borderRadius: 12,
    border: `1px solid ${active ? accent : "#e2e8f0"}`,
    background: active ? "#eff6ff" : "#fff",
    cursor: "pointer",
    fontWeight: 600
  });
  const panel = isOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { id: panelId, role: "dialog", "aria-label": `${label} support`, style: panelStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { style: { margin: 0, fontSize: 15, fontWeight: 700 }, children: label }),
            user?.planLabel || user?.email ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, opacity: 0.85, marginTop: 2 }, children: [user.planLabel, user.name || user.email].filter(Boolean).join(" \xB7 ") }) : null
          ] }),
          mode === "bubble" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              "aria-label": "Close",
              onClick: () => setOpen(false),
              style: {
                border: "none",
                background: "transparent",
                fontSize: 18,
                cursor: "pointer",
                color: "#64748b"
              },
              children: "\xD7"
            }
          ) : null
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: 1, overflow: "auto", padding: 12, background: "#f8fafc" }, children: [
      view.name === "gate" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { fontWeight: 600, marginTop: 0 }, children: "How can we reach you?" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { style: { color: "#64748b", fontSize: 13, marginTop: 0 }, children: [
          "Tell us a bit about yourself before chatting with ",
          label,
          "."
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { onSubmit: submitGate, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Name *" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              value: gateName,
              onChange: (e) => setGateName(e.target.value),
              required: true,
              autoComplete: "name",
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Email *" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              type: "email",
              value: gateEmail,
              onChange: (e) => setGateEmail(e.target.value),
              required: true,
              autoComplete: "email",
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: [
            "Phone ",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontWeight: 400, color: "#64748b" }, children: "(optional)" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              type: "tel",
              value: gatePhone,
              onChange: (e) => setGatePhone(e.target.value),
              autoComplete: "tel",
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "label",
            {
              style: {
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                fontSize: 12,
                color: "#334155",
                marginBottom: 12
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    checked: gateMarketing,
                    onChange: (e) => setGateMarketing(e.target.checked),
                    style: { marginTop: 2 }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: marketingLabel })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "submit",
              disabled: sending || !gateName.trim() || !gateEmail.trim(),
              style: {
                width: "100%",
                padding: 10,
                border: "none",
                borderRadius: 10,
                background: accent,
                color: "#fff",
                fontWeight: 600
              },
              children: sending ? "Saving\u2026" : "Continue"
            }
          )
        ] }),
        brand?.signupUrl ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { style: { fontSize: 12, color: "#64748b", marginTop: 12 }, children: [
          "Already have an account?",
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: brand.signupUrl, style: { color: accent, fontWeight: 600 }, children: "Sign up / sign in" })
        ] }) : null
      ] }) : null,
      view.name === "home" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        submittedTicket ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "p",
          {
            style: {
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13
            },
            children: [
              "Thanks \u2014 we logged ticket #",
              submittedTicket.publicNumber,
              ".",
              user?.id ? " You can open it under My tickets." : " We'll follow up by email.",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  onClick: () => setSubmittedTicket(null),
                  style: {
                    display: "block",
                    marginTop: 6,
                    border: "none",
                    background: "transparent",
                    color: "#047857",
                    cursor: "pointer",
                    padding: 0,
                    fontWeight: 600
                  },
                  children: "Dismiss"
                }
              )
            ]
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { color: "#64748b", fontSize: 13, marginTop: 0 }, children: "How can we help?" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", style: intentBtn(), onClick: () => startSupportChat(), children: [
          isPublic ? "Ask a question" : `Chat with ${agentName}`,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 400, fontSize: 12, color: "#64748b", marginTop: 4 }, children: isPublic ? `Questions about ${label}, pricing, or getting started \u2014 we'll escalate to the team when needed` : "Questions about the product, account, or billing \u2014 just ask" })
        ] }),
        isPublic ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              style: intentBtn(),
              onClick: () => setView({ name: "compose", kind: "bug" }),
              children: [
                "Report a bug",
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 400, fontSize: 12, color: "#64748b", marginTop: 4 }, children: "Something broken or unexpected" })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              style: intentBtn(),
              onClick: () => {
                resetFeatureCompose();
                setView({ name: "compose", kind: "feature" });
              },
              children: [
                "Request a feature",
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 400, fontSize: 12, color: "#64748b", marginTop: 4 }, children: "Suggest an improvement" })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              style: {
                ...intentBtn(),
                marginTop: 8,
                background: "#fff"
              },
              onClick: () => {
                setView({ name: "tickets" });
                void loadTickets();
              },
              children: [
                "My tickets (",
                tickets.filter((t) => t.status !== "closed").length,
                ")"
              ]
            }
          ),
          tickets.slice(0, 3).map((t) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              style: {
                ...intentBtn(),
                fontWeight: 500,
                fontSize: 13
              },
              onClick: () => void openThread(t.id),
              children: [
                "#",
                t.publicNumber,
                " \xB7 ",
                t.kind ?? "support",
                " \xB7 ",
                statusLabel(t.status)
              ]
            },
            t.id
          ))
        ] })
      ] }) : null,
      view.name === "supportChat" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 360 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            onClick: () => setView({ name: "home" }),
            style: {
              border: "none",
              background: "transparent",
              color: accent,
              fontWeight: 600,
              marginBottom: 8,
              cursor: "pointer",
              padding: 0,
              alignSelf: "flex-start"
            },
            children: "\u2190 Back"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            ref: listRef,
            style: {
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginBottom: 8
            },
            children: [
              supportMessages.map((msg) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
                "div",
                {
                  style: {
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    padding: "10px 12px",
                    borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user" ? accent : "#fff",
                    color: msg.role === "user" ? "#fff" : "#0f172a",
                    border: msg.role === "user" ? "none" : "1px solid #e2e8f0",
                    wordBreak: "break-word"
                  },
                  children: [
                    msg.role === "assistant" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                      "div",
                      {
                        style: {
                          fontSize: 11,
                          fontWeight: 600,
                          opacity: 0.7,
                          marginBottom: 4
                        },
                        children: agentName
                      }
                    ) : null,
                    msg.role === "assistant" || msg.role === "system" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SupportMarkdown, { text: msg.text }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PlainMultiline, { text: msg.text }),
                    msg.ticketPublicNumber != null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
                      "div",
                      {
                        style: {
                          marginTop: 8,
                          padding: "6px 8px",
                          borderRadius: 8,
                          background: "rgba(4, 120, 87, 0.12)",
                          color: msg.role === "user" ? "#ecfdf5" : "#047857",
                          fontSize: 12,
                          fontWeight: 600
                        },
                        children: [
                          "Ticket #",
                          msg.ticketPublicNumber
                        ]
                      }
                    ) : null
                  ]
                },
                msg.id
              )),
              sending ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
                "div",
                {
                  style: {
                    alignSelf: "flex-start",
                    padding: "10px 14px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    color: "#64748b",
                    fontSize: 13
                  },
                  children: [
                    agentName,
                    " is typing\u2026"
                  ]
                }
              ) : null
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { onSubmit: sendSupportChat, style: { display: "flex", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              value: draft,
              onChange: (e) => setDraft(e.target.value),
              placeholder: "Type your message\u2026",
              "aria-label": "Message",
              disabled: sending,
              style: {
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                fontSize: 14
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "submit",
              disabled: sending || !draft.trim(),
              style: {
                padding: "10px 14px",
                border: "none",
                borderRadius: 10,
                background: accent,
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer"
              },
              children: sending ? "\u2026" : "Send"
            }
          )
        ] })
      ] }) : null,
      view.name === "compose" && view.kind === "bug" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            onClick: () => setView({ name: "home" }),
            style: {
              border: "none",
              background: "transparent",
              color: accent,
              fontWeight: 600,
              marginBottom: 8,
              cursor: "pointer",
              padding: 0
            },
            children: "\u2190 Back"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { onSubmit: submitBug, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Title" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              value: bugTitle,
              onChange: (e) => setBugTitle(e.target.value),
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Severity" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "select",
            {
              value: bugSeverity,
              onChange: (e) => setBugSeverity(e.target.value),
              style: { width: "100%", padding: 8, marginBottom: 8, borderRadius: 8 },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "low", children: "Low" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "medium", children: "Medium" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "high", children: "High" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "critical", children: "Critical" })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Steps" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "textarea",
            {
              value: bugSteps,
              onChange: (e) => setBugSteps(e.target.value),
              rows: 3,
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Expected" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "textarea",
            {
              value: bugExpected,
              onChange: (e) => setBugExpected(e.target.value),
              rows: 2,
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Actual" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "textarea",
            {
              value: bugActual,
              onChange: (e) => setBugActual(e.target.value),
              rows: 2,
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          !user?.id ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { style: { display: "block", fontWeight: 600, marginBottom: 4 }, children: "Your email" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "input",
              {
                type: "email",
                value: guestEmail,
                onChange: (e) => setGuestEmail(e.target.value),
                required: true,
                placeholder: "you@example.com",
                style: {
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }
              }
            )
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "submit",
              disabled: sending || !bugTitle.trim(),
              style: {
                width: "100%",
                padding: 10,
                border: "none",
                borderRadius: 10,
                background: accent,
                color: "#fff",
                fontWeight: 600
              },
              children: sending ? "Submitting\u2026" : "Submit bug"
            }
          )
        ] })
      ] }) : null,
      view.name === "compose" && view.kind === "feature" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            onClick: () => {
              resetFeatureCompose();
              setView({ name: "home" });
            },
            style: {
              border: "none",
              background: "transparent",
              color: accent,
              fontWeight: 600,
              marginBottom: 8,
              cursor: "pointer",
              padding: 0
            },
            children: "\u2190 Back"
          }
        ),
        coachEnabled === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { color: "#64748b", fontSize: 13 }, children: "Loading\u2026" }) : coachEnabled ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, minHeight: 280 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "div",
            {
              ref: listRef,
              style: {
                flex: 1,
                overflow: "auto",
                maxHeight: 280,
                padding: 8,
                background: "#fff",
                borderRadius: 10,
                border: "1px solid #e2e8f0"
              },
              children: coachMessages.map((m) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "div",
                {
                  style: {
                    marginBottom: 10,
                    textAlign: m.role === "user" ? "right" : "left"
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "div",
                    {
                      style: {
                        display: "inline-block",
                        maxWidth: "92%",
                        padding: "8px 10px",
                        borderRadius: 10,
                        background: m.role === "user" ? accent : "#f1f5f9",
                        color: m.role === "user" ? "#fff" : "#0f172a",
                        fontSize: 13,
                        textAlign: "left"
                      },
                      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SupportMarkdown, { text: m.text })
                    }
                  )
                },
                m.id
              ))
            }
          ),
          coachDraft && (coachReady || coachDraft.problem) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "div",
            {
              style: {
                fontSize: 12,
                color: "#475569",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: 10
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 700, marginBottom: 4 }, children: "Draft" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Subject:" }),
                  " ",
                  coachDraft.subject || "\u2014"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Problem:" }),
                  " ",
                  coachDraft.problem || "\u2014"
                ] }),
                coachDraft.solution ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: 4 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "Solution:" }),
                  " ",
                  coachDraft.solution
                ] }) : null,
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
                  "select",
                  {
                    value: featurePriority,
                    onChange: (e) => {
                      setFeaturePriority(e.target.value);
                      setCoachDraft(
                        (d) => d ? { ...d, priority: e.target.value } : d
                      );
                    },
                    style: { width: "100%", padding: 6, marginTop: 8, borderRadius: 6 },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "nice_to_have", children: "Nice to have" }),
                      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "important", children: "Important" }),
                      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "critical", children: "Critical" })
                    ]
                  }
                )
              ]
            }
          ) : null,
          !user?.id ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              type: "email",
              value: guestEmail,
              onChange: (e) => setGuestEmail(e.target.value),
              placeholder: "Your email",
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }
            }
          ) : null,
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { onSubmit: sendCoachTurn, style: { display: "flex", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "input",
              {
                value: coachInput,
                onChange: (e) => setCoachInput(e.target.value),
                placeholder: "Describe the feature\u2026",
                disabled: sending,
                style: {
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  fontSize: 14
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "submit",
                disabled: sending || !coachInput.trim(),
                style: {
                  padding: "10px 14px",
                  border: "none",
                  borderRadius: 10,
                  background: accent,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer"
                },
                children: sending ? "\u2026" : "Send"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              disabled: sending || !coachDraft?.problem,
              onClick: () => void submitFeature(),
              style: {
                width: "100%",
                padding: 10,
                border: "none",
                borderRadius: 10,
                background: coachReady || coachDraft?.problem ? accent : "#94a3b8",
                color: "#fff",
                fontWeight: 600,
                cursor: coachDraft?.problem ? "pointer" : "default"
              },
              children: sending ? "Submitting\u2026" : coachReady ? "Submit feature request" : "Submit draft anyway"
            }
          )
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { fontWeight: 600 }, children: coachTurn === 0 ? "What problem are you trying to solve?" : coachTurn === 1 ? "What would a good solution look like?" : "How important is this?" }),
          coachTurn < 2 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "textarea",
              {
                value: coachTurn === 0 ? coachProblem : coachOutcome,
                onChange: (e) => coachTurn === 0 ? setCoachProblem(e.target.value) : setCoachOutcome(e.target.value),
                rows: 4,
                style: {
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                disabled: coachTurn === 0 ? !coachProblem.trim() : !coachOutcome.trim(),
                onClick: () => setCoachTurn((t) => t + 1),
                style: {
                  marginTop: 8,
                  width: "100%",
                  padding: 10,
                  border: "none",
                  borderRadius: 10,
                  background: accent,
                  color: "#fff",
                  fontWeight: 600
                },
                children: "Continue"
              }
            )
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            !user?.id ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "input",
              {
                type: "email",
                value: guestEmail,
                onChange: (e) => setGuestEmail(e.target.value),
                placeholder: "Your email",
                style: {
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }
              }
            ) : null,
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "select",
              {
                value: featurePriority,
                onChange: (e) => setFeaturePriority(e.target.value),
                style: { width: "100%", padding: 8, marginBottom: 8 },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "nice_to_have", children: "Nice to have" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "important", children: "Important" }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "critical", children: "Critical" })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                disabled: sending,
                onClick: () => void submitFeature(),
                style: {
                  width: "100%",
                  padding: 10,
                  border: "none",
                  borderRadius: 10,
                  background: accent,
                  color: "#fff",
                  fontWeight: 600
                },
                children: sending ? "Submitting\u2026" : "Submit request"
              }
            )
          ] })
        ] })
      ] }) : null,
      view.name === "tickets" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            onClick: () => setView({ name: "home" }),
            style: {
              border: "none",
              background: "transparent",
              color: accent,
              fontWeight: 600,
              marginBottom: 8,
              cursor: "pointer",
              padding: 0
            },
            children: "\u2190 Back"
          }
        ),
        tickets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { color: "#64748b", textAlign: "center" }, children: "No tickets yet." }) : tickets.map((t) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "button",
          {
            type: "button",
            style: intentBtn(),
            onClick: () => void openThread(t.id),
            children: [
              "#",
              t.publicNumber,
              " \xB7 ",
              t.kind ?? "support",
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 400, fontSize: 12, color: "#64748b" }, children: statusLabel(t.status) })
            ]
          },
          t.id
        ))
      ] }) : null,
      view.name === "thread" && thread ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            onClick: () => setView({ name: "home" }),
            style: {
              border: "none",
              background: "transparent",
              color: accent,
              fontWeight: 600,
              marginBottom: 8,
              cursor: "pointer",
              padding: 0
            },
            children: "\u2190 Home"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontWeight: 700, marginBottom: 4 }, children: [
          "Ticket #",
          thread.ticket.publicNumber,
          thread.ticket.kind ? ` \xB7 ${thread.ticket.kind}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 12 }, children: statusLabel(thread.ticket.status) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref: listRef, children: thread.messages.map((m) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            style: {
              padding: "10px 12px",
              marginBottom: 8,
              borderRadius: 10,
              background: "#fff",
              border: "1px solid #e2e8f0"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "div",
                {
                  style: {
                    fontSize: 11,
                    color: "#94a3b8",
                    marginBottom: 4,
                    textTransform: "capitalize"
                  },
                  children: m.authorType
                }
              ),
              m.authorType === "user" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PlainMultiline, { text: m.body }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SupportMarkdown, { text: m.body })
            ]
          },
          m.id
        )) }),
        thread.ticket.status !== "closed" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { onSubmit: replyInThread, style: { display: "flex", gap: 8, marginTop: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "input",
            {
              value: threadDraft,
              onChange: (e) => setThreadDraft(e.target.value),
              placeholder: "Reply\u2026",
              style: {
                flex: 1,
                padding: 10,
                borderRadius: 10,
                border: "1px solid #cbd5e1"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "submit",
              disabled: sending || !threadDraft.trim(),
              style: {
                padding: "10px 14px",
                border: "none",
                borderRadius: 10,
                background: accent,
                color: "#fff",
                fontWeight: 600
              },
              children: "Send"
            }
          )
        ] }) : null
      ] }) : null,
      error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { color: "#b91c1c", fontSize: 13, marginTop: 8 }, children: error }) : null
    ] })
  ] }) : null;
  const rootStyle = mode === "page" ? { ...shell, width: "100%", maxWidth: 720, margin: "0 auto" } : {
    ...shell,
    position: "fixed",
    bottom: offset?.bottom ?? 16,
    zIndex: 9999,
    ...position === "bottom-left" ? { left: offset?.left ?? 16 } : { right: offset?.right ?? 16 }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      "data-support-kit": "launcher",
      "data-api-base": apiBase,
      "data-mode": mode,
      className,
      style: rootStyle,
      children: [
        mode === "bubble" ? renderTrigger ? renderTrigger(() => setOpen(true)) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "button",
          {
            type: "button",
            "aria-label": `Open ${label} help`,
            "aria-expanded": open,
            "aria-controls": open ? panelId : void 0,
            onClick: () => setOpen(true),
            style: {
              display: "inline-flex",
              alignItems: "center",
              padding: "12px 18px",
              border: "none",
              borderRadius: 999,
              background: accent,
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(15, 23, 42, 0.18)"
            },
            children: [
              label,
              " Help"
            ]
          }
        ) : null,
        panel
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SupportLauncher,
  SupportOpsConsole
});
