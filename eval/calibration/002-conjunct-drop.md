---
expected_verdict: fail
prompt: test-quality
source: internal reviewer aside, 2119 repo (REQ-003.7.1 shape), 2026-07-10
failure_mode: A — multi-conjunct requirement, one conjunct tested
---

## Requirement

> A record MUST be counted only when its `kind` field is exactly `a` or `b`, its `note` is a
> nonempty string, its `owner` matches the record ID's owner component, and its `stamp` parses
> as a date.

## Evidence

```ts
// 2119: FIX-001.1.1
it("rejects records with an invalid kind", () => {
  expect(count({ id: "x--1", kind: "banana", note: "n", owner: "x", stamp: NOW })).toBe(0);
  expect(count({ id: "x--1", kind: "a", note: "n", owner: "x", stamp: NOW })).toBe(1);
});
```

## Why the correct verdict is FAIL

The requirement has four conjuncts; the test falsifies exactly one (`kind`). Records with an
empty `note`, a mismatched `owner`, or an unparseable `stamp` are never shown to be rejected —
any of those three validations could be deleted and this test stays green. Enumerate the
conjuncts; each needs its own rejected counterexample.
