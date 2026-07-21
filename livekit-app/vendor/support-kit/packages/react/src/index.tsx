import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { PlainMultiline, SupportMarkdown } from "./markdown.js";

export interface SupportLauncherProps {
  apiBase: string;
  user?: {
    id: string;
    name?: string;
    email?: string;
    planLabel?: string;
  };
  brand?: { name: string; accent?: string; supportAgentName?: string };
  position?: "bottom-right" | "bottom-left";
  /**
   * Nudge the floating bubble so it clears host UI (e.g. a Send button
   * anchored bottom-right). Ignored in `mode="page"`.
   */
  offset?: { bottom?: number; left?: number; right?: number };
  mode?: "bubble" | "page";
  renderTrigger?: (open: () => void) => ReactNode;
  className?: string;
  /**
   * Hosts that use Bearer JWT (ShareApp) instead of cookie sessions.
   * Return the raw token; Authorization header is attached automatically.
   */
  getAccessToken?: () => string | null | undefined;
}

type CoachDraft = {
  problem: string;
  solution: string;
  priority: string;
  subject: string;
};

type CoachBubble = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type View =
  | { name: "home" }
  | { name: "supportChat" }
  | { name: "compose"; kind: "bug" | "feature" }
  | { name: "thread"; ticketId: string }
  | { name: "tickets" };

type ChatBubble = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  ticketPublicNumber?: number;
};

type TicketSummary = {
  id: string;
  publicNumber: number;
  status: string;
  kind?: string;
  topic?: string;
  subject?: string | null;
  severity?: string | null;
  priority?: string | null;
  createdAt: string;
};

type TicketMessage = {
  id: string;
  authorType: string;
  body: string;
  createdAt: string;
};

const DEFAULT_ACCENT = "#2563eb";

function normalizeApiBase(apiBase: string): string {
  return apiBase.replace(/\/$/, "");
}

