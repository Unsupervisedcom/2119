# REQ-013: Evidence Groups

## Overview

`shared_evidence` (REQ-003.1.8) protects verdicts against neutered helpers by
joining every matching file into every test-quality hash. The cost is coupling:
one universal list means one helper edit re-opens every review, which pushes
adopters toward under-declaring helpers — the opposite failure, where an omitted
dependency silently preserves an approval over weakened evidence.

Evidence groups make that boundary explicit and scoped. A group declares which
covering test files it applies to (`tests`) and which helper/fixture files those
tests depend on (`evidence`). A requirement's review hash then includes only the
groups its covering tests belong to, plus any global `shared_evidence`, so
weakening an applicable helper still invalidates its dependent verdicts while
editing one feature's helpers no longer re-opens another feature's reviews.

This is deliberately a declarative mapping, not a dependency analyzer: the
declaration is itself part of the review identity, so adding, removing, or
editing a group invalidates the verdicts that depended on it, and a group whose
globs match no files fails `check` loudly instead of reading as coverage. The
declared boundary is only as trustworthy as its review — an omitted helper is a
claim that no review catches mechanically, so group edits deserve the same
scrutiny as the code they gate. This implements the narrower-invalidation
direction from issue #38 (and the scoped-groups proposal on issue #27) as a
config capability; it deletes no evidence and detects no semantic equivalence.

## Requirements

### REQ-013.1: Group declaration

1. The optional `evidence_groups` config key MUST declare named groups, each mapping covering test-file globs (`tests`) to helper/fixture globs (`evidence`).
2. A declared group with a missing or empty `tests` or `evidence` list MUST be rejected with an error naming the group, rather than silently read as an empty mapping.

### REQ-013.2: Scoped hash binding

1. A test-quality review hash MUST include the content of every repository file matched by the `evidence` globs of each group whose `tests` globs match at least one of the requirement's covering test files, so weakening an applicable helper invalidates the verdicts that depend on it.
2. A test-quality review hash MUST include each applicable group's declared `tests` and `evidence` globs, so adding, removing, or editing a dependency mapping changes the review IDs of the verdicts that depended on it.

### REQ-013.3: Loud unresolved groups

1. A declared group whose `tests` globs or `evidence` globs match no repository files MUST produce a check violation naming the group and the unmatched globs, rather than silently treating the declared coverage as satisfied.

### REQ-013.4: Inapplicable isolation

1. A requirement's review hash MUST NOT include the content of, or the declared globs of, groups whose `tests` globs match none of the requirement's covering test files, so editing one feature's helpers or mappings does not change another feature's review IDs.
