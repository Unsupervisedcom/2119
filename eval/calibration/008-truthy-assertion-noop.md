---
expected_verdict: fail
prompt: test-quality
source: field deployment round 1, 2026-07-10 (sanitized)
failure_mode: A — assertion that cannot fail (operator precedence)
---

## Requirement

> The classifier MUST label a distribution-mode result with the mode name.

## Evidence

```python
# 2119: FIX-001.1.1
def test_mode_label():
    result = classify(sample)
    assert result.mode == "distribution" or "comparison"
```

## Why the correct verdict is FAIL

Operator precedence makes this `(result.mode == "distribution") or "comparison"` — the
right-hand operand is a bare nonempty string, so the assertion is always truthy and can never
fail. This is the purest tautology class: the test looks like it checks the label and checks
nothing. A reviewer must mentally evaluate whether each assertion *can* fail, not whether it
mentions the right values.
