import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coachFeatureRequest } from "./featureCoach.js";

describe("coachFeatureRequest", () => {
  it("falls back without llm after a user message", async () => {
    const result = await coachFeatureRequest({
      brand: { name: "Demo", supportAgentName: "Helper", agentAuthorId: "ai" },
      messages: [{ role: "user", body: "I need bulk export" }],
    });
    assert.equal(result.mode, "fallback");
    assert.equal(result.readyToSubmit, true);
    assert.match(result.draft.problem, /bulk export/i);
  });

  it("uses llm JSON when configured", async () => {
    const result = await coachFeatureRequest({
      brand: {
        name: "Demo",
        supportAgentName: "Helper",
        agentAuthorId: "ai",
        featureCoachSystemHint: "Focus on studio workflows.",
      },
      messages: [
        { role: "user", body: "Need calendar sync" },
        { role: "assistant", body: "Who is affected?" },
        { role: "user", body: "All org admins; Google Calendar" },
      ],
      llm: {
        async complete() {
          return JSON.stringify({
            reply: "Got it — ready to submit?",
            ready_to_submit: true,
            draft: {
              problem: "Org admins need Google Calendar sync",
              solution: "Two-way sync for meetings",
              priority: "important",
              subject: "Google Calendar sync",
            },
          });
        },
      },
    });
    assert.equal(result.mode, "llm");
    assert.equal(result.ok, true);
    assert.equal(result.readyToSubmit, true);
    assert.equal(result.draft.subject, "Google Calendar sync");
    assert.equal(result.draft.priority, "important");
  });

  it("degrades to fallback when llm throws", async () => {
    const result = await coachFeatureRequest({
      brand: { name: "Demo", supportAgentName: "Helper", agentAuthorId: "ai" },
      messages: [{ role: "user", body: "Dark mode" }],
      llm: {
        async complete() {
          throw new Error("boom");
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.mode, "fallback");
    assert.ok(result.error);
    assert.match(result.draft.problem, /Dark mode/);
  });
});
