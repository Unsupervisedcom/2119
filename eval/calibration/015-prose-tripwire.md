---
expected_verdict: fail
prompt: test-quality
source: accretion study (2119#38), 2026-10 (synthetic)
failure_mode: false rigor — exact-prose pin standing in for behavioral evidence
---

## Requirement

> The CLI MUST print a top-level `--help` flag listing its subcommands.

## Evidence

```ts
// 2119: REQ-007.1.1
it("help output matches the README word for word", () => {
  const help = runCli(["--help"]);
  const readme = readFileSync("README.md", "utf8");
  for (const line of readme.split("\n").filter((l) => l.startsWith("`2119 "))) {
    expect(help).toContain(line.replace(/`/g, ""));
  }
});
```

## Why the correct verdict is FAIL

The assertion pins documentation wording, not behavior. Rephrase the README — a legitimate,
non-violating change — and the test breaks even though the CLI still lists every subcommand;
that is exactly the survival probe the reviewer runs alongside the counterexample probe. The
behavioral evidence is an assertion against the CLI's observable output (each subcommand
present with a description), not against prose or a digest of files the requirement does not
govern. Evidence whose only value is pinning wording, layout, or hashes must be rejected.
