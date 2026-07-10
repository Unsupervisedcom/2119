# REQ-008: Honest Boundaries Documentation

## Overview

The first external evaluation of 2119 (2026-07-10) got the architecture right and still
mis-scoped the tool — because the boundaries it deliberately does not cross (running tests,
replicating CI, acting as a security boundary) lived in scattered sentences rather than one
authoritative place. Design stances are requirements here, `[review]`-covered, so the stated
philosophy is judged against the shipped tool on every change and cannot silently drift.
The companion principle: simplicity is a feature requirement — rare or heavyweight needs get
escape hatches and documented recipes, never additions to the default path.

## Requirements

### REQ-008.1: Design decisions and non-goals

1. The repository MUST contain `docs/design.md` stating, each with its rationale: that 2119 is not a test runner, that it composes with rather than replicates CI, that it is not a security boundary, that verdicts are committed audit documents rather than attestations, that specs are agent context in which ritual text is banned, and that simplicity is a feature requirement with edge cases handled by escape hatches. [review: docs/design.md]
2. The README MUST state prominently, before the adoption instructions, what 2119 is not — a test runner, a CI replacement, or a security boundary — and link to the design document. [review: README.md]
3. `docs/design.md` MUST record why verdict provenance fields were rejected (self-reported provenance is unenforceable decoration) and name the independent-runner pattern, where a CI identity the author cannot impersonate records the verdicts, as the trust boundary — presented as a reference architecture until an executable example ships. [review: docs/design.md]

### REQ-008.2: Scaling guidance

1. The repository MUST contain `docs/scaling.md` covering at minimum: exact-version pinning, running the project test suite alongside `2119 check` as separate CI gates, CODEOWNERS protection for specs and verdicts, the independent-runner reviewer recipe, explicit evidence globs rather than bare `[review]` tags for critical requirements, `shared_evidence` for shared fixtures, and a `[verify]` policy for repositories accepting untrusted contributions. [review: docs/scaling.md]
2. The documentation MUST advise periodic cross-provider `review --audit` sweeps as part of quality assurance, and targeted audits for particularly challenging or high-consequence requirements, in both the README and the scaling guide. [review: README.md, docs/scaling.md]
