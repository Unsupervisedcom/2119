# REQ-009: Incremental Check

## Overview

The former REQ-002.3.4 proposed limiting collection to changed files and was
tombstoned before implementation because coverage is a repository-wide
relationship: an unchanged test can cover a changed requirement. The revived
flag instead builds both repository views and narrows the report only after it
has identified the requirements whose inputs changed.

The comparison deliberately follows the existing evidence granularity.
Annotated tests use their review evidence blocks, so an edit to one test does
not invalidate a neighboring test. Explicit review evidence and shared evidence
remain whole-file inputs. This makes the incremental command agree with the
same hashes that determine verdict freshness rather than inventing a second
dependency model.

## Requirements

### REQ-009.1: Base and change set

1. `2119 check --changed <base-ref>` MUST accept exactly one locally resolvable commit-ish, use the merge-base of that commit and `HEAD` as the baseline, perform no network access, and exit non-zero with a clear diagnostic when the argument is absent, ambiguous, unresolvable, or has no merge-base with `HEAD`.
2. The changed-path set MUST include differences between the baseline tree and `HEAD`, staged and unstaged tracked differences, and untracked non-ignored files, with deletions retained as changed paths.
3. Incremental checking MUST exit non-zero with a diagnostic instead of silently running an incomplete or full-repository substitute when Git metadata, baseline content, or baseline configuration needed for sound scoping cannot be read or parsed.

### REQ-009.2: Affected requirements

1. A current requirement MUST be affected when it is absent from the baseline or its statement, normative keyword, coverage mode, coverage command, evidence globs, or review-instruction path differs from the baseline requirement with the same ID.
2. A current requirement MUST be affected when a covering annotation is added or removed between the baseline and current views, or when the content hash of one of its covering annotation evidence blocks differs between those views.
3. Test evidence comparison MUST use the REQ-003.1.7 block boundaries in each view, including the shared file prelude, so an edit confined to another annotation block in the same file does not affect the requirement.
4. A current requirement MUST be affected when content selected as its explicit review evidence, review instructions, or configured shared evidence differs by whole-file hash between the two views.
5. A current requirement MUST be affected when its current review verdict is added, removed, replaced, or malformed relative to the baseline, and a changed malformed verdict that cannot be assigned to a current requirement must remain a scoped violation.
6. Every current requirement MUST be affected when `.2119.yml` differs from the baseline, because configuration changes can alter discovery, enforcement, evidence, or review behavior.

### REQ-009.3: Scoped validation and output

1. Incremental checking MUST report lint violations from changed current spec files, coverage and verdict-freshness violations for affected current requirements, invalid annotations from changed test evidence, and verification failures only for affected current requirements, while ignoring pre-existing violations outside that scope.
2. An unchanged annotation whose referenced requirement was deleted from a changed spec MUST be treated as changed test evidence and reported as an invalid annotation, preventing requirement deletion from hiding a dangling reference.
3. `--changed` MUST compose with `--json` and `--no-verify`, with JSON counts and requirement lists describing only the incremental scope and skipped affected verification requirements surfaced by `--no-verify` in the existing manual-requirements form.

