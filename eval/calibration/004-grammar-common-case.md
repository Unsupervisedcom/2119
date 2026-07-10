---
expected_verdict: fail
prompt: test-quality
source: external audit (GPT-5.6), 2119 repo (REQ-002.1.2 shape), 2026-07-10
failure_mode: A — grammar sampled at its most common production
---

## Requirement

> The linter MUST ignore keywords that appear inside inline code spans when counting a
> statement's normative keyword.

## Evidence

```ts
// 2119: FIX-001.1.1
it("ignores keywords in inline code", () => {
  expect(findKeywords("The tool MUST work and ignore `MUST` here")).toEqual(["MUST"]);
});
```

## Why the correct verdict is FAIL

"Inline code spans" is a grammar (CommonMark), not a single production. The test covers only
single-backtick spans; the nearest counterexample — a double-backtick span ``` ``quoted MUST``
``` , which is a *valid* code span that may itself contain backticks — was counted as normative
and this test stayed green. When a requirement references a defined grammar, the test must probe
the grammar's edge productions, not its most common one.
