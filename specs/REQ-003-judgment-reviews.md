# REQ-003: Judgment Reviews

## Overview

Deterministic coverage proves an annotated test *exists*; it cannot prove the
test genuinely verifies its requirement. An agent under pressure can satisfy
`2119 cover` with a tautological test, an over-mocked test, or a keyword-grep
masquerading as verification. The judgment layer closes that gap: for each
covered requirement, a reviewing agent reads the requirement and its covering
tests and issues a verdict on whether the tests would actually fail if the
requirement were violated.

Verdicts are content-hash-keyed (any edit to the requirement or its covering
tests invalidates the verdict) and committed to the repository as readable
files, so both cheating and staleness are visible in a PR diff. This adapts
DeepWork's `.passed`-marker design with two hardening changes: verdicts carry
their findings (not empty markers), and they live in version control.

## Requirements

### REQ-003.1: Review task generation

1. `2119 review` MUST emit one self-contained review instruction file per requirement needing review, containing the requirement text, the covering test files' relevant content or paths, the verdict-recording command, and the review ID.
2. A review ID MUST have the form `<req-id>--<hash12>` where `hash12` is the first 12 hex characters of the SHA-256 over the requirement statement text plus each covering annotation's evidence block (REQ-003.1.7), ordered by file path then position within the file, so editing an unrelated test in a shared file does not invalidate the verdict.
3. For `[review]`-tagged requirements (REQ-001.4), the hash input MUST be the requirement statement text plus the content of all files matching the tag's globs, so implementation edits invalidate the verdict.
4. `2119 review` MUST skip requirements whose current review ID already has a valid verdict, so repeat runs only dispatch stale or missing reviews.
5. Instruction files MUST direct the reviewer to answer one question — would these tests fail if this requirement were violated? — and to flag tautological assertions, over-mocking that bypasses the behavior under test, and assertions unrelated to the requirement's criterion.
6. Instruction files MUST be written to `.2119/reviews/`, a directory that `2119 init` adds to `.gitignore`.
7. An annotation's evidence block MUST comprise the file's prelude (all content before the file's first annotation, hashed once per file) plus the text from the annotation's line through the line before the file's next annotation or the end of file, so shared imports and mocks stay under the hash while unrelated tests fall outside it.
8. When the optional `shared_evidence` config key lists globs, the content of every matching file MUST be included in the hash input of every test-quality review, so shared fixtures and helper modules cannot change without invalidating the verdicts that depend on them.

### REQ-003.2: Verdict recording

1. `2119 pass <review-id> --summary <text>` MUST write a verdict file to `.2119/verdicts/` containing the review ID, requirement ID, content hash, a findings summary, and an ISO 8601 timestamp.
2. Verdict files MUST be plain committed JSON — never gitignored — so verdicts appear in PR diffs for human audit. [review: src/**]
3. `2119 pass` MUST refuse to record a verdict whose hash component does not match the current content hash for that requirement, preventing pre-computed or replayed passes.
4. `2119 fail <review-id> --summary <text>` MUST record a failing verdict the same way, causing `2119 check` to fail until it is superseded by a passing verdict.

### REQ-003.3: Verdict freshness in check

1. `2119 check` MUST fail when any reviewed requirement lacks a verdict whose hash matches the current content, listing each stale or missing review ID.
2. A verdict for a tombstoned requirement (`REQUIREMENT REMOVED`) MUST be ignored rather than reported as stale.

### REQ-003.4: Reviewer independence

1. Review instruction files MUST direct that the reviewer be a fresh-context agent (subagent or separate session) that did not write the code under review, without relying on that direction being technically enforceable on platforms lacking subagents.
2. The documentation MUST describe the residual risk plainly: an implementing agent can run `2119 pass` itself, and the mitigations are committed verdicts (auditable), hash invalidation (no stale reuse), and CI re-verification. [review: README.md]

### REQ-003.5: Reviewer model selection

1. The recommended reviewer model MUST be configurable via a `review_model` field in `.2119.yml`, with the platform-neutral default recommendation `a capable, cost-effective model` (2119 runs under many agent platforms, so no vendor model name is a valid default).
2. `2119 review` MUST include the recommended reviewer model in its dispatch output and in each test-quality instruction file, as advisory text for the dispatching agent.
3. Instruction files for `[review]`-tagged requirements MUST recommend the dispatching agent's own (typically stronger) model rather than the pinned `review_model`, since these are the judgment-heavy reviews.
4. When `2119 review` runs interactively (stdin is a TTY) and no `review_model` is configured, it SHOULD prompt once for a model choice and persist the answer to `.2119.yml`.
5. When stdin is not a TTY, `2119 review` MUST NOT block waiting for input, using the default model silently instead.

### REQ-003.6: Dispatch ergonomics

1. When invoked as `2119 review --dispatch`, the command MUST append a ready-to-paste dispatch prompt that assigns each pending instruction file to one fresh-context reviewer, so the orchestrating agent can launch reviews without composing prompts itself.
2. The dispatch prompt MUST direct that reviews run in parallel where the platform supports it and that each reviewer records its own verdict via the pass/fail commands named in its instruction file.

### REQ-003.7: Verdict record validation

Found in the field (2026-07-10): the verdict reader accepted any JSON containing a `reviewId`,
and the gate failed only on a literal `fail` — so a record with a missing or typo'd verdict
field counted as passing. Gates fail closed: a verdict earns a pass only by being a fully
well-formed record. This adds no protection against a deliberate self-pass (the documented
residual risk — a well-formed fake is as easy to write as a malformed one); it protects against
accidental corruption (mangled merges, hand-edits) silently reading as green.

1. A verdict record MUST be counted by the gate only when its `verdict` field is exactly `pass` or `fail`, its `summary` is a nonempty string, its `requirementId` equals the requirement component of its `reviewId`, its `hash` equals the review ID's 12-character suffix, and its `timestamp` parses as a date.
2. A verdict file that fails to parse or whose record fails validation MUST produce a check violation identifying the file and the reason, rather than being silently skipped or counted as passing.
3. A verdict file whose filename is not exactly `<reviewId>.json` MUST be treated as malformed, so the check gate and `2119 prune` agree on which file a verdict lives in.
