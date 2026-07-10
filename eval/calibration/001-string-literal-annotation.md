---
expected_verdict: fail
prompt: test-quality
source: external audit (GPT-5.6), 2119 repo, 2026-07-10
failure_mode: A — boundary term "comment" never falsified
---

## Requirement

> A test annotation MUST be recognized as a comment containing `2119: <ID>` in any file matched
> by the configured test globs, making the convention language-agnostic.

## Evidence

```ts
// 2119: REQ-002.2.2
it("recognizes annotations across comment styles", () => {
  const re = buildAnnotationRegex("REQ");
  expect(re.test("# 2119: REQ-001.1.1")).toBe(true);     // Python
  expect(re.test("// 2119: REQ-001.1.1")).toBe(true);    // JS
  expect(re.test("/* 2119: REQ-001.1.1 */")).toBe(true); // C-style
});
```

## Why the correct verdict is FAIL

The requirement's load-bearing word is **comment**. The test proves three comment styles are
*accepted* but never proves a non-comment is *rejected*. The nearest counterexample —
`const fake = "2119: REQ-001.1.1"` (a string literal) — satisfied the scanner and produced false
coverage, and this test stayed green. A passing review must name a rejected counterexample for
the boundary term "comment"; none exists here.
