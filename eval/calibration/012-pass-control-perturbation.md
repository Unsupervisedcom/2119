---
expected_verdict: pass
prompt: test-quality
source: 2119 repo, praised by two independent external audits
failure_mode: none — control case
---

## Requirement

> A review ID MUST be derived from the requirement statement text plus each covering
> annotation's evidence block, so editing an unrelated test in a shared file does not invalidate
> the verdict while editing the covered test or the requirement does.

## Evidence

Production provenance: this condensed case is taken from
`tests/review.test.ts:84`, with the independent perturbation assertions at
`tests/review.test.ts:94`, `tests/review.test.ts:100`, and
`tests/review.test.ts:104`. Those lines invoke the production review-ID
computation through `gearTargets` (`tests/review.test.ts:78`).

```ts
// 2119: FIX-001.1.1
it("scopes review IDs to evidence blocks", () => {
  const before = targets(lines);
  lines[6] = "test('other', () => { changed() })";   // unrelated test in same file
  const afterB = targets(lines);
  expect(afterB["A"]).toBe(before["A"]);              // A stable
  expect(afterB["B"]).not.toBe(before["B"]);          // B invalidated
  lines[3] = "test('covered', () => { changed() })";  // the covered test itself
  expect(targets(lines)["A"]).not.toBe(afterB["A"]);  // A invalidated
  expect(idFor("text A")).not.toBe(idFor("text B"));  // requirement text in hash
});
```

## Why the correct verdict is PASS

Every clause of the requirement is individually falsified by a perturbation: unrelated-edit
stability, related-edit invalidation, and requirement-text participation each have an assertion
that fails if that clause breaks. Both directions (stability AND invalidation) are probed — the
negative space is closed. This is the shape reviews should demand.
