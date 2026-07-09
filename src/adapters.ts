import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentName = "claude" | "codex" | "gemini";

interface HookEntry {
  matcher?: string;
  hooks: { type: "command"; command: string; timeout?: number }[];
}

const CMD = (event: string, platform: string) => `npx rfc2119 hook ${event} --platform ${platform}`;

function shellHooks(platform: "claude" | "codex"): Record<string, HookEntry[]> {
  return {
    PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: CMD("after-edit", platform) }] }],
    Stop: [{ hooks: [{ type: "command", command: CMD("stop", platform) }] }],
    SessionStart: [{ hooks: [{ type: "command", command: CMD("session-start", platform) }] }],
  };
}

/** Gemini clones the contract but renames events and times out in milliseconds (REQ-004.2.3). */
function geminiHooks(): Record<string, HookEntry[]> {
  const t = 30000;
  return {
    AfterTool: [
      { matcher: "write_file|replace", hooks: [{ type: "command", command: CMD("after-edit", "gemini"), timeout: t }] },
    ],
    AfterAgent: [{ hooks: [{ type: "command", command: CMD("stop", "gemini"), timeout: t }] }],
    SessionStart: [{ hooks: [{ type: "command", command: CMD("session-start", "gemini"), timeout: t }] }],
  };
}

const AGENT_FILES: Record<AgentName, { path: string; hooks: () => Record<string, HookEntry[]>; note?: string }> = {
  claude: { path: ".claude/settings.json", hooks: () => shellHooks("claude") },
  codex: {
    path: ".codex/hooks.json",
    hooks: () => shellHooks("codex"),
    note: "Codex requires trusting new hooks once: run /hooks inside Codex and approve the 2119 entries.",
  },
  gemini: { path: ".gemini/settings.json", hooks: geminiHooks },
};

const REVIEWER_AGENT = `---
name: 2119-reviewer
description: Fresh-context judgment reviewer for 2119 reviews. Reads one or more instruction files from .2119/reviews/, judges whether tests genuinely verify their requirements (or whether [review]-tagged requirements are satisfied), and records verdicts with \`2119 pass\`/\`2119 fail\`. Use when dispatching 2119 judgment reviews; pass the instruction file path(s) in the prompt.
model: opus
tools: Read, Grep, Glob, Bash
---

You are a fresh-context 2119 judgment reviewer. You did not write the code
under review — that independence is the point of your existence.

**Process, for each instruction file you are given:**

1. Read the instruction file (a path under \`.2119/reviews/\`). It states one
   requirement, its evidence files, the review ID, and the verdict commands.
2. Perform the review exactly per its instructions. For test-quality reviews:
   read the evidence tests annotated with the requirement's ID and judge
   whether they would genuinely FAIL if the requirement were violated — flag
   tautological assertions, over-mocking that bypasses the behavior under
   test, assertions unrelated to the requirement's criterion, and keyword
   matching standing in for behavioral verification. For requirement reviews:
   read the evidence files and judge compliance directly.
3. Record your verdict with the exact command from the instruction file
   (\`npx rfc2119 pass|fail <review-id> --summary "..."\`). Summaries must be
   specific — what the test actually asserts or what the finding is — never
   generic. They are committed to the repository for human audit.

**Constraints:**

- Be a skeptical reviewer, not a rubber stamp: a fail verdict with a real
  finding is a success.
- But judge against the requirement's criterion, not perfection: supporting
  assertions in evidence files are fine, and a requirement is satisfied if
  its criterion is genuinely met even when adjacent improvements are
  imaginable.
- Do not edit any files. You are read-only apart from the verdict commands.
- Do not review anything beyond your assigned instruction files.
- Return one line per review: \`<review-id>: pass|fail — <summary>\`.
`;

/** Install the Claude Code reviewer subagent (REQ-004.2.7); never overwrite. */
function installReviewerAgent(root: string): boolean {
  const path = join(root, ".claude/agents/2119-reviewer.md");
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, REVIEWER_AGENT);
  return true;
}

/**
 * Merge 2119 hooks into an agent's settings file without touching unrelated
 * keys (REQ-004.2.4) and without duplicating entries on re-run (REQ-004.2.5).
 */
export function installAgentHooks(root: string, agent: AgentName): { path: string; changed: boolean; note?: string } {
  const spec = AGENT_FILES[agent];
  const path = join(root, spec.path);
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  }
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  let changed = false;
  for (const [event, entries] of Object.entries(spec.hooks())) {
    const existing = hooks[event] ?? [];
    const already = JSON.stringify(existing).includes("2119 hook");
    if (already) continue;
    hooks[event] = [...existing, ...entries];
    changed = true;
  }
  if (changed) {
    settings.hooks = hooks;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  }
  if (agent === "claude") {
    changed = installReviewerAgent(root) || changed;
  }
  return { path: spec.path, changed, note: spec.note };
}

const PRE_COMMIT_MARKER = "# 2119 pre-commit hook";
const PRE_COMMIT = `#!/bin/sh
${PRE_COMMIT_MARKER}
npx rfc2119 check || {
  echo ""
  echo "Commit blocked: 2119 check failed. Fix the issues or run 'npx rfc2119 review'."
  exit 1
}
`;

/** Install a git pre-commit hook, refusing to clobber someone else's (REQ-004.3.3). */
export function installGitHook(root: string): { path: string; changed: boolean; refused?: string } {
  const path = join(root, ".git/hooks/pre-commit");
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing.includes(PRE_COMMIT_MARKER)) return { path: ".git/hooks/pre-commit", changed: false };
    return {
      path: ".git/hooks/pre-commit",
      changed: false,
      refused: "A pre-commit hook not created by 2119 already exists; add `npx rfc2119 check` to it manually.",
    };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PRE_COMMIT);
  chmodSync(path, 0o755);
  return { path: ".git/hooks/pre-commit", changed: true };
}

const CI_WORKFLOW = `name: "2119"

on:
  pull_request:
  push:
    branches: [main, master]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx --yes rfc2119 check
`;

/** Write the CI backstop workflow (REQ-004.3.4). */
export function installCi(root: string): { path: string; changed: boolean } {
  const rel = ".github/workflows/2119.yml";
  const path = join(root, rel);
  if (existsSync(path)) return { path: rel, changed: false };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, CI_WORKFLOW);
  return { path: rel, changed: true };
}