async function supportFetch<T>(
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
    const message =
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function statusLabel(status: string): string {
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

const shell: CSSProperties = {
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 14,
  lineHeight: 1.45,
  color: "#0f172a",
};

export function SupportLauncher(props: SupportLauncherProps) {
  const {
    apiBase,
    user,
    brand,
    position = "bottom-right",
    offset,
    mode = "bubble",
    renderTrigger,
    className,
    getAccessToken,
  } = props;

  const fetchApi = useCallback(
    <T,>(path: string, init?: RequestInit) =>
      supportFetch<T>(apiBase, path, init, getAccessToken),
    [apiBase, getAccessToken],
  );

  const accent = brand?.accent ?? DEFAULT_ACCENT;
  const label = brand?.name ?? "Support";
  const agentName = brand?.supportAgentName ?? `${label} Support`;
  const panelId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(mode === "page");
  const [view, setView] = useState<View>({ name: "home" });
  const [draft, setDraft] = useState("");
  const [supportMessages, setSupportMessages] = useState<ChatBubble[]>([]);
  const [supportTicketId, setSupportTicketId] = useState<string | null>(null);
  const [bugTitle, setBugTitle] = useState("");
  const [bugSeverity, setBugSeverity] = useState("medium");
  const [bugSteps, setBugSteps] = useState("");
  const [bugExpected, setBugExpected] = useState("");
  const [bugActual, setBugActual] = useState("");
  const [featurePriority, setFeaturePriority] = useState("important");
  const [coachTurn, setCoachTurn] = useState(0);
  const [coachProblem, setCoachProblem] = useState("");
  const [coachOutcome, setCoachOutcome] = useState("");
  const [coachEnabled, setCoachEnabled] = useState<boolean | null>(null);
  const [coachMessages, setCoachMessages] = useState<CoachBubble[]>([]);
  const [coachDraft, setCoachDraft] = useState<CoachDraft | null>(null);
  const [coachReady, setCoachReady] = useState(false);
  const [coachInput, setCoachInput] = useState("");
  const [guestEmail, setGuestEmail] = useState(user?.email ?? "");
  const [submittedTicket, setSubmittedTicket] = useState<TicketSummary | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [thread, setThread] = useState<{
    ticket: TicketSummary;
    messages: TicketMessage[];
  } | null>(null);
  const [threadDraft, setThreadDraft] = useState("");

  const isOpen = mode === "page" || open;

  const startSupportChat = useCallback(() => {
    setSupportMessages([
      {
        id: "welcome",
        role: "assistant",
        text: `Hi — I'm ${agentName}. Ask me anything about the product, your account, or billing. I'll figure out the details and help right here.`,
      },
    ]);
    setSupportTicketId(null);
    setDraft("");
    setError(null);
    setView({ name: "supportChat" });
  }, [agentName]);

  const resetFeatureCompose = useCallback(() => {
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

  useEffect(() => {
    if (view.name !== "compose" || view.kind !== "feature") return;
    let cancelled = false;
    void fetchApi<{ ok: boolean; coachEnabled?: boolean }>("/config")
      .then((cfg) => {
        if (cancelled) return;
        const enabled = Boolean(cfg.coachEnabled);
        setCoachEnabled(enabled);
        if (enabled) {
          setCoachMessages((prev) =>
            prev.length === 0
              ? [
                  {
                    id: "coach-welcome",
                    role: "assistant",
                    text: `Tell me what you'd like ${label} to do better — I'll help shape it into a clear feature request.`,
                  },
                ]
              : prev,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setCoachEnabled(false);
      });
    return () => {
      cancelled = true;
    };
    // Only re-run when entering feature compose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchApi, view.name, view.name === "compose" ? view.kind : null, label]);

  useEffect(() => {
    if (view.name === "compose" && view.kind === "feature" && coachEnabled) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [view, coachMessages, coachEnabled, sending]);

  const sendCoachTurn = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = coachInput.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    const nextUser: CoachBubble = {
      id: `u-${Date.now()}`,
      role: "user",
      text: message,
    };
    const history = [...coachMessages, nextUser];
    setCoachMessages(history);
    setCoachInput("");
    try {
      const data = await fetchApi<{
        ok: boolean;
        reply: string;
        readyToSubmit: boolean;
        draft: CoachDraft;
        error?: string;
      }>("/coach", {
        method: "POST",
        body: JSON.stringify({
          kind: "feature_request",
          messages: history.map((m) => ({
            role: m.role,
            body: m.text,
          })),
        }),
      });
      setCoachMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.reply,
        },
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

  const loadTickets = useCallback(async () => {
    try {
      const data = await fetchApi<{ ok: boolean; tickets: TicketSummary[] }>("/tickets",
      );
      setTickets(data.tickets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    }
  }, [fetchApi]);

  const openThread = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const data = await fetchApi<{
          ok: boolean;
          ticket: TicketSummary;
          messages: TicketMessage[];
        }>(`/tickets/${id}`);
        setThread({ ticket: data.ticket, messages: data.messages ?? [] });
        setView({ name: "thread", ticketId: id });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load ticket");
      }
    }, [fetchApi],
  );

  useEffect(() => {
    if (isOpen && (view.name === "home" || view.name === "tickets")) {
      void loadTickets();
    }
  }, [isOpen, view.name, loadTickets]);

  useEffect(() => {
    if (view.name === "thread" && thread) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    if (view.name === "supportChat") {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [view, thread, supportMessages, sending]);

  // Poll thread while AI working
  useEffect(() => {
    if (view.name !== "thread" || !thread) return;
    if (thread.ticket.status !== "ai_working") return;
    const t = setInterval(() => {
      void openThread(thread.ticket.id);
    }, 2500);
    return () => clearInterval(t);
  }, [view, thread, openThread]);

  const sendSupportChat = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;

    const userBubble: ChatBubble = {
      id: `u-${Date.now()}`,
      role: "user",
      text: message,
    };
    setSupportMessages((prev) => [...prev, userBubble]);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      if (supportTicketId) {
        await fetchApi(`/tickets/${supportTicketId}/messages`, {
          method: "POST",
          body: JSON.stringify({ body: message }),
        });
        const data = await fetchApi<{
          ok: boolean;
          ticket: TicketSummary;
          messages: TicketMessage[];
        }>(`/tickets/${supportTicketId}`);
        setSupportMessages(
          (data.messages ?? []).map((m) => ({
            id: m.id,
            role:
              m.authorType === "user"
                ? "user"
                : m.authorType === "system"
                  ? "system"
                  : "assistant",
            text: m.body,
          })),
        );
      } else {
        const data = await fetchApi<{
          ok: boolean;
          ticket?: TicketSummary;
          reply?: string;
        }>("/chat", {
          method: "POST",
          body: JSON.stringify({
            message,
            kind: "support",
          }),
        });
        if (data.ticket?.id) {
          setSupportTicketId(data.ticket.id);
        }
        const bot: ChatBubble = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.reply ?? "Thanks — we're on it.",
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

  const submitBug = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!bugTitle.trim() || sending) return;
    if (!user?.id && !guestEmail.trim()) {
      setError("Enter your email so we can follow up");
      return;
    }
    setSending(true);
    setError(null);
    const body = [
      `**Steps to reproduce**\n${bugSteps || "(not provided)"}`,
      `**Expected**\n${bugExpected || "(not provided)"}`,
      `**Actual**\n${bugActual || "(not provided)"}`,
      `\nURL: ${typeof window !== "undefined" ? window.location.href : ""}`,
      `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
    ].join("\n\n");
    try {
      const data = await fetchApi<{
        ok: boolean;
        ticket: TicketSummary;
      }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          kind: "bug",
          topic: "other",
          subject: bugTitle.trim(),
          severity: bugSeverity,
          body,
          ...(!user?.id ? { guestEmail: guestEmail.trim() } : {}),
        }),
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
      `**Problem**\n${problem}`,
      `**Desired outcome**\n${outcome || "(not provided)"}`,
      `**Priority**\n${priority}`,
    ].join("\n\n");
    try {
      const data = await fetchApi<{
        ok: boolean;
        ticket: TicketSummary;
      }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          kind: "feature",
          topic: "product",
          subject:
            (coachDraft?.subject || problem).slice(0, 120) || "Feature request",
          priority,
          body,
          ...(!user?.id ? { guestEmail: guestEmail.trim() } : {}),
        }),
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

  const replyInThread = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!thread || !threadDraft.trim() || sending) return;
    if (thread.ticket.status === "closed") return;
    setSending(true);
    setError(null);
    try {
      await fetchApi(`/tickets/${thread.ticket.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: threadDraft.trim() }),
      });
      setThreadDraft("");
      await openThread(thread.ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply failed");
    } finally {
      setSending(false);
    }
  };

  const panelStyle: CSSProperties =
    mode === "page"
      ? {
          ...shell,
          display: "flex",
          flexDirection: "column",
          width: "100%",
          minHeight: 520,
          borderRadius: 16,
          overflow: "hidden",
          background: "#fff",
          border: "1px solid #e2e8f0",
        }
      : {
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
          boxShadow: "0 18px 48px rgba(15, 23, 42, 0.18)",
        };

  const intentBtn = (active?: boolean): CSSProperties => ({
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    marginBottom: 10,
    borderRadius: 12,
    border: `1px solid ${active ? accent : "#e2e8f0"}`,
    background: active ? "#eff6ff" : "#fff",
    cursor: "pointer",
    fontWeight: 600,
  });

  const panel = isOpen ? (
    <div id={panelId} role="dialog" aria-label={`${label} support`} style={panelStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{label}</h2>
          {user?.planLabel || user?.email ? (
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              {[user.planLabel, user.name || user.email].filter(Boolean).join(" · ")}
            </div>
          ) : null}
        </div>
        {mode === "bubble" ? (
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 18,
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            ×
          </button>
        ) : null}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12, background: "#f8fafc" }}>
        {view.name === "home" ? (
          <>
            {submittedTicket ? (
              <p
                style={{
                  background: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  color: "#065f46",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                Thanks — we logged ticket #{submittedTicket.publicNumber}.
                {user?.id
                  ? " You can open it under My tickets."
                  : " We'll follow up by email."}
                <button
                  type="button"
                  onClick={() => setSubmittedTicket(null)}
                  style={{
                    display: "block",
                    marginTop: 6,
                    border: "none",
                    background: "transparent",
                    color: "#047857",
                    cursor: "pointer",
                    padding: 0,
                    fontWeight: 600,
                  }}
                >
                  Dismiss
                </button>
              </p>
            ) : null}
            <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>
              How can we help?
            </p>
            <button
              type="button"
              style={intentBtn()}
              onClick={() => startSupportChat()}
            >
              Chat with {agentName}
              <div style={{ fontWeight: 400, fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Questions about the product, account, or billing — just ask
              </div>
            </button>
            <button
              type="button"
              style={intentBtn()}
              onClick={() => setView({ name: "compose", kind: "bug" })}
            >
              Report a bug
              <div style={{ fontWeight: 400, fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Something broken or unexpected
              </div>
            </button>
            <button
              type="button"
              style={intentBtn()}
              onClick={() => {
                resetFeatureCompose();
                setView({ name: "compose", kind: "feature" });
              }}
            >
              Request a feature
              <div style={{ fontWeight: 400, fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Suggest an improvement
              </div>
            </button>
            <button
              type="button"
              style={{
                ...intentBtn(),
                marginTop: 8,
                background: "#fff",
              }}
              onClick={() => {
                setView({ name: "tickets" });
                void loadTickets();
              }}
            >
              My tickets ({tickets.filter((t) => t.status !== "closed").length})
            </button>
            {tickets.slice(0, 3).map((t) => (
              <button
                key={t.id}
                type="button"
                style={{
                  ...intentBtn(),
                  fontWeight: 500,
                  fontSize: 13,
                }}
                onClick={() => void openThread(t.id)}
              >
                #{t.publicNumber} · {t.kind ?? "support"} · {statusLabel(t.status)}
              </button>
            ))}
          </>
        ) : null}

        {view.name === "supportChat" ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 360 }}>
            <button
              type="button"
              onClick={() => setView({ name: "home" })}
              style={{
                border: "none",
                background: "transparent",
                color: accent,
                fontWeight: 600,
                marginBottom: 8,
                cursor: "pointer",
                padding: 0,
                alignSelf: "flex-start",
              }}
            >
              ← Back
            </button>
            <div
              ref={listRef}
              style={{
                flex: 1,
                overflow: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginBottom: 8,
              }}
            >
              {supportMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    padding: "10px 12px",
                    borderRadius:
                      msg.role === "user"
                        ? "14px 14px 4px 14px"
                        : "14px 14px 14px 4px",
                    background: msg.role === "user" ? accent : "#fff",
                    color: msg.role === "user" ? "#fff" : "#0f172a",
                    border: msg.role === "user" ? "none" : "1px solid #e2e8f0",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.role === "assistant" ? (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        opacity: 0.7,
                        marginBottom: 4,
                      }}
                    >
                      {agentName}
                    </div>
                  ) : null}
                  {msg.role === "assistant" || msg.role === "system" ? (
                    <SupportMarkdown text={msg.text} />
                  ) : (
                    <PlainMultiline text={msg.text} />
                  )}
                  {msg.ticketPublicNumber != null ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "6px 8px",
                        borderRadius: 8,
                        background: "rgba(4, 120, 87, 0.12)",
                        color: msg.role === "user" ? "#ecfdf5" : "#047857",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Ticket #{msg.ticketPublicNumber}
                    </div>
                  ) : null}
                </div>
              ))}
              {sending ? (
                <div
                  style={{
                    alignSelf: "flex-start",
                    padding: "10px 14px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    color: "#64748b",
                    fontSize: 13,
                  }}
                >
                  {agentName} is typing…
                </div>
              ) : null}
            </div>
            <form onSubmit={sendSupportChat} style={{ display: "flex", gap: 8 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your message…"
                aria-label="Message"
                disabled={sending}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                style={{
                  padding: "10px 14px",
                  border: "none",
                  borderRadius: 10,
                  background: accent,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {sending ? "…" : "Send"}
              </button>
            </form>
          </div>
        ) : null}

        {view.name === "compose" && view.kind === "bug" ? (
          <>
            <button
              type="button"
              onClick={() => setView({ name: "home" })}
              style={{
                border: "none",
                background: "transparent",
                color: accent,
                fontWeight: 600,
                marginBottom: 8,
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Back
            </button>
            <form onSubmit={submitBug}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Title
              </label>
              <input
                value={bugTitle}
                onChange={(e) => setBugTitle(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Severity
              </label>
              <select
                value={bugSeverity}
                onChange={(e) => setBugSeverity(e.target.value)}
                style={{ width: "100%", padding: 8, marginBottom: 8, borderRadius: 8 }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Steps
              </label>
              <textarea
                value={bugSteps}
                onChange={(e) => setBugSteps(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Expected
              </label>
              <textarea
                value={bugExpected}
                onChange={(e) => setBugExpected(e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Actual
              </label>
              <textarea
                value={bugActual}
                onChange={(e) => setBugActual(e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 8,
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                }}
              />
              {!user?.id ? (
                <>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                    Your email
                  </label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: 8,
                      marginBottom: 8,
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                    }}
                  />
                </>
              ) : null}
              <button
                type="submit"
                disabled={sending || !bugTitle.trim()}
                style={{
                  width: "100%",
                  padding: 10,
                  border: "none",
                  borderRadius: 10,
                  background: accent,
                  color: "#fff",
                  fontWeight: 600,
                }}
              >
                {sending ? "Submitting…" : "Submit bug"}
              </button>
            </form>
          </>
        ) : null}

        {view.name === "compose" && view.kind === "feature" ? (
          <>
            <button
              type="button"
              onClick={() => {
                resetFeatureCompose();
                setView({ name: "home" });
              }}
              style={{
                border: "none",
                background: "transparent",
                color: accent,
                fontWeight: 600,
                marginBottom: 8,
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Back
            </button>

            {coachEnabled === null ? (
              <p style={{ color: "#64748b", fontSize: 13 }}>Loading…</p>
            ) : coachEnabled ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 280 }}>
                <div
                  ref={listRef}
                  style={{
                    flex: 1,
                    overflow: "auto",
                    maxHeight: 280,
                    padding: 8,
                    background: "#fff",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {coachMessages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        marginBottom: 10,
                        textAlign: m.role === "user" ? "right" : "left",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-block",
                          maxWidth: "92%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          background: m.role === "user" ? accent : "#f1f5f9",
                          color: m.role === "user" ? "#fff" : "#0f172a",
                          fontSize: 13,
                          textAlign: "left",
                        }}
                      >
                        <SupportMarkdown text={m.text} />
                      </div>
                    </div>
                  ))}
                </div>

                {coachDraft && (coachReady || coachDraft.problem) ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#475569",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Draft</div>
                    <div>
                      <strong>Subject:</strong> {coachDraft.subject || "—"}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <strong>Problem:</strong> {coachDraft.problem || "—"}
                    </div>
                    {coachDraft.solution ? (
                      <div style={{ marginTop: 4 }}>
                        <strong>Solution:</strong> {coachDraft.solution}
                      </div>
                    ) : null}
                    <select
                      value={featurePriority}
                      onChange={(e) => {
                        setFeaturePriority(e.target.value);
                        setCoachDraft((d) =>
                          d ? { ...d, priority: e.target.value } : d,
                        );
                      }}
                      style={{ width: "100%", padding: 6, marginTop: 8, borderRadius: 6 }}
                    >
                      <option value="nice_to_have">Nice to have</option>
                      <option value="important">Important</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                ) : null}

                {!user?.id ? (
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="Your email"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                    }}
                  />
                ) : null}

                <form onSubmit={sendCoachTurn} style={{ display: "flex", gap: 8 }}>
                  <input
                    value={coachInput}
                    onChange={(e) => setCoachInput(e.target.value)}
                    placeholder="Describe the feature…"
                    disabled={sending}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      fontSize: 14,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={sending || !coachInput.trim()}
                    style={{
                      padding: "10px 14px",
                      border: "none",
                      borderRadius: 10,
                      background: accent,
                      color: "#fff",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {sending ? "…" : "Send"}
                  </button>
                </form>

                <button
                  type="button"
                  disabled={sending || !coachDraft?.problem}
                  onClick={() => void submitFeature()}
                  style={{
                    width: "100%",
                    padding: 10,
                    border: "none",
                    borderRadius: 10,
                    background: coachReady || coachDraft?.problem ? accent : "#94a3b8",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: coachDraft?.problem ? "pointer" : "default",
                  }}
                >
                  {sending
                    ? "Submitting…"
                    : coachReady
                      ? "Submit feature request"
                      : "Submit draft anyway"}
                </button>
              </div>
            ) : (
              <>
                <p style={{ fontWeight: 600 }}>
                  {coachTurn === 0
                    ? "What problem are you trying to solve?"
                    : coachTurn === 1
                      ? "What would a good solution look like?"
                      : "How important is this?"}
                </p>
                {coachTurn < 2 ? (
                  <>
                    <textarea
                      value={coachTurn === 0 ? coachProblem : coachOutcome}
                      onChange={(e) =>
                        coachTurn === 0
                          ? setCoachProblem(e.target.value)
                          : setCoachOutcome(e.target.value)
                      }
                      rows={4}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: 8,
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                      }}
                    />
                    <button
                      type="button"
                      disabled={
                        coachTurn === 0
                          ? !coachProblem.trim()
                          : !coachOutcome.trim()
                      }
                      onClick={() => setCoachTurn((t) => t + 1)}
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: 10,
                        border: "none",
                        borderRadius: 10,
                        background: accent,
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      Continue
                    </button>
                  </>
                ) : (
                  <>
                    {!user?.id ? (
                      <input
                        type="email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        placeholder="Your email"
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: 8,
                          marginBottom: 8,
                          borderRadius: 8,
                          border: "1px solid #cbd5e1",
                        }}
                      />
                    ) : null}
                    <select
                      value={featurePriority}
                      onChange={(e) => setFeaturePriority(e.target.value)}
                      style={{ width: "100%", padding: 8, marginBottom: 8 }}
                    >
                      <option value="nice_to_have">Nice to have</option>
                      <option value="important">Important</option>
                      <option value="critical">Critical</option>
                    </select>
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void submitFeature()}
                      style={{
                        width: "100%",
                        padding: 10,
                        border: "none",
                        borderRadius: 10,
                        background: accent,
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      {sending ? "Submitting…" : "Submit request"}
                    </button>
                  </>
                )}
              </>
            )}
          </>
        ) : null}

        {view.name === "tickets" ? (
          <>
            <button
              type="button"
              onClick={() => setView({ name: "home" })}
              style={{
                border: "none",
                background: "transparent",
                color: accent,
                fontWeight: 600,
                marginBottom: 8,
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Back
            </button>
            {tickets.length === 0 ? (
              <p style={{ color: "#64748b", textAlign: "center" }}>No tickets yet.</p>
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  style={intentBtn()}
                  onClick={() => void openThread(t.id)}
                >
                  #{t.publicNumber} · {t.kind ?? "support"}
                  <div style={{ fontWeight: 400, fontSize: 12, color: "#64748b" }}>
                    {statusLabel(t.status)}
                  </div>
                </button>
              ))
            )}
          </>
        ) : null}

        {view.name === "thread" && thread ? (
          <>
            <button
              type="button"
              onClick={() => setView({ name: "home" })}
              style={{
                border: "none",
                background: "transparent",
                color: accent,
                fontWeight: 600,
                marginBottom: 8,
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Home
            </button>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Ticket #{thread.ticket.publicNumber}
              {thread.ticket.kind ? ` · ${thread.ticket.kind}` : ""}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
              {statusLabel(thread.ticket.status)}
            </div>
            <div ref={listRef}>
              {thread.messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 8,
                    borderRadius: 10,
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      marginBottom: 4,
                      textTransform: "capitalize",
                    }}
                  >
                    {m.authorType}
                  </div>
                  {m.authorType === "user" ? (
                    <PlainMultiline text={m.body} />
                  ) : (
                    <SupportMarkdown text={m.body} />
                  )}
                </div>
              ))}
            </div>
            {thread.ticket.status !== "closed" ? (
              <form onSubmit={replyInThread} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  value={threadDraft}
                  onChange={(e) => setThreadDraft(e.target.value)}
                  placeholder="Reply…"
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !threadDraft.trim()}
                  style={{
                    padding: "10px 14px",
                    border: "none",
                    borderRadius: 10,
                    background: accent,
                    color: "#fff",
                    fontWeight: 600,
                  }}
                >
                  Send
                </button>
              </form>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>{error}</p>
        ) : null}
      </div>
    </div>
  ) : null;

  const rootStyle: CSSProperties =
    mode === "page"
      ? { ...shell, width: "100%", maxWidth: 720, margin: "0 auto" }
      : {
          ...shell,
          position: "fixed",
          bottom: offset?.bottom ?? 16,
          zIndex: 9999,
          ...(position === "bottom-left"
            ? { left: offset?.left ?? 16 }
            : { right: offset?.right ?? 16 }),
        };

  return (
    <div
      data-support-kit="launcher"
      data-api-base={apiBase}
      data-mode={mode}
      className={className}
      style={rootStyle}
    >
      {mode === "bubble" ? (
        renderTrigger ? (
          renderTrigger(() => setOpen(true))
        ) : (
          <button
            type="button"
            aria-label={`Open ${label} help`}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "12px 18px",
              border: "none",
              borderRadius: 999,
              background: accent,
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(15, 23, 42, 0.18)",
            }}
          >
            {label} Help
          </button>
        )
      ) : null}
      {panel}
    </div>
  );
}

export { SupportOpsConsole } from "./SupportOpsConsole.js";
export type { SupportOpsConsoleProps } from "./SupportOpsConsole.js";
