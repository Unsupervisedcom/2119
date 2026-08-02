---
expected_verdict: pass
prompt: test-quality
source: 2119 repo (verdict-validation suite), 2026-07-10
failure_mode: none — control case
---

## Requirement

> A record MUST be counted only when fully well-formed: `kind` exactly `a` or `b`, nonempty
> `note`, `owner` consistent with the ID, and a parseable `stamp`; anything else is a loud
> violation naming the file, never a silent pass.

## Evidence

Production provenance: this condensed case is taken from
`tests/verdict-validation.test.ts:47`. The historical bare-record failure is
driven through the production CLI at `tests/verdict-validation.test.ts:51`, the
near-miss verdict value at `tests/verdict-validation.test.ts:57`, and the real
writer control at `tests/verdict-validation.test.ts:73`.

```ts
// 2119: FIX-001.1.1
it("counts only well-formed records, loudly rejecting the rest", () => {
  write({ id });                                  // bare record: the reported exploit
  expect(check().status).toBe(1);
  expect(check().stderr).toContain("malformed");
  write({ id, kind: "banana", note: "n", owner, stamp });  // typo'd kind
  expect(check().stderr).toContain('exactly "a" or "b"');
  write({ id, kind: "a", note: "", owner, stamp });
  expect(check().stderr).toContain("nonempty note");
  write({ id, kind: "a", note: "n", owner: "wrong", stamp });
  expect(check().stderr).toContain("owner consistent with the ID");
  write({ id, kind: "a", note: "n", owner, stamp: "not-a-date" });
  expect(check().stderr).toContain("parseable stamp");
  writeViaCli(id, "genuine note");                 // well-formed via the real writer
  expect(check().status).toBe(0);
});
```

## Why the correct verdict is PASS

Negative and positive controls both present: the historical exploit is reproduced verbatim; each
named validity conjunct has an independently rejected counterexample with the named reason; and
the genuine record is accepted. The gate therefore fails closed without over-rejecting. Rejection
*reasons* are asserted, so the violation is loud, not silent, satisfying that boundary term too.
