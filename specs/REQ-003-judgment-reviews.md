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
2. A review ID MUST have the form `<req-id>--<hash12>` where `hash12` is the first 12 hex characters of the SHA-256 over the requirement statement text plus the full content of every covering test file, sorted by path.
3. For `[review]`-tagged requirements (REQ-001.4), the hash input MUST be the requirement statement text plus the content of all files matching the tag's globs, so implementation edits invalidate the verdict.
4. `2119 review` MUST skip requirements whose current review ID already has a valid verdict, so repeat runs only dispatch stale or missing reviews.
5. Instruction files MUST direct the reviewer to answer one question — would these tests fail if this requirement were violated? — and to flag tautological assertions, over-mocking that bypasses the behavior under test, and assertions unrelated to the requirement's criterion.
6. Instruction files MUST be written to `.2119/reviews/`, a directory that `2119 init` adds to `.gitignore`.

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
