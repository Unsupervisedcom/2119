---
expected_verdict: fail
prompt: test-quality
source: issue #38
failure_mode: parameter spellings multiply one production behavior
---

## Requirement

> Invalid color values MUST be rejected.

## Evidence

```ts
// 2119: FIX-001.1.1
it.each(["wat", "nope", "invalid", "unknown", "???"])("%s is rejected", (value) => {
  expect(parseColor(value)).toEqual({ ok: false });
});
```

## Why the correct verdict is FAIL

Every value is the same unrecognized-token shape and reaches the same branch. The matrix adds
executions without evidence for distinct malformed shapes.
