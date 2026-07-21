import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

export interface SupportOpsConsoleProps {
  apiBase: string;
  className?: string;
  pollMs?: number;
  /** Bearer JWT for hosts without cookie sessions (e.g. ShareApp). */
  getAccessToken?: () => string | null | undefined;
}

type TicketSummary = {
  id: string;
  publicNumber: number;
  status: string;
  kind?: string;
  topic?: string;
  severity?: string | null;
  subject?: string | null;
  contextJson?: string | null;
  githubIssueUrl?: string | null;
  createdAt: string;
  hasPendingProposal?: boolean;
};

type TicketMessage = {
  id: string;
  authorType: string;
  body: string;
  citationJson?: string | null;
  createdAt: string;
};

type Proposal = {
  id: string;
  proposalType: string;
  status: string;
  summary: string;
  bodyJson: string;
  createdAt: string;
};

type KbArticle = {
  id: string;
  title: string;
  body: string;
  status: string;
  sourceKind: string;
  visibility?: string;
  provenanceJson?: string | null;
  updatedAt: string;
};

type Gap = {
  id: string;
  userQuestion: string;
  summary?: string | null;
  status: string;
  ticketId: string;
};

type TicketCounts = Record<string, number>;

const ACCENT = "#2563eb";

function normalizeApiBase(apiBase: string): string {
  return apiBase.replace(/\/$/, "");
}

