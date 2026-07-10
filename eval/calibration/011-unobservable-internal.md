---
expected_verdict: fail
prompt: requirement
source: field deployment round 2, 2026-07-10 (sanitized)
failure_mode: B — requirement constrains an unobservable internal
---

## Requirement

> The search MUST rebuild its candidate checker before each expansion wave.

## Evidence

```python
# 2119: FIX-001.1.1
def test_checker_rebuilt(monkeypatch):
    calls = []
    monkeypatch.setattr(engine, "_build_checker", lambda *a: calls.append(1) or REAL(*a))
    engine.search(fixture)
    assert len(calls) == engine.wave_count
```

## Why the correct verdict is FAIL

The requirement names an internal ("rebuild its checker") with no observable outcome — so the
only possible test is spying on a private method, which is over-mocking by construction: it pins
the implementation, not any behavior a user could distinguish. The correct finding is against
the *requirement*: restate what rebuilding guarantees observably (e.g. "results MUST reflect
conditions added between waves") or delete it. A reviewer who passes this because the spy
matches the wording has verified nothing.
