import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSupportMarkdown, parseSupportMarkdownBlocks } from "./markdown.js";

describe("normalizeSupportMarkdown", () => {
  it("converts period-bullet lines to markdown dashes", () => {
    const out = normalizeSupportMarkdown(
      "I can help:\n. **Chat support** — docs\n. **Your account** — plan",
    );
    assert.match(out, /^- \*\*Chat support\*\*/m);
    assert.match(out, /^- \*\*Your account\*\*/m);
    assert.doesNotMatch(out, /^\. \*\*/m);
  });
});

describe("parseSupportMarkdownBlocks", () => {
  it("turns ATX headings into heading blocks without hash marks", () => {
    const blocks = parseSupportMarkdownBlocks(
      "# Meetings\n\nLalia provides hosted video meetings.\n\n## Creating a meeting (New meeting dialog)\n\n### Main guest link\n",
    );
    assert.deepEqual(
      blocks.filter((b) => b.type === "h"),
      [
        { type: "h", level: 1, text: "Meetings" },
        { type: "h", level: 2, text: "Creating a meeting (New meeting dialog)" },
        { type: "h", level: 3, text: "Main guest link" },
      ],
    );
    assert.equal(blocks[1]?.type, "p");
  });

  it("strips a closing hash run and leaves mid-sentence hashes as text", () => {
    const blocks = parseSupportMarkdownBlocks(
      "## **Title** ##\n\nUse the # channel name in a sentence.",
    );
    assert.deepEqual(blocks[0], { type: "h", level: 2, text: "**Title**" });
    assert.equal(blocks[1]?.type, "p");
    if (blocks[1]?.type === "p") {
      assert.match(blocks[1].text, /# channel/);
    }
  });

  it("keeps a heading separate from the following paragraph", () => {
    const blocks = parseSupportMarkdownBlocks(
      "# Meetings\nFrom **Meetings** click **New meeting**.",
    );
    assert.deepEqual(blocks[0], { type: "h", level: 1, text: "Meetings" });
    assert.equal(blocks[1]?.type, "p");
  });
});