async function opsFetch<T>(
  apiBase: string,
  path: string,
  init?: RequestInit,
  getAccessToken?: () => string | null | undefined,
): Promise<T> {
  const url = `${normalizeApiBase(apiBase)}${path.startsWith("/") ? path : `/${path}`}`;
  const token = getAccessToken?.()?.trim() || null;
  const { headers: initHeaders, ...rest } = init ?? {};
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(initHeaders as Record<string, string> | undefined),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Request failed (${res.status})`,
    );
  }
  return data;
}

function parseContextSummary(contextJson?: string | null): string | null {
  if (!contextJson) return null;
  try {
    const parsed = JSON.parse(contextJson) as { contextSummary?: string | null };
    return parsed.contextSummary?.trim() || null;
  } catch {
    return null;
  }
}

function parseDraftReply(bodyJson: string): string | null {
  try {
    const parsed = JSON.parse(bodyJson) as { draft_reply?: string };
    return parsed.draft_reply?.trim() || null;
  } catch {
    return null;
  }
}

function pendingProposal(proposals: Proposal[]): Proposal | undefined {
  return proposals.find((p) => p.status === "pending_review" || p.status === "needs_info");
}

function actionGuide(p?: Proposal, kind?: string): string {
  if (!p) return "Reply to the customer or update status.";
  if (p.proposalType === "bug_fix" || kind === "bug") {
    return "Verify root cause, then Approve to create a GitHub issue — or Need info / Reject.";
  }
  if (p.proposalType === "feature" || kind === "feature") {
    return "Confirm MVP scope, then Approve to backlog — or Need info / Reject.";
  }
  if (p.proposalType === "escalate") {
    return "Take over or send an edited reply. Escalations stay human-owned.";
  }
  return "Review the AI draft: Send, Edit & send, Take over, or Need info.";
}

export function SupportOpsConsole(props: SupportOpsConsoleProps) {
  const { apiBase, className, pollMs = 8000, getAccessToken } = props;

  const fetchApi = useCallback(
    <T,>(path: string, init?: RequestInit) =>
      opsFetch<T>(apiBase, path, init, getAccessToken),
    [apiBase, getAccessToken],
  );
  const [tab, setTab] = useState<"inbox" | "kb">("inbox");
  const [kindFilter, setKindFilter] = useState<string>("attention");
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [counts, setCounts] = useState<TicketCounts>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    ticket: TicketSummary;
    messages: TicketMessage[];
    proposals: Proposal[];
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kbFilter, setKbFilter] = useState("draft");
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<KbArticle | null>(null);

  const loadInbox = useCallback(async () => {
    const q =
      kindFilter === "attention"
        ? "status=attention"
        : kindFilter === "all"
          ? ""
          : `kind=${encodeURIComponent(kindFilter)}`;
    const data = await fetchApi<{
      ok: boolean;
      tickets: TicketSummary[];
      counts: TicketCounts;
    }>(`/admin/tickets${q ? `?${q}` : ""}`);
    setTickets(data.tickets ?? []);
    setCounts(data.counts ?? {});
  }, [fetchApi, kindFilter]);

  const loadDetail = useCallback(
    async (id: string) => {
      const data = await fetchApi<{
        ok: boolean;
        ticket: TicketSummary;
        messages: TicketMessage[];
        proposals: Proposal[];
      }>(`/admin/tickets/${id}`);
      setDetail({
        ticket: data.ticket,
        messages: data.messages ?? [],
        proposals: data.proposals ?? [],
      });
      const pending = pendingProposal(data.proposals ?? []);
      setEditDraft(pending ? parseDraftReply(pending.bodyJson) || "" : "");
      setSelectedId(id);
    },
    [fetchApi],
  );

  const loadKb = useCallback(async () => {
    if (kbFilter === "gaps") {
      const data = await fetchApi<{ ok: boolean; gaps: Gap[] }>("/admin/gaps");
      setGaps(data.gaps ?? []);
      setArticles([]);
      return;
    }
    const data = await fetchApi<{ ok: boolean; articles: KbArticle[] }>(`/admin/kb?status=${encodeURIComponent(kbFilter)}`,
    );
    setArticles(data.articles ?? []);
  }, [fetchApi, kbFilter]);

  useEffect(() => {
    if (tab === "inbox") {
      void loadInbox().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    } else {
      void loadKb().catch((e) => setError(e instanceof Error ? e.message : "KB load failed"));
    }
  }, [tab, loadInbox, loadKb]);

  useEffect(() => {
    const t = setInterval(() => {
      if (tab === "inbox") void loadInbox().catch(() => {});
      if (selectedId) void loadDetail(selectedId).catch(() => {});
    }, pollMs);
    return () => clearInterval(t);
  }, [tab, pollMs, loadInbox, loadDetail, selectedId]);

  const runProposal = async (action: string, message?: string) => {
    if (!detail) return;
    const pending = pendingProposal(detail.proposals);
    if (!pending && action !== "reply") return;
    setBusy(true);
    setError(null);
    try {
      if (action === "reply") {
        await fetchApi(`/admin/tickets/${detail.ticket.id}/reply`, {
          method: "POST",
          body: JSON.stringify({ body: draft }),
        });
        setDraft("");
      } else if (pending) {
        await fetchApi(`/admin/proposals/${pending.id}/action`, {
          method: "POST",
          body: JSON.stringify({
            action,
            draft_reply: editDraft || undefined,
            message,
          }),
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

  const setStatus = async (status: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await fetchApi(`/admin/tickets/${detail.ticket.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
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
        body: JSON.stringify({}),
      });
      setTab("kb");
      setKbFilter("draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promote failed");
    } finally {
      setBusy(false);
    }
  };

  const shell: CSSProperties = {
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: 14,
    color: "#0f172a",
    display: "grid",
    gridTemplateColumns: "280px 1fr",
    gap: 12,
    minHeight: 520,
  };

  const pending = detail ? pendingProposal(detail.proposals) : undefined;
  const ctx = detail ? parseContextSummary(detail.ticket.contextJson) : null;

  return (
    <div className={className} data-support-kit="ops-console" style={{ ...shell }}>
      <aside
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          background: "#fff",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0" }}>
          {(["inbox", "kb"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: 10,
                border: "none",
                background: tab === t ? "#eff6ff" : "#fff",
                color: tab === t ? ACCENT : "#475569",
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "uppercase",
                fontSize: 12,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "inbox" ? (
          <>
            <div style={{ padding: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {[
                ["attention", "Needs attention"],
                ["support", "Support"],
                ["bug", "Bugs"],
                ["feature", "Features"],
                ["all", "All"],
              ].map(([id, label]) => (
                <button
                  key={id!}
                  type="button"
                  onClick={() => setKindFilter(id!)}
                  style={{
                    border: `1px solid ${kindFilter === id ? ACCENT : "#e2e8f0"}`,
                    background: kindFilter === id ? "#eff6ff" : "#fff",
                    borderRadius: 999,
                    padding: "4px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {label}
                  {id === "attention" && counts.pending_review_proposals
                    ? ` (${counts.pending_review_proposals})`
                    : ""}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void loadDetail(t.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderBottom: "1px solid #f1f5f9",
                    background: selectedId === t.id ? "#f8fafc" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    #{t.publicNumber} · {t.kind ?? "?"}
                    {t.hasPendingProposal ? " · AI" : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {t.status}
                    {t.topic ? ` · ${t.topic}` : ""}
                    {t.severity ? ` · ${t.severity}` : ""}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    {(t.subject || "").slice(0, 80)}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {["draft", "active", "deprecated", "gaps"].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setKbFilter(id);
                    setSelectedArticle(null);
                  }}
                  style={{
                    border: `1px solid ${kbFilter === id ? ACCENT : "#e2e8f0"}`,
                    background: kbFilter === id ? "#eff6ff" : "#fff",
                    borderRadius: 999,
                    padding: "4px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {id}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {kbFilter === "gaps"
                ? gaps.map((g) => (
                    <div
                      key={g.id}
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #f1f5f9",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{g.userQuestion.slice(0, 120)}</div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>{g.summary}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        <button
                          type="button"
                          disabled={busy}
                          style={{ fontSize: 12, cursor: "pointer" }}
                          onClick={() => {
                            setBusy(true);
                            setError(null);
                            void fetchApi<{
                              ok: boolean;
                              article?: KbArticle;
                              error?: string;
                              confidence?: number;
                            }>(`/admin/gaps/${g.id}/research`, {
                              method: "POST",
                              body: JSON.stringify({}),
                            })
                              .then((res) => {
                                if (res.article) {
                                  setKbFilter("draft");
                                  setSelectedArticle(res.article);
                                  return loadKb();
                                }
                                throw new Error(res.error || "Research failed");
                              })
                              .catch((e) =>
                                setError(
                                  e instanceof Error ? e.message : "Codebase research failed",
                                ),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          Research codebase
                        </button>
                        <button
                          type="button"
                          style={{ fontSize: 12, cursor: "pointer" }}
                          onClick={() =>
                            void fetchApi(`/admin/gaps/${g.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: "dismissed" }),
                            }).then(() => loadKb())
                          }
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))
                : articles.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedArticle(a)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: 10,
                        border: "none",
                        borderBottom: "1px solid #f1f5f9",
                        background: selectedArticle?.id === a.id ? "#f8fafc" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{a.title}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        {a.sourceKind} · {a.visibility ?? "agent"} · {a.status}
                      </div>
                    </button>
                  ))}
            </div>
          </>
        )}
      </aside>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          background: "#fff",
          padding: 16,
          overflow: "auto",
        }}
      >
        {error ? (
          <p style={{ color: "#b91c1c", marginTop: 0 }}>{error}</p>
        ) : null}

        {tab === "kb" && selectedArticle ? (
          <>
            <h3 style={{ marginTop: 0 }}>{selectedArticle.title}</h3>
            <p style={{ fontSize: 12, color: "#64748b" }}>
              {selectedArticle.sourceKind} · visibility={selectedArticle.visibility} ·{" "}
              {selectedArticle.status}
            </p>
            {selectedArticle.provenanceJson ? (
              <pre style={{ fontSize: 11, background: "#f8fafc", padding: 8 }}>
                {selectedArticle.provenanceJson}
              </pre>
            ) : null}
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#f8fafc",
                padding: 12,
                borderRadius: 8,
              }}
            >
              {selectedArticle.body}
            </pre>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {selectedArticle.status === "draft" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void fetchApi(`/admin/kb/${selectedArticle.id}/promote`, {
                      method: "POST",
                      body: JSON.stringify({ visibility: "agent" }),
                    }).then(async () => {
                      await loadKb();
                      setSelectedArticle(null);
                    })
                  }
                  style={{
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: 8,
                    background: ACCENT,
                    color: "#fff",
                    fontWeight: 600,
                  }}
                >
                  Promote
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void fetchApi(`/admin/kb/${selectedArticle.id}/deprecate`, {
                    method: "POST",
                    body: "{}",
                  }).then(async () => {
                    await loadKb();
                    setSelectedArticle(null);
                  })
                }
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                }}
              >
                Deprecate
              </button>
            </div>
          </>
        ) : null}

        {tab === "inbox" && !detail ? (
          <p style={{ color: "#64748b" }}>Select a ticket to review the thread and proposals.</p>
        ) : null}

        {tab === "inbox" && detail ? (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
            <div>
              <h3 style={{ marginTop: 0 }}>
                #{detail.ticket.publicNumber} · {detail.ticket.kind} · {detail.ticket.status}
              </h3>
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                {actionGuide(pending, detail.ticket.kind)}
              </div>
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                    {m.authorType} · {new Date(m.createdAt).toLocaleString()}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                  {m.citationJson ? (
                    <div style={{ fontSize: 11, color: "#047857", marginTop: 6 }}>
                      Sources: {m.citationJson}
                    </div>
                  ) : null}
                </div>
              ))}
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void runProposal("reply");
                }}
                style={{ display: "flex", gap: 8, marginTop: 8 }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Staff reply…"
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                  }}
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  style={{
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: 8,
                    background: ACCENT,
                    color: "#fff",
                    fontWeight: 600,
                  }}
                >
                  Send
                </button>
              </form>
            </div>
            <div>
              {ctx ? (
                <div
                  style={{
                    background: "#f8fafc",
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 12,
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <strong>User context</strong>
                  {"\n"}
                  {ctx}
                </div>
              ) : null}
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                Topic: {detail.ticket.topic ?? "—"}
                {detail.ticket.severity ? ` · Severity: ${detail.ticket.severity}` : ""}
                {detail.ticket.githubIssueUrl ? (
                  <>
                    {" · "}
                    <a href={detail.ticket.githubIssueUrl} target="_blank" rel="noreferrer">
                      GitHub
                    </a>
                  </>
                ) : null}
              </div>
              {pending ? (
                <div
                  style={{
                    border: "1px solid #fde68a",
                    background: "#fffbeb",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    Proposal · {pending.proposalType} · {pending.status}
                  </div>
                  <div style={{ fontSize: 13, margin: "6px 0" }}>{pending.summary}</div>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={6}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {(pending.proposalType === "bug_fix" ||
                    pending.proposalType === "feature") ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runProposal("approve")}
                      >
                        Approve → GitHub
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runProposal("send_reply")}
                        >
                          Send draft
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runProposal("edit_send")}
                        >
                          Edit & send
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runProposal("take_over")}
                        >
                          Take over
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runProposal("need_info")}
                    >
                      Need info
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runProposal("reject")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ color: "#64748b", fontSize: 13 }}>No pending proposal.</p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => void setStatus("resolved")}>
                  Resolve
                </button>
                <button type="button" disabled={busy} onClick={() => void setStatus("closed")}>
                  Close
                </button>
                <button type="button" disabled={busy} onClick={() => void setStatus("pending_ops")}>
                  Reopen ops
                </button>
                <button type="button" disabled={busy} onClick={() => void promoteFromTicket()}>
                  Promote answer to KB
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "kb" && !selectedArticle && kbFilter !== "gaps" ? (
          <p style={{ color: "#64748b" }}>Select a KB article to review and promote.</p>
        ) : null}
      </section>
    </div>
  );
}
