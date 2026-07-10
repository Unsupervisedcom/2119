---
expected_verdict: fail
prompt: requirement
source: external audit (GPT-5.6), 2119 repo (REQ-004.3.6 shape), 2026-07-10
failure_mode: B — requirement states mechanism, not outcome
---

## Requirement

> The generated CI workflow MUST include a project test-suite step separate from the check step.

## Evidence

```ts
// 2119: FIX-001.1.1
it("generated workflow includes a test step", () => {
  install(root);
  const wf = readFileSync(workflowPath, "utf8");
  expect(wf).toContain("- run: npm test");
});
```

## Why the correct verdict is FAIL

The test is honest to the requirement — and the requirement is dishonest to the intent. It was
written by the implementer, minutes before implementing, and describes the planned mechanism
("include a step") instead of the observable outcome ("the workflow can execute the project's
tests"). A workflow containing `npm test` with no dependency-install step satisfies both the
requirement and the test while being unusable on a clean runner. The correct verdict fails with
the finding that the requirement itself must be restated as an outcome.
