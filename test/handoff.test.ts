import { describe, expect, it } from "vitest";
import {
  buildContinuePrompt,
  buildWriterHandoffPrompt,
  extractHandoffDocument,
  extractTitleFromDocument,
  stampHandoffDocument,
  stripAttributionLines,
} from "../server/handoff";

describe("extractTitleFromDocument", () => {
  it("prefers the explicit Title line", () => {
    const doc = "Title: Fix flaky login test\n\n# Task\nInvestigate why the login spec fails intermittently on CI.\n";
    expect(extractTitleFromDocument(doc, "untitled task")).toBe("Fix flaky login test");
  });

  it("falls back to the first line of the Task section", () => {
    expect(extractTitleFromDocument("# Task\nAdd retries\n# Context\nx\n", "untitled task")).toBe("Add retries");
  });
});

describe("stampHandoffDocument", () => {
  const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
  const STAMP = "Created: 2026-10-19T12:00:00.000Z";

  it("puts the timestamp right under the Title line", () => {
    expect(stampHandoffDocument("Title: Fix login\n\n# Task\nx\n", NOW)).toBe(`Title: Fix login\n${STAMP}\n\n# Task\nx\n`);
  });

  it("puts the timestamp at the top when there is no Title line", () => {
    expect(stampHandoffDocument("# Task\nx\n", NOW)).toBe(`${STAMP}\n# Task\nx\n`);
  });

  it("replaces a Created line the writer added but leaves body text alone", () => {
    const doc = "Title: Fix login\nCreated: yesterday\n\n# Task\nCreated: a new endpoint\n";
    expect(stampHandoffDocument(doc, NOW)).toBe(`Title: Fix login\n${STAMP}\n\n# Task\nCreated: a new endpoint\n`);
  });
});

describe("stripAttributionLines", () => {
  it("drops commit trailers and Generated-with lines", () => {
    const text = [
      "- Keep the diff small",
      "- Commit trailers: `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` on commits",
      "Co-authored-by: Someone Else <someone@example.com>",
      "- PR bodies: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`",
      "- Run the tests first",
    ].join("\n");
    expect(stripAttributionLines(text)).toBe("- Keep the diff small\n- Run the tests first");
  });

  it("drops trailers without an email and Unicode look-alikes", () => {
    const text = ["Co-Authored-By: Claude Haiku 5.5", "Co\u2011authored by: Someone", "Co-Authored-By\uFF1A Someone", "Generated with Claude Code", "kept"].join("\n");
    expect(stripAttributionLines(text)).toBe("kept");
  });

  it("drops bold, escaped, spaced, table and assisted-by forms", () => {
    const text = [
      "- **Co-Authored-By**: Claude Haiku 5.5 <noreply@anthropic.com>",
      "Co Authored-By: Claude Haiku 5.5",
      "Co\\-Authored\\-By: Claude Haiku 5.5",
      "| Co-Authored-By | Claude Haiku 5.5 |",
      "Assisted-by: Claude Haiku 5.5",
      "kept",
    ].join("\n");
    expect(stripAttributionLines(text)).toBe("kept");
  });

  it("takes the value line of a trailer label that has none, but not the next table row", () => {
    expect(stripAttributionLines("Co-Authored-By:\nClaude Haiku 5.5 <x@y.z>\nkept")).toBe("kept");
    expect(stripAttributionLines("| Co-Authored-By | Claude |\n| Other | row |")).toBe("| Other | row |");
  });

  it("keeps transcript lines of the fallback draft, such as pasted git log output", () => {
    const text = "> user: please keep going. git log shows Co-authored-by: Alice <alice@example.com> on abc123, fix the rest\n> assistant: ok";
    expect(stripAttributionLines(text)).toBe(text);
  });

  it("does not take a heading, list item or table row after a bare label", () => {
    expect(stripAttributionLines("Co-Authored-By:\n# Next section\nkept")).toBe("# Next section\nkept");
    expect(stripAttributionLines("Co-Authored-By:\n- keep this item")).toBe("- keep this item");
  });

  it("stays fast on a long line of repeated decoration", () => {
    const started = Date.now();
    stripAttributionLines(`${"* ".repeat(20_000)}x`);
    stripAttributionLines(`${"co authored ".repeat(5_000)}`);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("keeps a constraint that only talks about trailers", () => {
    const text = "- Commits must not carry Co-Authored-By: lines; use the session's own\n- Title: Strip Co-authored-by: trailers";
    expect(stripAttributionLines(text)).toBe(text);
  });

  it("keeps prose that only mentions the words", () => {
    const text = "The draft PR text lists Co-Authored-By lines for two models.\nGenerated with care.";
    expect(stripAttributionLines(text)).toBe(text);
  });
});

describe("extractHandoffDocument", () => {
  it("strips attribution from the writer's reply", () => {
    const reply = "```markdown\n# Task\nShip it\n\n# Constraints\nCo-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>\nKeep it small\n```";
    expect(extractHandoffDocument([{ type: "assistant_message", text: reply }])).toBe(
      "# Task\nShip it\n\n# Constraints\nKeep it small\n",
    );
  });

  it("returns null when the reply is not a handoff", () => {
    expect(extractHandoffDocument([{ type: "assistant_message", text: "Sorry, no." }])).toBeNull();
  });
});

describe("buildWriterHandoffPrompt", () => {
  const prompt = buildWriterHandoffPrompt("DRAFT BODY");

  it("forbids invented attribution and facts", () => {
    expect(prompt).toContain("Never add facts of your own");
    expect(prompt).toContain("no commit trailers");
    expect(prompt).toContain("Copy the Provider, Agent and Working directory values from the draft");
  });

  it("asks for draft-derived state to be marked as of the Generated time and unverified", () => {
    expect(prompt).toContain("As of <the Generated time>, unverified:");
    expect(prompt).toContain("Verify before acting:");
  });

  it("puts the draft last", () => {
    expect(prompt.endsWith("## Machine draft\n\nDRAFT BODY")).toBe(true);
  });
});

describe("buildContinuePrompt", () => {
  it("tells the new session to check state before acting and not to copy attribution", () => {
    const prompt = buildContinuePrompt("/work/.paseo/handoffs/a.md", "# Task\nx\n");
    expect(prompt).toContain("check the real state");
    expect(prompt).toContain("Do not copy commit trailers or other attribution");
    expect(prompt.endsWith("Continue the task it describes.")).toBe(true);
  });
});
