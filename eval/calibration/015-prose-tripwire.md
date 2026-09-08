---
expected_verdict: fail
prompt: test-quality
source: issue #38
failure_mode: prose tripwire mistaken for behavioral evidence
---

## Requirement

> The generated help MUST tell users how to select an output format.

## Evidence

```ts
// 2119: FIX-001.1.1
expect(readFileSync("specs/FIX-001-help.md", "utf8")).toContain("select an output format");
```

## Why the correct verdict is FAIL

The assertion reads the specification, not the delivered help surface. A wording-only edit breaks
it while removing the product behavior does not.
