# REQ-004: Agent Integration

## Overview

2119 must be adoptable by any coding agent, so enforcement is layered by
capability rather than tied to one platform. The floor is universal: an
AGENTS.md workflow section, an optional git pre-commit hook, and CI running
`2119 check`. On platforms with lifecycle hooks, `2119 init --agent <name>`
installs adapters that give in-session feedback (write-time lint injection)
and stop-time gating.

Claude Code's hook contract (JSON on stdin; `decision`, `reason`, and
`hookSpecificOutput.additionalContext` on stdout) is the canonical schema:
OpenAI Codex CLI and Gemini CLI implement near-identical contracts, so a
single normalized `2119 hook` subcommand serves all three with a small
per-platform denormalization table. Pi and opencode use in-process TypeScript
plugins and are planned as thin native packages.

## Requirements

### REQ-004.1: Normalized hook subcommand

1. The CLI MUST provide `2119 hook <event> --platform <name>` supporting the events `after-edit`, `stop`, and `session-start`, reading the platform's JSON payload from stdin.
2. Hook invocations MUST exit 0 and express all decisions through platform-appropriate JSON on stdout, since exit-code semantics differ across platforms.
3. `after-edit` MUST determine edited file paths inside the CLI (including parsing Codex `apply_patch` payloads) and ignore edits that match neither the spec globs nor the test globs.
4. When an edited spec file has lint violations, `after-edit` MUST inject them via the platform's additional-context mechanism so the agent fixes them immediately.
5. `stop` MUST run the full check and, on failure, emit the platform's block decision with a reason summarizing the failures and the commands to fix them.
6. `stop` MUST emit a non-blocking response when the payload's `stop_hook_active` flag is true, preventing infinite stop loops.
7. `session-start` MUST inject a short description of the 2119 workflow via the platform's additional-context mechanism.
8. A hook invoked in a repository where 2119 is not set up MUST emit a no-op response instead of an error, so user-level hook installs are safe.
9. Hook handler errors MUST be caught and reported inside the JSON response rather than crashing the process.

### REQ-004.2: Platform adapters

1. `2119 init --agent claude` MUST register the three hooks in `.claude/settings.json` (`PostToolUse` matching `Edit|Write`, `Stop`, and `SessionStart`).
2. `2119 init --agent codex` MUST register equivalent hooks in `.codex/hooks.json` and print that the user needs to trust them once via the `/hooks` command.
3. `2119 init --agent gemini` MUST register equivalent hooks in `.gemini/settings.json` (`AfterTool` matching `write_file|replace`, `AfterAgent`, `SessionStart`) with timeouts expressed in milliseconds.
4. Adapter installation MUST merge into existing settings files without removing or altering unrelated keys.
5. Adapter installation MUST be idempotent: running init twice produces no duplicate hook entries.
6. Native plugin packages for Pi and opencode MAY be provided as separate thin packages that shell out to the same CLI. [manual]

### REQ-004.3: Universal fallback layer

1. `2119 init` MUST create a commented `.2119.yml` and a template spec when none exist.
2. `2119 init` MUST append a marker-delimited workflow section to `AGENTS.md` describing spec-first planning, test annotations, judgment reviews, and the `2119 check` gate, exactly once.
3. `2119 init --git-hook` MUST install a git pre-commit hook that runs `2119 check`, refusing to overwrite an existing pre-commit hook it did not create.
4. `2119 init --ci` MUST write a GitHub Actions workflow that runs `2119 check` on pull requests.
5. The AGENTS.md section MUST state that CI runs the same check, so agents on hookless platforms know the gate cannot be skipped.
