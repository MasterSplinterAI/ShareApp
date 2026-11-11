import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type FormEvent,
} from "react";

export interface SupportTenantOption {
  id: string;
  label: string;
}

export interface SupportConsoleFilters {
  kind: string;
  knowledgeStatus: string;
  marketingLeadsOnly: boolean;
}

export interface SupportOpsConsoleProps {
  apiBase: string;
  className?: string;
  pollMs?: number;
  /** Bearer JWT for hosts without cookie sessions (e.g. ShareApp). */
  getAccessToken?: () => string | null | undefined;
  /** Connected app tenants for unified portfolio filtering */
  tenants?: SupportTenantOption[];
  /** Controlled business selection; portfolio aggregation is authorized by the host. */
  selectedTenantId?: string;
  hideTenantSelector?: boolean;
  onSelectTenant?: (tenantId: string) => void;
  selectedTab?: "inbox" | "kb" | "leads";
  onTabChange?: (tab: "inbox" | "kb" | "leads") => void;
  filters?: Partial<SupportConsoleFilters>;
  onFilterChange?: (patch: Partial<SupportConsoleFilters>) => void;
  selectedRecordId?: string | null;
  onRecordChange?: (id: string | null, tenantId?: string) => void;
  requestSignal?: AbortSignal;
  onUnauthorized?: () => void;
}

type TicketSummary = {
  id: string;
  tenantId?: string;
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
  tenantId?: string;
  authorType: string;
  body: string;
  citationJson?: string | null;
  createdAt: string;
};

type Proposal = {
  id: string;
  tenantId?: string;
  proposalType: string;
  status: string;
  summary: string;
  bodyJson: string;
  createdAt: string;
};

type KbArticle = {
  id: string;
  tenantId?: string;
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
  tenantId?: string;
  userQuestion: string;
  summary?: string | null;
  status: string;
  ticketId: string;
};

