---
expected_verdict: fail
prompt: test-quality
source: field deployment round 1, 2026-07-10 (sanitized)
failure_mode: A — defaults asserted while explicitly overridden
---

## Requirement

> The constructor MUST default `workers` to 4 and `limit` to 250 when the request document omits
> them.

## Evidence

```python
# 2119: FIX-001.1.1
def test_defaults():
    cfg = Configuration({"workers": 4, "limit": 250})
    assert cfg.workers == 4
    assert cfg.limit == 250
```

## Why the correct verdict is FAIL

The fixture passes the "default" values *explicitly*, so the defaulting code path is never
executed — deleting the defaults entirely keeps this green. The requirement's phrase "when the
request document omits them" is the boundary term: the test must construct the omission
(`Configuration({})`) and observe the defaults appear.
