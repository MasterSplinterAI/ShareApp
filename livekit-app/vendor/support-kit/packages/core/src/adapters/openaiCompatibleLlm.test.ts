import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createOpenAiCompatibleLlm } from "./openaiCompatibleLlm.js";

describe("createOpenAiCompatibleLlm", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts chat/completions and returns message content", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"route":"reply_in_app"}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const llm = createOpenAiCompatibleLlm({
      baseUrl: "https://api.x.ai/v1/",
      model: "grok-4.6",
      apiKey: "test-key",
      maxTokens: 256,
    });
    const out = await llm.complete({
      system: "You are support.",
      user: "Hello",
      temperature: 0.1,
    });

    assert.equal(out, '{"route":"reply_in_app"}');
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, "https://api.x.ai/v1/chat/completions");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("authorization"), "Bearer test-key");
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.model, "grok-4.6");
    assert.deepEqual(body.messages, [
      { role: "system", content: "You are support." },
      { role: "user", content: "Hello" },
    ]);
    assert.equal(body.temperature, 0.1);
    assert.equal(body.max_tokens, 256);
  });

  it("omits Authorization when no apiKey (local OpenAI-compatible servers)", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), null);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const llm = createOpenAiCompatibleLlm({
      baseUrl: "http://127.0.0.1:30000/v1",
      model: "local",
    });
    assert.equal(await llm.complete({ system: "s", user: "u" }), "ok");
  });

  it("throws a status error on non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 401 })) as typeof fetch;
    const llm = createOpenAiCompatibleLlm({
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.6",
      apiKey: "bad",
    });
    await assert.rejects(
      () => llm.complete({ system: "s", user: "u" }),
      /HTTP 401/,
    );
  });
});
