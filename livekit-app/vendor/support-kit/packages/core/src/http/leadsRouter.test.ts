import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSupportRouter } from "../index.js";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";

function mockReq(method: string, url: string, body?: unknown) {
  return { method, url, body, headers: {} };
}

function mockRes() {
  let statusCode = 200;
  let jsonBody: unknown;
  return {
    status(n: number) {
      statusCode = n;
      return this;
    },
    json(b: unknown) {
      jsonBody = b;
      return { statusCode, body: jsonBody };
    },
    get result() {
      return { statusCode, body: jsonBody as Record<string, unknown> };
    },
  };
}

describe("public leads + gated chat", () => {
  it("creates lead and requires leadId for anonymous chat", async () => {
    const db = createMemorySqliteAdapter();
    const support = createSupportRouter({
      tenantId: "dev",
      db,
      brand: {
        name: "Demo",
        supportAgentName: "Help",
        agentAuthorId: "ai",
      },
      llm: {
        async complete() {
          return JSON.stringify({
            route: "reply_in_app",
            kind: "support",
            topic: "other",
            confidence: 0.8,
            draft_reply: "Public FAQ answer.",
            proposal_type: "reply",
          });
        },
      },
      resolveUser: () => null,
    });

    async function call(method: string, url: string, body?: unknown) {
      const res = mockRes();
      await support.handler(mockReq(method, url, body), res);
      return res.result;
    }

    const denied = await call("POST", "/chat", { message: "What is pricing?" });
    assert.equal(denied.statusCode, 401);

    const lead = await call("POST", "/leads", {
      name: "Pat",
      email: "pat@example.com",
      phone: "555-0100",
      marketingOptIn: true,
      consentText: "I agree to marketing",
    });
    assert.equal(lead.statusCode, 201);
    const leadId = String((lead.body as { leadId: string }).leadId);
    assert.ok(leadId);

    const chat = await call("POST", "/chat", {
      message: "What is pricing?",
      leadId,
    });
    assert.equal(chat.statusCode, 200);
    assert.match(String((chat.body as { reply?: string }).reply), /Public FAQ|Thanks/i);
  });
});
