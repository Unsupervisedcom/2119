# REQ-006: State Maintenance

## Overview

The review loop produces two kinds of state: scratch instruction files in
`.2119/reviews/` and committed verdicts in `.2119/verdicts/`. Both accumulate
stale entries as content changes — an instruction file whose review ID is no
longer pending, or a verdict whose hash no longer matches any current target.
Stale instruction files misled tooling during this project's own development
(a cleanup script mistook them for pending work), and orphaned verdicts are
dead weight in the repository.

This spec makes the tool clean up after itself: `2119 review` keeps the
instruction directory exactly in sync with the pending set, and `2119 prune`
removes orphaned verdicts on demand. Pruning is deliberately a separate,
explicit command rather than part of `check`: verdict files are committed
audit history, and deleting them should be a visible action in the diff, not
a side effect.

## Requirements

### REQ-006.1: Instruction-file hygiene

1. `2119 review` MUST delete instruction files in `.2119/reviews/` whose review ID is not currently pending, so the directory always reflects exactly the pending set.
2. `2119 review` MUST perform this cleanup even when no reviews are pending, leaving the directory empty in that case.

### REQ-006.2: Verdict pruning

1. `2119 prune` MUST delete every verdict file whose review ID does not match any current review target, listing each deleted file.
2. `2119 prune` MUST leave verdicts that match current review targets untouched, so a passing `2119 check` still passes after a prune.
