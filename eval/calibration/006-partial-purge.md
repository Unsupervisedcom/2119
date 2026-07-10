---
expected_verdict: fail
prompt: audit
source: field deployment meta-review, 2026-07-10 (sanitized)
failure_mode: A — multi-structure invariant asserted on a subset
---

## Requirement

> `remove()` MUST purge the entry from every internal structure (ordering list, score map,
> alias map, and count table) so no stale state survives removal.

## Evidence

```python
# 2119: FIX-001.1.1
def test_remove_purges():
    b = BoundedBest(cap=4)
    b.add("k", 0.9)
    b.remove("k")
    assert "k" not in b.ordering
    assert b.count() == 0
```

## Why the correct verdict is FAIL

Four structures are named; two are asserted. Concrete surviving mutants: `remove()` skips the
score-map deletion (a later score lookup resurrects the entry), or performs a non-mutating alias
lookup instead of a purge — both keep this test green. The audit must construct exactly such a
mutant: assert post-removal state of *each* named structure, or the invariant is unverified.
