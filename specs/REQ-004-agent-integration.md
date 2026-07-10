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
10. When a cached daily registry probe has found a newer rfc2119 version than the one running, `session-start` MUST include a one-line upgrade notice (naming the versions and `init --refresh`) in its additional context, so agents of users who never check for updates learn about them at session start.
11. The upgrade probe MUST NOT delay any hook by more than one second or affect its result: probes are cached (at most one per day, in a gitignored location), time-boxed, and silent on any network failure.

### REQ-004.2: Platform adapters

1. `2119 init --agent claude` MUST register the three hooks in `.claude/settings.json` (`PostToolUse` matching `Edit|Write`, `Stop`, and `SessionStart`).
2. `2119 init --agent codex` MUST register equivalent hooks in `.codex/hooks.json` and print that the user needs to trust them once via the `/hooks` command.
3. `2119 init --agent gemini` MUST register equivalent hooks in `.gemini/settings.json` (`AfterTool` matching `write_file|replace`, `AfterAgent`, `SessionStart`) with timeouts expressed in milliseconds.
4. Adapter installation MUST merge into existing settings files without removing or altering unrelated keys.
5. Adapter installation MUST be idempotent: running init twice produces no duplicate hook entries.
6. Native plugin packages for Pi and opencode MAY be provided as separate thin packages that shell out to the same CLI. [manual]
7. `2119 init --agent claude` MUST also install a `2119-reviewer` subagent definition at `.claude/agents/2119-reviewer.md` (a fresh-context, read-only reviewer that records verdicts), without overwriting an existing file at that path.
8. `2119 init --agent claude` MUST maintain the same marker-delimited workflow section in `CLAUDE.md` as in `AGENTS.md` (Claude Code reliably reads only `CLAUDE.md`), with identical idempotence and content rules.

### REQ-004.3: Universal fallback layer

1. `2119 init` MUST create a commented `.2119.yml` and a template spec when none exist.
2. `2119 init` MUST append a marker-delimited workflow section to `AGENTS.md` describing spec-first planning, draft-time spec critique (dispatch a fresh reviewer to critique new requirements — outcome-stated, individually testable, one obligation each — before writing tests), test annotations, judgment reviews, reviewer-model diversity (use models from different providers routinely or as periodic `review --audit` sweeps, especially for challenging or high-consequence requirements), and the `2119 check` gate, exactly once.
3. `2119 init --git-hook` MUST install a git pre-commit hook that runs `2119 check`, refusing to overwrite an existing pre-commit hook it did not create.
4. `2119 init --ci` MUST write a GitHub Actions workflow that runs `2119 check` on pull requests.
5. The AGENTS.md section MUST state that CI runs the same check, so agents on hookless platforms know the gate cannot be skipped.
6. The generated CI workflow MUST prepare the project and run its test suite as steps separate from the `2119 check` step — for npm repositories, installing dependencies and then running `npm test` so the workflow is executable on a clean runner, and otherwise a placeholder stating that 2119 does not run tests.
7. Generated hook, pre-commit, and CI commands MUST pin the exact rfc2119 package version that generated them, so the gate's behavior cannot drift with unreviewed upstream releases.
8. `2119 init` MUST create the template spec whenever the spec globs match no files, not merely when the specs directory is absent, so a repository with an empty `specs/` directory is repaired rather than silently accepted.
9. `2119 init --refresh` MUST update every 2119-generated artifact it can identify (marker-delimited sections, 2119-created hooks, the generated CI workflow, and their pinned versions) to the current package version, while never modifying content it did not generate.
10. `2119 init` MUST validate all arguments before writing anything, so an invalid invocation leaves the repository untouched.
11. The generated `.2119.yml` MUST include commented examples of every user-facing option, including `review_model`, `shared_evidence`, `comment_leaders`, and `audit`, so adopters discover options where they edit configuration.
12. Command guidance printed by `init` MUST use invocations that resolve without a global install (`npx rfc2119 ...`), matching how adopters actually invoked the tool.
