---
expected_verdict: fail
prompt: audit
source: field deployment meta-review, 2026-07-10 (sanitized)
failure_mode: A — special-value precedence clauses unpinned
---

## Requirement

> `rate_ratio` MUST return infinity when the denominator count is zero, `0.0` when the numerator
> count is zero, and infinity when both are zero (the denominator clause takes precedence).

## Evidence

```python
# 2119: FIX-001.1.1
def test_rate_ratio():
    assert rate_ratio(pos=3, neg=1) == 3.0
    assert rate_ratio(pos=0, neg=0) == INF
```

## Why the correct verdict is FAIL

The requirement defines three special-value clauses including an explicit precedence rule; the
test pins one ordinary value and one corner. The nearest counterexamples: `neg=0, pos>0` (must
be INF) and `pos=0, neg>0` (must be 0.0) are never asserted — so reordering the branch that
implements the precedence clause survives every assertion. Special-value tables in a requirement
are conjuncts: each row needs its own assertion.
