/** Set before a continue prompt's handoff text. Drafts leave the text out, since the file is read on its own. */
export const CONTINUE_BODY_MARK = "<handoff>\n";
/** The opening words of a continue prompt, before the handoff path. Timeline reading matches them to find the file. */
export const CONTINUE_LEAD = "This session continues the handoff saved at";

/**
 * The first message of a session started from a handoff. The text is inline, because a long file can come back
 * from a read cut short, which made a fresh session see an empty handoff. The first sentence names the file.
 */
export function buildContinuePrompt(handoffPath: string, text: string): string {
  return [
    `${CONTINUE_LEAD} ${handoffPath}. Its full text is below, so there is no need to read the file.`,
    `${CONTINUE_BODY_MARK}${text.trimEnd()}`,
    "</handoff>",
    "",
    "The handoff is a snapshot from when it was written (see its Created or Generated line), and whoever wrote it could not check it. Before acting on anything it says about current state, such as tab names, branches, running jobs, blockers or who is waiting for what, check the real state. Do not copy commit trailers or other attribution from it; your own session instructions say what to use.",
    "",
    "Continue the task it describes.",
  ].join("\n\n");
}

export function buildWriterHandoffPrompt(draft: string): string {
  return [
    "Write a handoff document so a fresh agent can continue the task described below without asking the original agent anything.",
    "",
    "Reply with only the markdown document, no preamble and no code fence. Do not use any tools, read or modify any files, or start new work. Start with a single line `Title: <3 to 8 word summary of the work>`, a short label the user can scan later to remember what this was about. Then use exactly these headings:",
    "",
    "# Task",
    "# Context",
    "# Relevant files",
    "# Current state",
    "# What was tried",
    "# Decisions",
    "# Acceptance criteria",
    "# Constraints",
    "",
    "Say only what the machine draft carries. Never add facts of your own: no model names or versions (not even your own), no commit trailers, `Co-Authored-By` or `Generated with` lines, and no other attribution, because the next agent's own session supplies those. Copy the Provider, Agent and Working directory values from the draft's first `# Context` section exactly (a quoted previous handoff has its own, which are not this session's); if the draft truly lacks one, say it is not in the draft.",
    "",
    "You cannot check anything, so everything the draft says about current state is a snapshot from the `Generated` time in its first Context section and may be out of date: tab or agent names, earlier messages, what was blocked, what passed or merged, who was waiting. In `# Current state`, open with `As of <the Generated time>, unverified:` and write each state claim as it was then, never as a present fact. End `# Current state` with a `Verify before acting:` line that lists what the next agent must check first.",
    "",
    "Fill every section from the machine draft below, correcting and expanding it with real detail. Be concrete: name the files changed, what works, what is broken, and the single next step. The draft has the first request, every user message (long ones may be cut), the end of the conversation and the repo state. Where it says earlier messages were omitted, say what is unknown rather than inventing details. If the draft includes the agent's latest task list or plan, use them for the current state and the single next step. If the draft includes a previous handoff, this session continued it: carry forward its plans and decisions that still apply, but treat its state as older than the Generated time and unverified.",
    "",
    "## Machine draft",
    "",
    draft,
  ].join("\n");
}

/** True when the text looks like a handoff document, meaning it has a Task heading. */
export function isHandoffDocument(text: string): boolean {
  return /^#\s*Task\s*$/im.test(text);
}

/**
 * Commit trailers and "Generated with" lines are the next session's to choose, and a writer that cannot see that
 * session invents them (one stamped its own model as the trailer to use). Dropped from the writer's reply whole.
 */
const ATTRIBUTION_LINE_PATTERNS = [/co-?authored[\s-]*by\s*:\s*\S/i, /generated with \[[^\]\n]{1,200}\]/i, /generated (?:with|by) claude code/i];

export function stripAttributionLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      // NFKC folds fullwidth colons and similar; the hyphen class folds Unicode hyphens.
      const folded = line.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-");
      return !ATTRIBUTION_LINE_PATTERNS.some((pattern) => pattern.test(folded));
    })
    .join("\n");
}

/** Returns the writer's reply as a handoff document, or null if it does not look like one. */
export function extractHandoffDocument(timeline: ReadonlyArray<{ type: string; text?: string }>): string | null {
  const text = stripAttributionLines(
    timeline
      .filter((item) => item.type === "assistant_message" && typeof item.text === "string")
      .map((item) => item.text)
      .join("")
      .trim()
      .replace(/^```(?:markdown|md)?\s*\n/i, "")
      .replace(/\n```\s*$/, ""),
  ).trim();
  return isHandoffDocument(text) ? `${text}\n` : null;
}

export function extractTitleFromDocument(text: string, fallback: string): string {
  const lines = text.split(/\r?\n/);
  const explicit = text.match(/^\s*Title:[ \t]*([^\r\n]+)/i)?.[1]?.trim();
  if (explicit) return explicit.slice(0, 80);
  let raw: string | null = null;
  let inTask = false;
  for (const line of lines) {
    if (/^#\s*Task\s*$/i.test(line)) {
      inTask = true;
      continue;
    }
    if (!inTask) continue;
    if (/^#\s/.test(line)) break;
    if (line.trim()) {
      raw = line.trim();
      break;
    }
  }
  if (!raw) {
    const firstHeading = text.match(/^#\s+(.+)$/m);
    raw = firstHeading?.[1]?.trim() ?? null;
  }
  if (!raw) {
    raw = lines.map((line) => line.trim()).find((line) => line.length > 0) ?? fallback;
  }
  const cleaned = (raw ?? fallback).replace(/^#+\s*/, "").trim();
  return cleaned.slice(0, 80) || fallback;
}

/** Adds a `Created:` line below the title line (or at the top when there is none), replacing any the writer added. */
export function stampHandoffDocument(document: string, now: number): string {
  const stamp = `Created: ${new Date(now).toISOString()}`;
  const headingIndex = document.split("\n").findIndex((line) => /^#/.test(line));
  const lines = document
    .split("\n")
    .filter((line, index) => !(/^\s*Created:/i.test(line) && (headingIndex < 0 || index < headingIndex)));
  const titleIndex = lines.findIndex((line) => /^\s*Title:/i.test(line));
  lines.splice(titleIndex + 1, 0, stamp);
  return lines.join("\n");
}
