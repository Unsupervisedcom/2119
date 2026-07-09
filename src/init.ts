import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILENAME } from "./config.js";
import { installAgentHooks, installCi, installGitHook, type AgentName } from "./adapters.js";

const CONFIG_TEMPLATE = `# 2119 configuration — https://github.com/tylerwillis/2119
# All fields optional; these are the defaults.
#
# specs:
#   - "specs/**/*REQ-*.md"
# tests:
#   - "test/**"
#   - "tests/**"
#   - "**/*.test.*"
# prefix: "REQ"
# enforce: ["MUST", "MUST NOT", "SHALL", "SHALL NOT", "REQUIRED"]
# reviews: true
`;

const SPEC_TEMPLATE = `# REQ-001: <Feature Name>

## Overview

Describe the subsystem this spec governs: its purpose, scope, and boundaries.
Use imperatives sparingly (RFC 2119 §6): constrain observable outcomes, not
implementation methods. Elaborate security implications of security-relevant
requirements (RFC 2119 §7).

## Requirements

### REQ-001.1: <Section Title>

1. The system MUST <concrete, evaluable criterion>.
2. The system SHOULD <concrete, evaluable criterion>.
`;

export const AGENTS_MD_SECTION = `<!-- 2119:begin -->
## Requirements workflow (2119)

This repository enforces spec-driven testing with [2119](https://www.rfc-editor.org/rfc/rfc2119).

**When planning a feature**, write or update a spec in \`specs/\` first. Every
requirement is a numbered item under a \`### REQ-NNN.M\` heading with exactly one
RFC 2119 keyword. Run \`npx rfc2119 lint\` after editing specs.

**When implementing**, every MUST/SHALL requirement needs at least one test
annotated with a comment containing its ID, e.g. \`// 2119: REQ-001.2.3\`.
Write tests that would genuinely fail if the requirement were violated — a
fresh-context reviewer will judge each test's honesty, and tautological or
over-mocked tests will be rejected.

**Before finishing any task**, run \`npx rfc2119 check\`. It must exit 0. If it
reports pending judgment reviews, run \`npx rfc2119 review\` and dispatch each
instruction file in \`.2119/reviews/\` to a fresh-context subagent (never
review your own work in the same context). CI runs the same check, so skipping
it locally only defers the failure.
<!-- 2119:end -->
`;

export function runInit(root: string, args: string[]): void {
  const created: string[] = [];

  if (!existsSync(join(root, CONFIG_FILENAME))) {
    writeFileSync(join(root, CONFIG_FILENAME), CONFIG_TEMPLATE);
    created.push(CONFIG_FILENAME);
  }

  const specsDir = join(root, "specs");
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "REQ-001-example.md"), SPEC_TEMPLATE);
    created.push("specs/REQ-001-example.md");
  }

  // .2119/reviews is scratch (gitignored); .2119/verdicts is committed audit
  // history and must never be ignored (REQ-003.1.6, REQ-003.2.2).
  const gitignorePath = join(root, ".gitignore");
  const ignoreEntry = ".2119/reviews/";
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!existing.includes(ignoreEntry)) {
    appendFileSync(gitignorePath, `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${ignoreEntry}\n`);
    created.push(".gitignore (+ .2119/reviews/)");
  }

  const agentsPath = join(root, "AGENTS.md");
  const agentsExisting = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  if (!agentsExisting.includes("<!-- 2119:begin -->")) {
    appendFileSync(agentsPath, `${agentsExisting === "" ? "" : "\n"}${AGENTS_MD_SECTION}`);
    created.push("AGENTS.md (2119 section)");
  }

  const notes: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent") {
      const agent = args[i + 1] as AgentName | undefined;
      if (!agent || !["claude", "codex", "gemini"].includes(agent)) {
        console.error(`--agent must be one of: claude, codex, gemini (got "${agent ?? ""}")`);
        console.error("For Pi and opencode, see the native plugin packages in the README.");
        process.exit(2);
      }
      const result = installAgentHooks(root, agent);
      if (result.changed) created.push(`${result.path} (2119 hooks for ${agent})`);
      if (result.note) notes.push(result.note);
      i++;
    } else if (args[i] === "--git-hook") {
      const result = installGitHook(root);
      if (result.changed) created.push(result.path);
      if (result.refused) notes.push(result.refused);
    } else if (args[i] === "--ci") {
      const result = installCi(root);
      if (result.changed) created.push(result.path);
    }
  }

  if (created.length === 0) {
    console.log("init: already set up — nothing to do");
  } else {
    console.log("init: created/updated:");
    for (const c of created) console.log(`  - ${c}`);
  }
  for (const n of notes) console.log(`\nNote: ${n}`);
  console.log(
    "\nNext: write your first spec in specs/, then `npx rfc2119 check`.\n" +
      "Hook integration: `2119 init --agent claude|codex|gemini`; backstops:\n" +
      "`2119 init --git-hook --ci`. Everything else relies on AGENTS.md + CI.",
  );
}
