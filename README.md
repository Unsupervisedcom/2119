# 2119

**Spec-driven test enforcement for coding agents.** Named for [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

2119 makes the planning → building → testing loop hard to cheat:

1. **Plans become requirements.** Features start as specs in `specs/` — RFC 2119 documents where every requirement is a numbered, individually addressable statement with exactly one normative keyword. `2119 lint` enforces the format.
2. **Requirements become tests.** Every MUST-level requirement needs at least one test annotated with its ID (`// 2119: REQ-001.2.3` — a comment, so it works in any language). `2119 cover` fails on any gap, in either direction.
3. **Tests get judged.** `2119 review` generates one instruction file per requirement asking a *fresh-context* reviewer a single question: **would these tests fail if this requirement were violated?** Verdicts are recorded with `2119 pass` / `2119 fail`.
4. **One gate.** `2119 check` = lint + coverage + verdict freshness. Exit code 0 or it isn't done. Hooks, git, and CI all call the same command.

This repo practices what it enforces: 2119's own requirements live in [`specs/`](specs/), every MUST has an annotated test, and `.2119/verdicts/` holds the committed review verdicts.

**What 2119 is not:**
1. **not a test runner** (`check` never executes your suite — run `npm test && npx rfc2119 check`, both, always)
2. **not a CI replacement** (it's one exit code your CI calls)
3. **not a security boundary** (a deliberate cheater is made *conspicuous*, not impossible).
These boundaries are deliberate and [enforced as reviewed requirements](specs/REQ-008-honest-boundaries.md) — the reasoning lives in [docs/design.md](docs/design.md), and [docs/scaling.md](docs/scaling.md) covers hardening for larger or more formal projects.

## Use it in your repo

From your project root:

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

### To use 2119:

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

- **Deterministic checks keep agents in compliance.** Lint and coverage are exact parsing. They run identically from an agent hook, your shell, and CI.
- **Judgment reviews make tests more accurate.** Review IDs embed a SHA-256 content hash of the requirement text plus the exact evidence blocks that cover it: each annotated test through the next annotation, plus the file's prelude (imports and mocks stay under the hash). Edit a covered test — or the requirement — and the old verdict silently stops counting; edit an *unrelated* test in the same file and it doesn't. `2119 pass` refuses IDs whose hash doesn't match current content, so verdicts can't be pre-computed or replayed.
- **Verdicts are committed and schema-validated.** `.2119/verdicts/*.json` files carry the verdict, summary, and timestamp, so every review decision shows up in the PR diff for humans to audit. The gate counts a verdict only as a fully well-formed record; a malformed file (mangled merge, missing field, wrong filename) is a loud check violation, never a silent pass.

### Risks

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

The enforcement itself is agent-agnostic by construction — lint, coverage, review hashing, and verdicts are a plain CLI with an exit code. Hooks only change *when* an agent hears about a failure. Every `init` includes the universal layer:

- **AGENTS.md section** (always written): teaches any agent that reads it — Pi, opencode, Cursor, Hermes, whatever ships next — to spec first, annotate tests, dispatch reviews, and run `npx rfc2119 check` before finishing.
- **Git pre-commit hook** (`--git-hook`): blocks commits while `check` fails, regardless of which agent (or human) is committing.
- **CI** (`--ci`): creates a GitHub Actions workflow that re-runs `check` on every pull request.

Same command, same verdicts, same gate everywhere; platforms with hooks just find out sooner.

## Choosing a reviewer model

Judgment reviews are scoped, single-question tasks, so we recommend **a capable but cost-effective model** — In July 2026, we primarily use Opus 4.8. Set it once via `review_model` in `.2119.yml` (the first interactive `2119 review` will ask; agents and CI never get prompted). The value is advisory text passed to whatever agent dispatches the reviews, so use your platform's own model names. Two things to calibrate:

- Don't go too small: when 2119 reviewed its own code, a stronger model caught things weaker ones wave through — a test whose assertion was masked so it couldn't fail, and a parser that violated its own spec. On Claude Code, an Opus-class model is a solid choice.
- `[review]`-tagged requirements are the ones that resist a deterministic test (e.g. "This feature MUST generate human-readable, helpful descriptions"). Their instruction files deliberately recommend the dispatching agent's own (typically stronger) model instead of the pinned one.
- **Diversify, then audit.** A single model family shares blind spots — `review_model` accepts a list (every listed model reviews; all must pass), and `2119 review --audit` generates *adversarial* instructions that challenge passing verdicts ("construct a mutant that violates the requirement while the tests stay green"). Run an audit sweep periodically with a model from a different provider, and audit your particularly challenging or high-consequence requirements individually.

## Choosing test vs. review vs. verify vs. manual

Deterministic facts get tests. Judgment calls get `[review]`. Things only a human can do get `[manual]`.

Here are some anti-patterns to avoid:
- **A keyword-grep test standing in for a judgment call** (e.g. `assert "fix" in error_message` for "errors MUST tell the user how to fix the problem") — the substring "fix" appearing proves nothing about whether the message actually explains the fix; "could not fix" passes it. The test can't fail honestly. Use `[review]` instead.
- **A review used on a machine-checkable fact** (e.g. using a reviewer to "check the version field equals 2") — that's judgment spent where a test is stronger.

## Requirement granularity

When drafting requirements for a feature, prefer a small number of user-meaningful,
workflow-level requirements over many implementation-step requirements.

A first-pass feature spec should usually contain **around 3–8 enforced `MUST`
requirements**. More granular requirements are appropriate only when each one
represents a distinct user promise, safety invariant, compatibility guarantee, or
independently valuable behavior.

Avoid turning every implementation detail into a separate `MUST`. Instead:

- Use `[manual]` for behavior that is primarily verified through UI or manual inspection.
- Use `SHOULD` for polish, edge cases, and preferred behavior that should not block the first enforcement pass.
- Use explanatory notes or acceptance-checklist bullets (in the spec's notes section) for implementation details.
- Split requirements only when each resulting requirement has a clear independent test or review value.

**Good:**

> A user MUST be able to paste an image into the composer, see it appear as an
> attachment chip, and send it as an image attachment.

**Less good as separate first-pass requirements:**

> The paste handler MUST read from the pasteboard.  
> The classifier MUST create an image attachment.  
> The chip area MUST become visible.  
> The chip MUST show a thumbnail.  
> The RPC payload MUST contain an image object.  
> The transcript MUST show the image.

Those details may be useful, but they are often better expressed as notes,
manual criteria, or later hardening requirements unless each one needs independent
enforcement.

### Spec sizing smells

Reconsider the spec if:

- One feature produces more than ~10 enforced `MUST`s before tests exist.
- Most requirements are restating internal implementation steps.
- A reviewer would need to approve many requirements using the same single test.
- The requirement says "MUST cover" or "MUST test" instead of describing product behavior.
- Many requirements differ only by small UI details.

### Starter spec structure

The template that `2119 init` creates nudges toward this shape:

```markdown
### REQ-001.1: Core workflows

List 3–5 user workflows as `MUST`s.

### REQ-001.2: Safety and compatibility invariants

List only critical invariants as `MUST`s.

### REQ-001.3: Manual acceptance criteria

Use `[manual]` for visual/UI workflows that are not automated yet.

## Notes and non-goals

Put implementation details and deferred polish here instead of making them
enforced requirements.
```

This keeps 2119 adoption lightweight. Teams can start with a manageable enforced
surface, then split or harden requirements later when individual behaviors prove
important enough to test or review independently.

## Commands

| Command | Does |
|---------|------|
| `2119 init [--agent <p>] [--git-hook] [--ci]` | Scaffold and install integrations |
| `2119 lint` | Spec format checks |
| `2119 cover` | Requirement ↔ test traceability |
| `2119 review [--dispatch] [--audit]` | Generate instruction files for stale/missing judgment reviews; `--dispatch` adds a ready-to-paste parallel-subagent prompt; `--audit` adds adversarial audits of passing verdicts |
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
comment_leaders: []    # extra comment leaders for annotation lines, beyond
                       # //, #, *, /*, --, ;, %, <!--
audit: "off"           # "always" generates adversarial audits of passing
                       # verdicts on every review run (default: only --audit)
```

## What's in this repo

Nothing here needs to be copied into your project — `init` generates everything an adopter needs. The scaffolding it builds is:

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

- **The deterministic gate is free.** Lint, coverage, and hash checks are parsing — ~0.2s on a tested 300k LOC project.
- **Judgment reviews are the only real cost, and steady state tracks your change rate, not your repo size.** A verdict re-runs only when its requirement or its evidence blocks change, so a typical PR touching a handful of annotated tests costs on the order of **$0.25–$1** in reviewer tokens (measured here: ~$0.05 per review on an Opus-class model). Block-level hashing is what keeps this bounded — editing one test doesn't re-review its neighbors.
- **The dominant cost of adopting on an established codebase isn't reviews — it's authoring.** Retroactively speccing a large repository means writing thousands of requirements and honestly-falsifiable tests. It's usually better to adopt incrementally: run `init`, spec new features and the subsystems you're actively changing, and let coverage grow along the change frontier. A full retroactive review pass, if you ever want one, is only ~$0.05–0.10 per requirement dispatched in parallel.
- **Very large monorepos (tens of thousands of test files):** the repo walk becomes `check`'s bottleneck (~10s+ at 10M LOC), which you'd feel in write-time hooks. The planned fix — `git ls-files` enumeration plus a content-keyed annotation cache — preserves whole-repo semantics; see the note in [`specs/REQ-002-deterministic-checks.md`](specs/REQ-002-deterministic-checks.md) for why a `--changed` flag is deliberately *not* the answer.
