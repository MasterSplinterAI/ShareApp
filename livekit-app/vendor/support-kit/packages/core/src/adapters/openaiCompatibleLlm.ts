import type { LlmAdapter } from "./types.js";

export interface OpenAiCompatibleLlmOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Default 800. */
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * OpenAI-compatible chat/completions adapter (xAI Grok, OpenAI, local sglang, …).
 * Hosts pass baseUrl + model + optional apiKey. No secrets are stored here.
 */
export function createOpenAiCompatibleLlm(options: OpenAiCompatibleLlmOptions): LlmAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const model = options.model;
  const maxTokens = options.maxTokens ?? 800;
  const timeoutMs = options.timeoutMs ?? 45_000;

  return {
    async complete({ system, user, temperature }) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: temperature ?? 0.2,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `LLM request failed: HTTP ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`,
        );
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("LLM request failed: empty completion");
      }
      return content;
    },
  };
}
