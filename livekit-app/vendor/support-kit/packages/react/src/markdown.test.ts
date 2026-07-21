import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSupportMarkdown } from "./markdown.js";

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
