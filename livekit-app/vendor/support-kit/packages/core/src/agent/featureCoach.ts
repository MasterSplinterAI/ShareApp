import type { BrandConfig } from "@rhule/support-shared";
import type { LlmAdapter } from "../adapters/types.js";

export type CoachMessage = {
  role: "user" | "assistant";
  body: string;
};

export type CoachPriority = "nice_to_have" | "important" | "critical";

export type CoachDraft = {
  problem: string;
  solution: string;
  priority: CoachPriority;
  subject: string;
};

export type CoachResult = {
  ok: boolean;
  reply: string;
  readyToSubmit: boolean;
  draft: CoachDraft;
  mode: "llm" | "fallback";
  error?: string;
};

const PRIORITIES = new Set<CoachPriority>([
  "nice_to_have",
  "important",
  "critical",
]);

function buildSystemPrompt(brand: BrandConfig): string {
  const agent = brand.supportAgentName || "Support";
  const hint = brand.featureCoachSystemHint?.trim();
  return `You help users refine ${brand.name} feature requests before formal submission.
You are ${agent}. Be concise and friendly.
Output ONLY valid JSON (no markdown fences):
{
  "reply": "friendly chat message to the user (1-3 short paragraphs max)",
  "ready_to_submit": false,
  "draft": {
    "problem": "clear problem statement",
    "solution": "proposed solution or empty string",
    "priority": "nice_to_have|important|critical",
    "subject": "short title"
  }
}

Ask clarifying questions: who is affected, current workaround, expected outcome, priority.
Set ready_to_submit true only when the problem is specific enough for engineering review.
Keep draft fields updated as the conversation progresses.${hint ? `\n\nHost product guidance:\n${hint}` : ""}`;
}

function formatCoachThread(messages: CoachMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.body}`)
    .join("\n\n");
}

function normalizePriority(raw: unknown): CoachPriority {
  const v = String(raw ?? "");
  return PRIORITIES.has(v as CoachPriority) ? (v as CoachPriority) : "nice_to_have";
}

function parseLlmJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("Coach LLM returned non-JSON");
  }
}

function fallbackFromMessages(messages: CoachMessage[]): CoachResult {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => m.body.trim())
    .filter(Boolean);
  const problem = userTexts.join("\n\n") || "";
  const ready = userTexts.length >= 1;
  return {
    ok: true,
    mode: "fallback",
    reply: ready
      ? "Thanks — review the draft below and submit when it looks right, or add more detail."
      : "Describe the problem you want solved and any ideas you have — when you are ready, submit the request.",
    readyToSubmit: ready,
    draft: {
      problem,
      solution: "",
      priority: "nice_to_have",
      subject: problem.slice(0, 120),
    },
  };
}

/**
 * Multi-turn feature-request coach. Uses host LLM when configured;
 * otherwise returns a deterministic fallback so the UI can still collect a draft.
 */
export async function coachFeatureRequest(input: {
  messages: CoachMessage[];
  brand: BrandConfig;
  llm?: LlmAdapter;
  userContextSummary?: string;
}): Promise<CoachResult> {
  const messages = (input.messages ?? [])
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      body: String(m.body ?? "").trim().slice(0, 4000),
    }))
    .filter((m) => m.body.length > 0)
    .slice(-24);

  if (!input.llm) {
    return fallbackFromMessages(messages);
  }

  let system = buildSystemPrompt(input.brand);
  if (input.userContextSummary?.trim()) {
    system += `\n\nUser context (host-provided, treat as ground truth):\n${input.userContextSummary.trim().slice(0, 4000)}`;
  }

  try {
    const raw = await input.llm.complete({
      system,
      user: `Conversation so far:\n${formatCoachThread(messages) || "(empty)"}\n\nRespond as JSON.`,
      temperature: 0.3,
    });
    const parsed = parseLlmJson(raw);
    const draftObj =
      parsed.draft && typeof parsed.draft === "object"
        ? (parsed.draft as Record<string, unknown>)
        : {};
    const problem = String(draftObj.problem ?? "").slice(0, 4000);
    const solution = String(draftObj.solution ?? "").slice(0, 4000);
    const subject = String(draftObj.subject || problem || "Feature request").slice(
      0,
      200,
    );
    const reply = String(
      parsed.reply || "Tell me more about the problem you want to solve.",
    ).slice(0, 4000);

    return {
      ok: true,
      mode: "llm",
      reply,
      readyToSubmit: Boolean(parsed.ready_to_submit),
      draft: {
        problem,
        solution,
        priority: normalizePriority(draftObj.priority),
        subject,
      },
    };
  } catch (err) {
    const fb = fallbackFromMessages(messages);
    return {
      ...fb,
      ok: false,
      error: err instanceof Error ? err.message : "Coach unavailable",
      reply:
        "I couldn't reach the AI coach just now. You can still describe the problem and submit — or try again.",
    };
  }
}
