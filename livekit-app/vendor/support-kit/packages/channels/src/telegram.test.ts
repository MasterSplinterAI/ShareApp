import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTelegramOpsNotifier,
  formatTelegramOpsMessage,
  buildProposalKeyboard,
  formatProposalReadyMessage,
} from "./telegram.js";

describe("formatTelegramOpsMessage", () => {
  it("formats title, body, admin link, and ticket number", () => {
    const text = formatTelegramOpsMessage({
      kind: "ticket_created",
      title: "New ticket",
      body: "User cannot log in",
      adminUrl: "https://app.example/admin?ticket=42",
      ticketPublicNumber: 42,
    });

    assert.match(text, /New ticket/);
    assert.match(text, /ticket #42/);
    assert.match(text, /User cannot log in/);
    assert.match(text, /Open in admin/);
    assert.match(text, /https:\/\/app\.example\/admin\?ticket=42/);
  });

  it("escapes HTML in user content", () => {
    const text = formatTelegramOpsMessage({
      kind: "proposal_ready",
      title: "AI <proposal>",
      body: "Draft & reply",
    });

    assert.match(text, /AI &lt;proposal&gt;/);
    assert.match(text, /Draft &amp; reply/);
  });
});

describe("buildProposalKeyboard", () => {
  it("includes Claim for unclaimed reply proposals", () => {
    const kb = buildProposalKeyboard({ id: "p1", proposalType: "reply" });
    const flat = (kb.inline_keyboard ?? []).flat();
    assert.ok(flat.some((b) => b.callback_data === "prop:p1:claim"));
    assert.ok(flat.some((b) => b.callback_data === "prop:p1:send_reply"));
  });

  it("swaps to Steal/Release when claimed", () => {
    const kb = buildProposalKeyboard(
      { id: "p1", proposalType: "bug_fix", claimedBy: "@Alex" },
      { claimedBy: "@Alex" },
    );
    const flat = (kb.inline_keyboard ?? []).flat();
    assert.ok(flat.some((b) => b.callback_data === "prop:p1:steal"));
    assert.ok(flat.some((b) => b.callback_data === "prop:p1:approve"));
  });
});

describe("formatProposalReadyMessage", () => {
  it("shows claim label", () => {
    const text = formatProposalReadyMessage({
      ticketPublicNumber: 7,
      proposal: {
        id: "p1",
        proposalType: "reply",
        summary: "Help export",
        bodyJson: JSON.stringify({ draft_reply: "Click Export" }),
        confidence: 0.8,
      },
      claimLabel: "Claimed by @Alex",
    });
    assert.match(text, /Claimed by @Alex/);
    assert.match(text, /ticket #7/);
  });
});

describe("createTelegramOpsNotifier", () => {
  it("calls Telegram sendMessage with mocked fetch", async () => {
    const calls: {
      url: string;
      init?: { method?: string; headers?: Record<string, string>; body?: string };
    }[] = [];
    const fetchImpl: import("./telegram.js").TelegramFetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: { message_id: 99 } }),
      };
    };

    const notifier = createTelegramOpsNotifier({
      botToken: "TOKEN",
      chatId: "-1001",
      fetchImpl,
    });

    await notifier.sendToOps({
      kind: "escalation",
      title: "Escalate",
      body: "Need human",
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /botTOKEN\/sendMessage/);
    const payload = JSON.parse(calls[0]!.init!.body!) as { chat_id: string; text: string };
    assert.equal(payload.chat_id, "-1001");
    assert.match(payload.text, /Escalate/);
  });

  it("notifyProposalReady includes inline keyboard and returns messageId", async () => {
    const fetchImpl: import("./telegram.js").TelegramFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { message_id: 42 } }),
    });
    const notifier = createTelegramOpsNotifier({
      botToken: "TOKEN",
      chatId: "-1001",
      fetchImpl,
    });
    const result = await notifier.notifyProposalReady({
      ticketPublicNumber: 3,
      proposal: {
        id: "abc",
        proposalType: "reply",
        summary: "Sum",
        bodyJson: JSON.stringify({ draft_reply: "Hi" }),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.messageId, "42");
    assert.equal(result.chatId, "-1001");
  });
});
