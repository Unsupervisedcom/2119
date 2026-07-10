import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILENAME, loadConfig } from "./config.js";
import { walk, matchGlobs } from "./files.js";
import {
  installAgentHooks,
  installCi,
  installGitHook,
  refreshPinnedArtifacts,
  type AgentName,
} from "./adapters.js";

const CONFIG_TEMPLATE = `# 2119 configuration — https://github.com/tylerwillis/2119
# All fields optional; these are the defaults unless noted.
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
#
# Recommended reviewer model(s) for test-quality judgment reviews. Advisory,
# platform-specific strings your agent resolves; a list means every model
# reviews and all must pass (cross-provider diversity catches what one
# model family rubber-stamps):
# review_model: "opus"
# review_model: ["opus", "gpt-5.6-sol"]
#
# Shared fixtures/helpers hashed into every test-quality review, so they
# can't change (or be neutered) without invalidating dependent verdicts:
# shared_evidence:
#   - "tests/helpers/**"
#
# Extra comment leaders for annotation lines, beyond the defaults
# (//, #, *, /*, --, ;, %, <!--):
# comment_leaders: ['"']
#
# Generate adversarial audits of passing verdicts on every \`review\` run
# (default: only under \`review --audit\`):
# audit: "always"
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
RFC 2119 keyword, stating an observable outcome — not an implementation
mechanism. Run \`npx rfc2119 lint\` after editing specs. **Before writing tests
against a new spec**, dispatch a fresh-context reviewer to critique the draft
requirements themselves: outcome-stated, individually testable, one obligation
each. A flawed requirement steers the whole implementation wrong.

**When implementing**, every MUST/SHALL requirement needs at least one test
annotated with a comment containing its ID, e.g. \`// 2119: REQ-001.2.3\` (the
marker line must start with a comment leader). Write tests that would genuinely
fail if the requirement were violated — including its negative space: what the
requirement forbids needs a rejection test, not just what it allows. A
fresh-context reviewer judges each test's honesty; tautological or over-mocked
tests will be rejected.

**Reviewer diversity**: use reviewer models from different providers, routinely
or as periodic \`npx rfc2119 review --audit\` sweeps — adversarial audits of
passing verdicts. Audit especially the challenging or high-consequence
requirements; a single model family shares blind spots.

**Before finishing any task**, run \`npx rfc2119 check\`. It must exit 0. If it
reports pending judgment reviews, run \`npx rfc2119 review --dispatch\` and
dispatch each instruction file in \`.2119/reviews/\` to a fresh-context subagent
(never review your own work in the same context). CI runs the same check, so
skipping it locally only defers the failure.
<!-- 2119:end -->
`;

/** Append or replace the marker-delimited 2119 section in a markdown file. */
function upsertSection(path: string, refresh: boolean): "created" | "refreshed" | null {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!existing.includes("<!-- 2119:begin -->")) {
    appendFileSync(path, `${existing === "" ? "" : "\n"}${AGENTS_MD_SECTION}`);
    return "created";
  }
  if (refresh) {
    const updated = existing.replace(/<!-- 2119:begin -->[\s\S]*?<!-- 2119:end -->\n?/, AGENTS_MD_SECTION);
    if (updated !== existing) {
      writeFileSync(path, updated);
      return "refreshed";
    }
  }
  return null;
}

export function runInit(root: string, args: string[]): void {
  // Validate everything before any write: an invalid invocation must leave
  // the repository untouched (REQ-004.3.10).
  const agents: AgentName[] = [];
  let gitHook = false;
  let ci = false;
  let refresh = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent") {
      const agent = args[i + 1];
      if (!agent || !["claude", "codex", "gemini"].includes(agent)) {
        console.error(`--agent must be one of: claude, codex, gemini (got "${agent ?? ""}")`);
        console.error("For Pi and opencode, see the native plugin packages in the README.");
        process.exit(2);
      }
      agents.push(agent as AgentName);
      i++;
    } else if (args[i] === "--git-hook") gitHook = true;
    else if (args[i] === "--ci") ci = true;
    else if (args[i] === "--refresh") refresh = true;
    else {
      console.error(`init: unknown argument "${args[i]}"`);
      console.error("usage: 2119 init [--agent claude|codex|gemini] [--git-hook] [--ci] [--refresh]");
      process.exit(2);
    }
  }

  const created: string[] = [];
  const notes: string[] = [];

  if (!existsSync(join(root, CONFIG_FILENAME))) {
    writeFileSync(join(root, CONFIG_FILENAME), CONFIG_TEMPLATE);
    created.push(CONFIG_FILENAME);
  }

  // Repair by glob match, not directory existence: an empty specs/ dir gets
  // the template too (REQ-004.3.8).
  const config = loadConfig(root);
  const hasSpecs = matchGlobs(walk(root), config.specs).length > 0;
  if (!hasSpecs) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs/REQ-001-example.md"), SPEC_TEMPLATE);
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

  const agentsResult = upsertSection(join(root, "AGENTS.md"), refresh);
  if (agentsResult) created.push(`AGENTS.md (2119 section ${agentsResult})`);

  for (const agent of agents) {
    const result = installAgentHooks(root, agent, { refresh });
    if (result.changed) created.push(`${result.path} (2119 hooks for ${agent})`);
    if (result.note) notes.push(result.note);
    // Claude Code reliably reads only CLAUDE.md, so it gets the same
    // marker-delimited section as AGENTS.md (REQ-004.2.8).
    if (agent === "claude") {
      const claudeResult = upsertSection(join(root, "CLAUDE.md"), refresh);
      if (claudeResult) created.push(`CLAUDE.md (2119 section ${claudeResult})`);
    }
  }

  if (gitHook) {
    const result = installGitHook(root, { refresh });
    if (result.changed) created.push(result.path);
    if (result.refused) notes.push(result.refused);
  }
  if (ci) {
    const result = installCi(root, { refresh });
    if (result.changed) created.push(result.path);
  }

  if (refresh) {
    for (const path of refreshPinnedArtifacts(root)) created.push(`${path} (re-pinned)`);
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
      "Hook integration: `npx rfc2119 init --agent claude|codex|gemini`; backstops:\n" +
      "`npx rfc2119 init --git-hook --ci`. After upgrading the package, run\n" +
      "`npx rfc2119 init --refresh` to re-pin generated hooks and CI.",
  );
}
