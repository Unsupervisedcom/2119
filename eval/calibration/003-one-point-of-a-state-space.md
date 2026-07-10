---
expected_verdict: fail
prompt: test-quality
source: external audit (GPT-5.6), 2119 repo (REQ-002.4.2 shape), 2026-07-10
failure_mode: A — universal claim, existential test
---

## Requirement

> Running any command in a repository with no config file and no spec files MUST produce a clear
> "not initialized" message, not a zero-requirement pass.

## Evidence

```ts
// 2119: FIX-001.1.1
it("reports not-initialized in an empty directory", () => {
  const r = run(emptyDir(), ["check"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("not set up");
});
```

## Why the correct verdict is FAIL

"No config and no spec files" is a *class* of states; the test samples one member (a completely
empty directory). The nearest counterexample — a repository containing an **empty `specs/`
directory** — is also in the class, and the implementation green-lit it as initialized while
this test stayed green. A universal requirement needs its boundary states enumerated, not its
easiest member demonstrated.
