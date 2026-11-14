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
