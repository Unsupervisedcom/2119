---
expected_verdict: pass
prompt: test-quality
source: accretion study (2119#38), 2026-10 (synthetic)
failure_mode: legitimate exception — negative-space table over genuinely distinct shapes
---

## Requirement

> The parser MUST reject malformed transcripts with a diagnostic naming the offending line.

## Evidence

```ts
// 2119: REQ-002.3.1
it.each([
  ["truncated header", "TRANSCT\n"],
  ["missing separator", "HEADER body\nBODY without break"],
  ["bad ordinal", "#5 Event without preceding #4"],
  ["unclosed quote", 'SAY "never finished'],
  ["negative span", "SPAN -1..3"],
])("rejects %s and names the line", (_shape, text) => {
  expect(() => parseTranscript(text)).toThrow(/line \d+/);
});
```

## Why the correct verdict is PASS

Unlike the redundant-matrix case, these parameter values exercise meaningfully different
behavior: each shape reaches a different rejection path in the parser (header validation,
structure, ordering, tokenization, bounds), so this is negative-space enumeration over a defined
input language, not bulk. Universal wording ("malformed") cannot imply these cases, which is
precisely why an explicit table of distinct malformed shapes is justified. The reviewer confirms
each row reaches a distinct path rather than collapsing the table with the Cartesian anti-pattern.
