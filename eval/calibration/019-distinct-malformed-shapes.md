---
expected_verdict: pass
prompt: test-quality
source: issue #38
failure_mode: meaningful negative-space table mistaken for a redundant matrix
---

## Requirement

> Malformed envelopes MUST be rejected before dispatch.

## Evidence

```ts
// 2119: FIX-001.1.1
it.each([
  ["missing kind", { payload: {} }],
  ["wrong payload type", { kind: "run", payload: 1 }],
  ["unknown kind", { kind: "erase", payload: {} }],
])("%s", (_name, envelope) => expect(dispatch(envelope)).toEqual({ ok: false }));
```

## Why the correct verdict is PASS

The cases exercise distinct schema and dispatch boundaries rather than alternate spellings of one
invalid token.
