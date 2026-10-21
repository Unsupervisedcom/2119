---
expected_verdict: pass
prompt: test-quality
source: accretion study (2119#38), 2026-10 (synthetic)
failure_mode: legitimate exception — delivered agent-facing text is behavior
---

## Requirement

> The review dispatch surface MUST instruct each reviewer agent not to edit files and to record
> its verdict with the pass/fail command named in its instruction file.

## Evidence

```ts
// 2119: REQ-003.6.2
it("dispatch prompt carries the verdict-recording and no-edit instructions", () => {
  const prompt = renderDispatchPrompt([fakeTask()]);
  expect(prompt).toMatch(/record its own verdict/);
  expect(prompt).toContain("pass/fail command");
  expect(prompt).toMatch(/do not edit files/i);
});
```

## Why the correct verdict is PASS

Agent-facing text is behavior when it is delivered through the product's real surface, and this
requirement is about delivered text — asserting its load-bearing content is asserting the
contract. The evidence survives legitimate editing (rewording the prompt keeps it green) because
it pins the outcome that must survive: the no-edit instruction and the recording command — not a
whole paragraph, heading order, or unrelated prose. A byte-for-byte snapshot of the entire
rendered prompt would deserve FAIL as a prose tripwire instead.
