---
expected_verdict: fail
prompt: test-quality
source: accretion study (2119#38), 2026-10 (synthetic)
failure_mode: false rigor — Cartesian matrix over dimensions that do not interact
---

## Requirement

> Uploaded files larger than the configured limit MUST be rejected with a 413 response.

## Evidence

```ts
// 2119: REQ-004.2.1
it.each(
  [1, 4, 16, 64].flatMap((mb) =>
    ["csv", "json", "png", "pdf", "zip"].map((ext) => [`${mb}mb.${ext}`, mb, ext]),
  ),
)("rejects oversized %s", (_name, mb, ext) => {
  const res = upload(bigFile(mb, ext), LIMIT_MB);
  expect(res.statusCode).toBe(413);
});
```

A previous test already covers the rejection with two cases straddling the limit.

## Why the correct verdict is FAIL

Twenty parameter cases re-spell one branch: nothing in production makes the file extension
interact with the size limit, so the matrix adds no discriminating evidence over the existing
boundary test — it is bulk added for traceability. Parameter sets are judged by the meaningfully
distinct behavior they exercise, not by size, and universal wording never obligates exhaustive
cases. The requirement's real negative space (a file exactly at the limit; a changed limit
honored without restart) is never probed.
