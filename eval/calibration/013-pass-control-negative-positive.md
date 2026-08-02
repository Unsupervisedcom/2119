---
expected_verdict: pass
prompt: test-quality
source: 2119 repo (verdict-validation suite), 2026-07-10
failure_mode: none — control case
---

## Requirement

> A verdict record MUST be rejected loudly when its `verdict` is absent or is not exactly `pass`
> or `fail`, while a record written by the real CLI is accepted.

## Evidence

Production provenance: this case condenses `tests/verdict-validation.test.ts:47-75`. The
historical bare-record failure is exercised at lines 51-55, the near-miss `passd` verdict at
lines 57-71, and the real CLI writer control at lines 73-75.

```ts
// 2119: FIX-001.1.1
it("counts a verdict only when the full record is well-formed", () => {
  write({ reviewId });                            // bare record: the reported exploit
  expect(check().status).toBe(1);
  expect(check().stderr).toContain("malformed verdict file");
  write({ reviewId, requirementId, hash, verdict: "passd", summary, timestamp });
  expect(check().status).toBe(1);
  expect(check().stderr).toContain('verdict must be exactly "pass" or "fail"');
  expect(runCli("pass", reviewId, "--summary", "asserts spin").status).toBe(0);
  expect(check().status).toBe(0);
});
```

## Why the correct verdict is PASS

Negative and positive controls are all production-backed: the historical missing-verdict exploit
is rejected, a near-miss verdict value is rejected with the named reason, and the CLI-written
record is accepted. The gate therefore fails closed without over-rejecting.