type Lead = {
  id: string;
  tenantId?: string;
  email: string;
  name: string;
  phone?: string | null;
  marketingEmailOptIn: boolean;
  marketingSmsOptIn: boolean;
  source: string;
  consentText?: string | null;
  consentAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

function tenantBadgeColors(_tenantId?: string): { bg: string; fg: string; border: string } {
  return { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1" };
}

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
    throw Object.assign(new Error(
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Request failed (${res.status})`,
    ), {status:res.status});
  }
  init?.signal?.throwIfAborted();
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
  const {
    apiBase,
    className,
    pollMs = 8000,
    getAccessToken,
    tenants = [],
    selectedTenantId,
    onSelectTenant,
  } = props;

  const [internalTenant, setInternalTenant] = useState<string | undefined>(selectedTenantId ?? tenants[0]?.id);
  const activeTenant = selectedTenantId ?? internalTenant;
  const displayTenant=(id?:string)=>tenants.find(t=>t.id===id)?.label||id||"";

  const handleSelectTenant = (tenantId: string) => {
    setInternalTenant(tenantId);
    onSelectTenant?.(tenantId);
    setSelectedId(null);
    setDetail(null);
    setSelectedArticle(null);
    setSelectedLead(null);
  };

  const fetchApi = useCallback(
    <T,>(path: string, init?: RequestInit) => {
      const mergedInit: RequestInit = {
        ...init,
        headers: {
          ...(activeTenant ? { "x-tenant-id": activeTenant } : {}),
          ...((init?.headers as Record<string, string>) ?? {}),
        },
      };
      mergedInit.signal = props.requestSignal && init?.signal ? AbortSignal.any([props.requestSignal, init.signal]) : props.requestSignal ?? init?.signal ?? null;
      return opsFetch<T>(apiBase, path, mergedInit, getAccessToken).catch(error=>{if(error.status===401)props.onUnauthorized?.();throw error;});
    },
    [apiBase, getAccessToken, activeTenant, props.requestSignal, props.onUnauthorized],
  );
  const [internalTab, setInternalTab] = useState<"inbox" | "kb" | "leads">("inbox");
  const tab=props.selectedTab??internalTab;
  const setTab=(value:typeof tab)=>{setInternalTab(value);props.onTabChange?.(value);};
  const [internalKind, setInternalKind] = useState<string>("attention");
  const kindFilter = props.filters?.kind ?? internalKind;
  const setKindFilter = (kind: string) => { setInternalKind(kind); props.onFilterChange?.({kind}); };
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [counts, setCounts] = useState<TicketCounts>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedDetail, setDetail] = useState<{
    ticket: TicketSummary;
    messages: TicketMessage[];
    proposals: Proposal[];
  } | null>(null);
  const detail = props.selectedRecordId !== undefined && (!props.selectedRecordId || (loadedDetail?.ticket.id !== props.selectedRecordId && String(loadedDetail?.ticket.publicNumber) !== props.selectedRecordId)) ? null : loadedDetail;
  const detailRequest = useRef(0);
  const [draft, setDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [internalKnowledgeStatus, setInternalKnowledgeStatus] = useState("draft");
  const kbFilter = props.filters?.knowledgeStatus ?? internalKnowledgeStatus;
  const setKbFilter = (knowledgeStatus: string) => { setInternalKnowledgeStatus(knowledgeStatus); props.onFilterChange?.({knowledgeStatus}); };
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loadedArticle, setSelectedArticle] = useState<KbArticle | null>(null);
  const selectedArticle = props.selectedRecordId !== undefined && loadedArticle?.id !== props.selectedRecordId ? null : loadedArticle;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [internalMarketingLeadsOnly, setInternalMarketingLeadsOnly] = useState(false);
  const leadsMarketingOnly = props.filters?.marketingLeadsOnly ?? internalMarketingLeadsOnly;
  const setLeadsMarketingOnly = (marketingLeadsOnly: boolean) => { setInternalMarketingLeadsOnly(marketingLeadsOnly); props.onFilterChange?.({marketingLeadsOnly}); };
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

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
    async (id: string, signal?: AbortSignal) => {
      const request = ++detailRequest.current;
      const data = await fetchApi<{
        ok: boolean;
        ticket: TicketSummary;
        messages: TicketMessage[];
        proposals: Proposal[];
      }>(`/admin/tickets/${encodeURIComponent(id)}`, {signal: signal ?? null});
      if(request !== detailRequest.current) return;
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

  useEffect(() => {
    if (props.selectedRecordId === undefined) return;
    const controller = new AbortController();
    if (tab === 'inbox' && props.selectedRecordId) {
      void loadDetail(props.selectedRecordId, controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    } else { setDetail(null); setSelectedId(null); }
    return () => { controller.abort(); detailRequest.current++; };
  }, [props.selectedRecordId, tab, loadDetail]);
  useEffect(() => {
    if (props.selectedRecordId === undefined || tab !== 'kb') return;
    const controller = new AbortController();
    setSelectedArticle(null);
    if (props.selectedRecordId) {
      void fetchApi<{article: KbArticle}>(`/admin/kb/${encodeURIComponent(props.selectedRecordId)}`, {signal: controller.signal})
        .then(result => setSelectedArticle(result.article))
        .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    }
    return () => controller.abort();
  }, [props.selectedRecordId, tab, fetchApi]);
  useEffect(() => { if (props.selectedRecordId !== undefined && tab === 'leads') setSelectedLead(leads.find(l => l.id === props.selectedRecordId) ?? null); }, [props.selectedRecordId, tab, leads]);

  const loadKb = useCallback(async () => {
    if (kbFilter === "gaps") {
      const data = await fetchApi<{ ok: boolean; gaps: Gap[] }>("/admin/gaps");
      setGaps(data.gaps ?? []);
      setArticles([]);
      return;
    }
    const data = await fetchApi<{ ok: boolean; articles: KbArticle[] }>(
      `/admin/kb?status=${encodeURIComponent(kbFilter)}`,
    );
    setArticles(data.articles ?? []);
  }, [fetchApi, kbFilter]);

  const loadLeads = useCallback(async () => {
    const q = leadsMarketingOnly ? "?marketing=1" : "";
    const data = await fetchApi<{ ok: boolean; leads: Lead[] }>(`/admin/leads${q}`);
    setLeads(data.leads ?? []);
  }, [fetchApi, leadsMarketingOnly]);

  useEffect(() => {
    if (tab === "inbox") {
      void loadInbox().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    } else if (tab === "kb") {
      void loadKb().catch((e) => setError(e instanceof Error ? e.message : "KB load failed"));
    } else if (tab === "leads") {
      void loadLeads().catch((e) => setError(e instanceof Error ? e.message : "Leads load failed"));
    }
  }, [tab, loadInbox, loadKb, loadLeads]);

  useEffect(() => {
    if (tab === "leads") void loadLeads().catch(() => {});
  }, [leadsMarketingOnly, tab, loadLeads]);

  useEffect(() => {
    const t = setInterval(() => {
      if (tab === "inbox") void loadInbox().catch(() => {});
      const activeRecord = props.selectedRecordId === undefined ? selectedId : props.selectedRecordId;
      if (activeRecord && tab === "inbox") void loadDetail(activeRecord).catch(() => {});
    }, pollMs);
    return () => clearInterval(t);
  }, [tab, pollMs, loadInbox, loadDetail, selectedId, props.selectedRecordId]);

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
    <div className={className} data-support-kit="ops-console">
      {tenants.length > 0 && !props.hideTenantSelector ? (
        <div
          data-testid="support-tenant-switcher"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
            padding: "10px 14px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginRight: 4 }}>
              Connected App Filter:
            </span>
            {tenants.map((t) => {
              const countKey = `tenant_${t.id}`;
              const countVal = counts[countKey];
              const isSelected = activeTenant === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`support-tenant-pill-${t.id}`}
                  onClick={() => handleSelectTenant(t.id)}
                  style={{
                    border: `1px solid ${isSelected ? ACCENT : "#cbd5e1"}`,
                    background: isSelected ? ACCENT : "#fff",
                    color: isSelected ? "#fff" : "#334155",
                    borderRadius: 999,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                  {typeof countVal === "number" ? ` (${countVal})` : ""}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            Support inbox
          </span>
        </div>
      ) : null}
      <div style={{ ...shell }}>
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
          {(["inbox", "kb", "leads"] as const).map((t) => (
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
                  onClick={() => props.onRecordChange ? props.onRecordChange(String(t.publicNumber), t.tenantId) : void loadDetail(t.id)}
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
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontWeight: 700 }}>
                      #{t.publicNumber} · {t.kind ?? "?"}
                      {t.hasPendingProposal ? " · AI" : ""}
                    </span>
                    {t.tenantId ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: tenantBadgeColors(t.tenantId).bg,
                          color: tenantBadgeColors(t.tenantId).fg,
                          border: `1px solid ${tenantBadgeColors(t.tenantId).border}`,
                        }}
                      >
                        {displayTenant(t.tenantId)}
                      </span>
                    ) : null}
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
        ) : tab === "kb" ? (
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
                                  if (props.onRecordChange) props.onRecordChange(res.article.id, res.article.tenantId);
                                  else setSelectedArticle(res.article);
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
                      onClick={() => props.onRecordChange ? props.onRecordChange(a.id, a.tenantId) : setSelectedArticle(a)}
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
        ) : (
          <>
            <div style={{ padding: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              <button
                type="button"
                onClick={() => {
                  setLeadsMarketingOnly(false);
                  void loadLeads();
                }}
                style={{
                  border: `1px solid ${!leadsMarketingOnly ? ACCENT : "#e2e8f0"}`,
                  background: !leadsMarketingOnly ? "#eff6ff" : "#fff",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeadsMarketingOnly(true);
                }}
                style={{
                  border: `1px solid ${leadsMarketingOnly ? ACCENT : "#e2e8f0"}`,
                  background: leadsMarketingOnly ? "#eff6ff" : "#fff",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Marketing opt-in
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {leads.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => props.onRecordChange ? props.onRecordChange(l.id, l.tenantId) : setSelectedLead(l)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderBottom: "1px solid #f1f5f9",
                    background: selectedLead?.id === l.id ? "#f8fafc" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{l.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{l.email}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {l.marketingEmailOptIn ? "Email opt-in" : "No email marketing"}
                    {l.marketingSmsOptIn ? " · SMS opt-in" : ""}
                    {l.phone ? ` · ${l.phone}` : ""}
                  </div>
                </button>
              ))}
              {leads.length === 0 ? (
                <p style={{ padding: 12, color: "#64748b", fontSize: 13 }}>No leads yet.</p>
              ) : null}
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

        {tab === "leads" && !selectedLead ? (
          <p style={{ color: "#64748b" }}>Select a lead to review consent details.</p>
        ) : null}

        {tab === "leads" && selectedLead ? (
          <>
            <h3 style={{ marginTop: 0 }}>{selectedLead.name}</h3>
            <p style={{ margin: "4px 0" }}>
              <strong>Email:</strong> {selectedLead.email}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Phone:</strong> {selectedLead.phone || "—"}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Marketing email:</strong>{" "}
              {selectedLead.marketingEmailOptIn ? "Opted in" : "Not opted in"}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Marketing SMS:</strong>{" "}
              {selectedLead.marketingSmsOptIn ? "Opted in" : "Not opted in"}
            </p>
            <p style={{ margin: "4px 0", fontSize: 13, color: "#64748b" }}>
              Source: {selectedLead.source} · Consent at:{" "}
              {selectedLead.consentAt || selectedLead.updatedAt}
            </p>
            {selectedLead.consentText ? (
              <blockquote
                style={{
                  margin: "12px 0",
                  padding: 12,
                  background: "#f8fafc",
                  borderLeft: `3px solid ${ACCENT}`,
                  fontSize: 13,
                }}
              >
                {selectedLead.consentText}
              </blockquote>
            ) : null}
          </>
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
                      props.onRecordChange?.(null);
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
                    props.onRecordChange?.(null);
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
                #{detail.ticket.publicNumber} · {detail.ticket.subject || detail.ticket.kind} · {detail.ticket.status}
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
    </div>
  );
}
