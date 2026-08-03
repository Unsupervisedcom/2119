# REQ-012: Stable Verdict Files

## Overview

A judgment verdict is evidence about one requirement's review input at one
specific content state. The existing storage name, `<review-id>.json`, embeds
that state's hash in the filename. Re-review therefore creates another file
instead of superseding the obsolete assertion. Repositories accumulate many
records that no longer describe current review input, even though only the
record matching the current hash can satisfy the gate.

This feature makes the current assertion explicit and singular. Each
requirement has one stable verdict path, while the record carries the content
hash that `check` compares with the hash computed from the current review
input. Superseded versions remain available in git history, where obsolete
versions of other tracked files already live.

The content boundary remains the boundary of the judgment being made. For a
test-quality review, the review input is the requirement statement, its
covering annotation evidence blocks, and configured shared evidence, as
defined by REQ-003.1.2, REQ-003.1.7, and REQ-003.1.8. For a `[review]`
requirement, it is the requirement statement, matched evidence files, and any
custom review instructions, as defined by REQ-003.1.3 and REQ-005.1.2. This
avoids invalidating every verdict for an unrelated repository edit without
allowing an edit to material the reviewer judged to retain a pass.

Existing repositories need a safe transition from files named
`<requirement-id>--<hash12>.json`. A legacy verdict whose hash matches the
current review input remains acceptable during migration, but is identified
as legacy in command output. A stale legacy verdict is identified and never
counts as evidence. When a stable path exists, it is authoritative during
`check`; an old legacy pass cannot bypass a malformed, stale, or failing
stable record. The explicit `prune` command preserves a valid current stable
record when present, otherwise recovers valid current evidence from the
legacy set, and then removes superseded legacy files. `check` remains
non-mutating.

This contract supersedes the former REQ-003.7.3 filename rule, which required
the content-addressed review ID in the filename. That rule was removed because
it directly conflicts with the stable per-requirement path; record validation
continues to enforce agreement among the stable filename, requirement ID,
review ID, and stored hash.

Verdicts remain committed evidence and remain mandatory. Stable storage does
not reduce review coverage, skip judgment, or relax any gate. Marking the
remaining JSON as generated changes only GitHub's presentation of those
records.

## Requirements

### REQ-012.1: Stable recording

1. After any successful `2119 pass` or `2119 fail` invocations, `.2119/verdicts/` MUST contain exactly one verdict JSON for each requirement those invocations recorded, at `<canonical-requirement-id>.json`, with a later invocation for the same requirement replacing its prior stable or legacy verdicts regardless of content hash.

### REQ-012.2: Concurrent isolation

1. When verdict-recording commands for distinct requirements are launched without waiting for either command to finish, each successful command MUST leave a well-formed stable record for its own requirement without overwriting, deleting, or corrupting the other command's record.

### REQ-012.3: Explicit content binding

1. A well-formed stable verdict record MUST name its canonical requirement ID and review ID, store a lowercase 12-hex content hash equal to that review ID's suffix, store a `pass` or `fail` result with a nonempty summary and parseable timestamp, and reside at `.2119/verdicts/<canonical-requirement-id>.json`.
2. The stored content hash MUST be the hash of exactly the review input already defined for that target: the inputs and ordering in REQ-003.1.2, REQ-003.1.7, and REQ-003.1.8 for test-quality reviews, or the inputs in REQ-003.1.3 and REQ-005.1.2 for `[review]` reviews, so any change within that input changes the hash while unrelated repository content does not.

### REQ-012.4: Stable freshness gate

1. When a stable path exists for a reviewed requirement, `2119 check` MUST treat only a well-formed stable `pass` whose stored hash equals the current review ID's hash as satisfying that requirement, reporting malformed, stale, or current-failing stable state as a check violation without falling back to any legacy record.

### REQ-012.5: Legacy transition in check

1. When no stable path exists for a review target, `2119 check` MUST validate every matching legacy `<canonical-requirement-id>--<hash12>.json` file, allow only a well-formed current legacy `pass` to satisfy the gate, report malformed legacy records as violations, and emit non-failing migration notices for current or superseded well-formed legacy records that identify their source and stable destination without counting superseded records as evidence.

### REQ-012.6: Explicit migration

1. For each requirement, `2119 prune` MUST retain a well-formed current stable record when one exists, otherwise preserve a well-formed current legacy record at the stable path with all verdict fields unchanged.
2. `2119 prune` MUST remove every legacy verdict file after selecting the evidence to retain, list each conversion or removal, and leave at most one verdict JSON per requirement.

### REQ-012.7: Generated-file presentation

1. `2119 init` MUST install a Git attribute that marks `.2119/verdicts/*.json` as `linguist-generated=true` while the verdict path remains eligible for Git tracking.
