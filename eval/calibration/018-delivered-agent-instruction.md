---
expected_verdict: pass
prompt: test-quality
source: issue #38
failure_mode: delivered instruction mistaken for irrelevant prose pinning
---

## Requirement

> The generated agent workflow MUST instruct the agent to run the final check.

## Evidence

```ts
// 2119: FIX-001.1.1
init(fixture);
expect(readFileSync(join(fixture, "AGENTS.md"), "utf8")).toContain("run `npx rfc2119 check`");
```

## Why the correct verdict is PASS

`AGENTS.md` is the delivered product surface that controls agent behavior. The assertion pins only
the required instruction, not its heading order or unrelated prose.
