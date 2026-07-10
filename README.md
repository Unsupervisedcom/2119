# 2119

**Spec-driven test enforcement for coding agents.** Named for [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), the RFC that gave MUST and SHOULD their teeth.

2119 makes the planning → building → testing loop hard to cheat:

1. **Plans become requirements.** Features start as specs in `specs/` — RFC 2119 documents where every requirement is a numbered, individually addressable statement with exactly one normative keyword. `2119 lint` enforces the format.
2. **Requirements become tests.** Every MUST-level requirement needs at least one test annotated with its ID (`// 2119: REQ-001.2.3` — a comment, so it works in any language). `2119 cover` fails on any gap, in either direction.
3. **Tests get judged.** A coverage check can't tell a real test from a tautology. `2119 review` generates one instruction file per requirement asking a *fresh-context* reviewer a single question: **would these tests fail if this requirement were violated?** Verdicts are recorded with `2119 pass` / `2119 fail`.
4. **One gate.** `2119 check` = lint + coverage + verdict freshness. Exit code 0 or it isn't done. Hooks, git, and CI all call the same command.

This repo practices what it enforces: 2119's own requirements live in [`specs/`](specs/), every MUST has an annotated test, and `.2119/verdicts/` holds the committed review verdicts.

**What 2119 is not:** it is **not a test runner** (`check` never executes your suite — run `npm test && npx rfc2119 check`, both, always), **not a CI replacement** (it's one exit code your CI calls), and **not a security boundary** (a deliberate cheater is made *conspicuous*, not impossible). These boundaries are deliberate and [enforced as reviewed requirements](specs/REQ-008-honest-boundaries.md) — the reasoning lives in [docs/design.md](docs/design.md), and [docs/scaling.md](docs/scaling.md) covers hardening for larger or more formal projects.

## Use it in your repo

You don't clone this repo — npm delivers the tool. From your project root:

```bash
npx rfc2119 init                 # the core: specs/, .2119.yml, AGENTS.md section
npx rfc2119 init --agent claude  # + hooks and a reviewer subagent (also: codex, gemini)
npx rfc2119 init --git-hook --ci # + pre-commit gate and GitHub Actions backstop
```

What `init` creates in your repo:

| Path | What it is | Commit it? |
|------|-----------|------------|
| `specs/` | Your requirements docs (starts with a template) | Yes |
| `.2119.yml` | Config: globs, ID prefix, enforced severities, reviewer model | Yes |
| `AGENTS.md` section | Teaches any coding agent the workflow | Yes |
| `.2119/verdicts/` | Committed review verdicts, written as reviews run | Yes — they're the audit trail |
| `.2119/reviews/` | Scratch instruction files | No (init gitignores it) |
| `.claude/settings.json` + `.claude/agents/2119-reviewer.md` | Claude Code hooks + a fresh-context reviewer subagent (`--agent claude`) | Yes |
| `.github/workflows/2119.yml` | The CI backstop (`--ci`) | Yes |

Then the loop:

1. Have your agent plan each feature **as a spec** in `specs/` — `2119 lint` keeps the format honest.
2. Build. Every MUST-level requirement needs a test annotated with its ID (`// 2119: REQ-001.2.3`).
3. Run `npx rfc2119 check`. Fix lint/coverage failures directly; for pending judgment reviews, run `npx rfc2119 review --dispatch` — it emits a ready-to-paste prompt that sends each instruction file to a fresh-context subagent, in parallel.
4. Done means exit 0 — in your editor, at commit time, and in CI, all the same command.

## The spec format

```markdown
# REQ-001: Session Handling

## Overview

What this subsystem is and why.

## Requirements

### REQ-001.1: Timeouts

1. Sessions MUST expire after 30 minutes of inactivity.
2. Expired sessions MUST NOT be resumable with a stale token.
3. The docs SHOULD explain the timeout rationale. [review: docs/**]
4. Support MUST verify identity on the phone. [manual]
```

- IDs are `REQ-NNN.M.K` (file `.` section `.` item) and **stable forever** — removed requirements keep their number with the body `REQUIREMENT REMOVED`.
- Exactly one RFC 2119 keyword per statement (keywords inside `backticks` are quoted text, not counted), and — per RFC 8174 — only UPPERCASE keywords are normative; lowercase "must" is ordinary prose.
- The tool is accountable to the RFC it's named for: [docs/rfc-conformance.md](docs/rfc-conformance.md) maps every clause of RFC 2119 and RFC 8174 to how it's implemented, represented, or deliberately scoped out.

- `[review: globs]` marks a requirement verified by judgment review instead of a test; add `instructions: <path>` inside the tag when the criteria outgrow one sentence (the file's content is hashed into the verdict, so editing criteria invalidates prior approvals). `[manual]` exempts it (surfaced in every `check`, never silently skipped).
- `[verify: <command>]` validates a requirement with a shell command run from the repo root — exit 0 passes, anything else is a check violation carrying the output, 30s timeout. Verify commands execute arbitrary shell from spec files: they carry the same trust level as `package.json` scripts.
- Annotating a section ID (`// 2119: REQ-001.1`) covers all items in that section.

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in specs checked by this tool are to be interpreted as described in BCP 14 ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals. This citation lives here — project-level, once — rather than in every spec file, so it never costs agent context.

## How the anti-cheat works

The design splits enforcement by what each layer can actually guarantee:

- **Deterministic checks carry the weight.** Lint and coverage are exact parsing, not vibes. They run identically from an agent hook, your shell, and CI — an agent can't talk its way past an exit code in CI.
- **Judgment reviews close the tautology gap.** Review IDs embed a SHA-256 content hash of the requirement text plus the exact evidence blocks that cover it: each annotated test through the next annotation, plus the file's prelude (imports and mocks — the classic test-neutering vector — stay under the hash). Edit a covered test — or the requirement — and the old verdict silently stops counting; edit an *unrelated* test in the same file and it doesn't. `2119 pass` refuses IDs whose hash doesn't match current content, so verdicts can't be pre-computed or replayed.
- **Verdicts are committed, not hidden — and schema-validated.** `.2119/verdicts/*.json` files carry the verdict, summary, and timestamp, so every review decision shows up in the PR diff for humans to audit. The gate counts a verdict only as a fully well-formed record; a malformed file (mangled merge, missing field, wrong filename) is a loud check violation, never a silent pass.

### Residual risk, stated plainly

Nothing physically prevents the implementing agent from running `2119 pass` on its own work — no local tool can, since the agent controls the shell. The mitigations are layered: verdicts are **committed and auditable** (a self-pass with a hand-wavy summary is visible in review), **hash invalidation** means a verdict only ever vouches for exact content (no stale reuse), instruction files **direct dispatch to a fresh-context subagent**, and **CI re-runs the same check** so nothing merges without the full gate passing. If you need a hard guarantee, have CI or a bot re-dispatch the judgment reviews with an agent the author doesn't control.

## Agent integration

| Platform | Write-time lint feedback | Stop/finish gate | Install |
|----------|--------------------------|------------------|---------|
| Claude Code | PostToolUse → context injection | Stop hook (hard block) | `2119 init --agent claude` |
| Codex CLI | PostToolUse → context injection | Stop hook (hard block) | `2119 init --agent codex`, then trust via `/hooks` |
| Gemini CLI | AfterTool → context injection | AfterAgent (hard block) | `2119 init --agent gemini` |
| Pi / opencode | native TS plugins (planned) | commit block via universal layer | universal layer |
| Anything else | via AGENTS.md instructions | commit + CI (hard gate) | universal layer |

Codex and Gemini deliberately cloned Claude Code's hook contract (JSON on stdin; `decision` / `additionalContext` on stdout), so all three share one normalized entry point: `2119 hook <after-edit|stop|session-start> --platform <p>`. Hooks always exit 0 and speak JSON; a repo without 2119 set up gets a silent no-op, so user-level installs are safe.

### The universal layer (any agent, no integration required)

The enforcement itself is agent-agnostic by construction — lint, coverage, review hashing, and verdicts are a plain CLI with an exit code. Hooks only change *when* an agent hears about a failure, never *whether* the gate holds. Every `init` includes the universal layer:

- **AGENTS.md section** (always written): teaches any agent that reads it — Pi, opencode, Cursor, Hermes, whatever ships next — to spec first, annotate tests, dispatch reviews, and run `npx rfc2119 check` before finishing.
- **Git pre-commit hook** (`--git-hook`): blocks commits while `check` fails, regardless of which agent (or human) is committing.
- **CI** (`--ci`): re-runs the same `check` on every pull request — the backstop no agent can route around, integrated or not.

Same command, same verdicts, same gate everywhere; platforms with hooks just find out sooner.

## Choosing a reviewer model

Judgment reviews are scoped, single-question tasks, so we recommend **a capable but cost-effective model** — set it once via `review_model` in `.2119.yml` (the first interactive `2119 review` will ask; agents and CI never get prompted). The value is advisory text passed to whatever agent dispatches the reviews, so use your platform's own model names. Two things to calibrate:

- Don't go too small: round one of this repo's own reviews surfaced findings like masked assertions and a parser violating its own spec — subtle calls that weak models tend to rubber-stamp. On Claude Code, an Opus-class model is a solid choice.
- `[review]`-tagged requirements are the judgment-heavy ones; their instruction files deliberately recommend the dispatching agent's own (typically stronger) model instead of the pinned one.

## Choosing test vs. review vs. verify vs. manual

Deterministic facts get tests. Judgment calls get `[review]`. Things only a human can do get `[manual]`. The anti-patterns to avoid (borrowed from [DeepWork](https://github.com/Unsupervisedcom/deepwork)'s requirements-validation doctrine, which inspired this tool):

- **A keyword-grep test pretending to verify judgment** (`assert "parallel" in text` for "MUST run in parallel") — that's a test that can't fail honestly. Use `[review]`.
- **A review wasted on a machine-checkable fact** ("check the version field equals 2") — that's judgment spent where a test is stronger. Write the test.

## Commands

| Command | Does |
|---------|------|
| `2119 init [--agent <p>] [--git-hook] [--ci]` | Scaffold and install integrations |
| `2119 lint` | Spec format checks |
| `2119 cover` | Requirement ↔ test traceability |
| `2119 review [--dispatch]` | Generate instruction files for stale/missing judgment reviews; `--dispatch` adds a ready-to-paste parallel-subagent prompt |
| `2119 pass/fail <review-id> --summary "…"` | Record a verdict (hash-verified) |
| `2119 check [--json] [--no-verify]` | Everything; the one exit code that matters (`--no-verify` skips `[verify]` shell for untrusted-PR CI) |
| `2119 prune` | Delete verdicts orphaned by content changes (explicit, so deletions show in your diff) |
| `2119 hook <event> --platform <p>` | Agent hook entry point (used by installed hooks) |

## Configuration (`.2119.yml`, all optional)

```yaml
specs: ["specs/**/*REQ-*.md"]
tests: ["tests/**", "**/*.test.*"]
prefix: "REQ"          # e.g. "ACME-REQ" for ACME-REQ-001 IDs
enforce: ["MUST", "MUST NOT", "SHALL", "SHALL NOT", "REQUIRED"]
reviews: true          # set false to disable the judgment layer
review_model: "opus"   # advisory, platform-specific; default recommends
                       # "a capable, cost-effective model"
shared_evidence: []    # globs of shared fixtures/helpers hashed into every
                       # test-quality review (see docs/scaling.md)
```

## What's in this repo

Nothing here needs to be copied into your project — `init` generates everything an adopter needs. The layout, for the curious and for contributors:

| Path | Role |
|------|------|
| `src/` | The tool: spec parser/lint, coverage, review hashing, verdicts, hooks, adapters |
| `tests/` | The tool's own suite — every test annotated with the requirement it covers |
| `specs/` | 2119's own requirements, written in the format it enforces (the best live example) |
| `.2119/verdicts/` | Real committed verdicts from the fresh-context reviews that gated this code |
| `.2119.yml` · `AGENTS.md` · `.claude/agents/` | This repo dogfooding its own `init` output |
| `docs/rfc-conformance.md` | Clause-by-clause accounting against RFC 2119 and RFC 8174 |
| `docs/design.md` · `docs/scaling.md` | Design decisions & non-goals; hardening for formal projects |

## Cost and scale

Rough numbers, so you can budget before adopting:

- **The deterministic gate is free.** Lint, coverage, and hash checks are parsing — ~0.2s on this repo, plausibly ~1–2s at 1M LOC. No tokens involved.
- **Judgment reviews are the only real cost, and steady state tracks your change rate, not your repo size.** A verdict re-runs only when its requirement or its evidence blocks change, so a typical PR touching a handful of annotated tests costs on the order of **$0.25–$1** in reviewer tokens (measured here: ~$0.05 per review on an Opus-class model). Block-level hashing is what keeps this bounded — editing one test doesn't re-review its neighbors.
- **The dominant cost of adopting on an established codebase isn't reviews — it's authoring.** Retroactively speccing 1M LOC means writing thousands of requirements and honestly-falsifiable tests. Don't. Adopt incrementally: run `init`, spec new features and the subsystems you're actively changing, and let coverage grow along the change frontier. A full retroactive review pass, if you ever want one, is only ~$0.05–0.10 per requirement dispatched in parallel.
- **Very large monorepos (tens of thousands of test files):** the repo walk becomes `check`'s bottleneck (~10s+ at 10M LOC), which you'd feel in write-time hooks. The planned fix — `git ls-files` enumeration plus a content-keyed annotation cache — preserves whole-repo semantics; see the note in [`specs/REQ-002-deterministic-checks.md`](specs/REQ-002-deterministic-checks.md) for why a `--changed` flag is deliberately *not* the answer.
