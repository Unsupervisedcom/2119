---
expected_verdict: fail
prompt: test-quality
source: field deployment round 2, 2026-07-10 (sanitized)
failure_mode: A — golden end-to-end output standing in for a named unit behavior
---

## Requirement

> Candidates MUST be processed in ascending length order, breaking ties by descending score.

## Evidence

```python
# 2119: FIX-001.1.1
def test_pipeline_end_to_end():
    results = run_pipeline(load_fixture("demo.arrow"))
    assert results == load_expected("demo.expected.json")
```

## Why the correct verdict is FAIL

The golden end-to-end test *happens* to exercise the ordering, but its fixture may not contain a
tie at all, and any ordering bug that produces the same final output survives. When a
requirement names a specific unit behavior (an ordering rule, a tie-break), the evidence must
observe *that behavior directly* — a constructed input where length order and score order
disagree — not a downstream aggregate that could mask it. Golden files verify "nothing changed,"
not "this rule holds."
