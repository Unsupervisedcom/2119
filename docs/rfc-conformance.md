# RFC 2119 / RFC 8174 Conformance

2119 takes its name from [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119),
so this document holds itself to a clause-by-clause accounting: every
normative statement in RFC 2119 (and its update, [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174))
is listed below with exactly how this tool implements, represents, or
deliberately scopes it out. Nothing is cherry-picked; where we diverge or
narrow, the reasoning is stated.

RFC 2119 is a Best Current Practice about *how specification authors use
requirement keywords*. 2119 (the tool) operationalizes it for software specs:
the RFC governs the writing; the tool enforces the writing and its
traceability to tests.

## Clause-by-clause

| RFC clause | What it says | How 2119 handles it |
|---|---|---|
| Abstract / boilerplate | Authors who follow these guidelines *should* incorporate the citation phrase near the beginning of their document. | Incorporated once at project level (the README carries the BCP 14 citation), not per spec file — a deliberate divergence stated in REQ-001.1.5. Reasoning: in an RFC the boilerplate binds keyword definitions for a standalone document; here the tool binds them mechanically for every spec, and spec files are agent context where ritual text costs attention on every read. The "document" being interpreted is the project's spec corpus, and its beginning is the README. |
| "the force of these words is modified by the requirement level of the document" | Keyword force is contextual per document. | The `enforce` set in `.2119.yml` is per-repository configuration: each project decides which severities demand test coverage (default: the absolute tier). |
| §1 MUST / REQUIRED / SHALL — absolute requirement | These three forms are equivalent and absolute. | All three are matched as keywords and all three are in the default `enforce` set — a `REQUIRED` or `SHALL` statement gets identical treatment to `MUST` (coverage demanded, judgment review of its tests). |
| §2 MUST NOT / SHALL NOT — absolute prohibition | Equivalent, absolute prohibitions. | Both compound forms match longest-first as single keywords (REQ-002.1.4) and both are in the default `enforce` set. |
| §3 SHOULD / RECOMMENDED — ignorable only with full implications weighed | Valid reasons may exist to ignore, but implications must be understood and carefully weighed. | Both forms are recognized. By default SHOULD-tier requirements do not *demand* test coverage — but they are never invisible: they participate in lint (exactly-one-keyword, concreteness), and a project that wants the RFC's "carefully weighed" bar enforced adds `SHOULD`/`RECOMMENDED` to `enforce` (REQ-002.2.6). The lint rule REQ-001.2.4 pushes SHOULD statements to carry concrete criteria so the weighing has something to weigh. |
| §4 SHOULD NOT / NOT RECOMMENDED | Same as §3, inverted. | Both recognized — including `NOT RECOMMENDED`, which the original RFC 2119 boilerplate omits but §4 defines and RFC 8174's updated boilerplate includes. Matched before `RECOMMENDED` so it is never miscounted. |
| §5 MAY / OPTIONAL — truly optional | Truly optional items. | Both recognized; never in the default `enforce` set, because demanding test coverage for "truly optional" items would contradict the clause. |
| §5 interoperability MUSTs | Implementations must interoperate whether or not an option is present. | Out of scope, stated plainly: this clause governs *protocol implementations negotiating options with each other*. 2119 is a specification-hygiene tool, not a protocol implementation; there is no peer to interoperate with. The nearest analogue is honored: a `MAY` requirement's absence never fails `check`. |
| §6 Imperatives used "with care and sparingly," only where required for interoperation or to limit harmful behavior — never to impose a method not required for the outcome | Guidance to spec authors. | REQ-001.2.5 encodes this as a SHOULD on spec content ("constrain observable outcomes, not implementation methods"), the init template and AGENTS.md guidance repeat it, and it is a judgment call by design — a linter cannot detect method-imposition, so it is left to spec review rather than pretending a grep can check it. |
| §7 Security Considerations | Authors should elaborate the security implications of not following requirements. | The init spec template carries an optional `## Security Considerations` section prompt, and REQ-001.1.6 makes elaborating security-relevant requirements a SHOULD. Not machine-checkable; deliberately guidance-plus-review, not lint. |
| §8–9 Acknowledgments / Author | Non-normative. | N/A. |

## RFC 8174 (BCP 14 update)

| RFC 8174 clause | What it says | How 2119 handles it |
|---|---|---|
| Keywords are normative **only when in UPPERCASE** | Lowercase "must"/"should" have their ordinary English meaning. | Implemented and contractual: keyword matching is case-sensitive (REQ-001.2.6, with a test proving lowercase forms are not counted). A statement whose only imperative is lowercase lints as "no RFC 2119 keyword," forcing the author to either capitalize (normative) or rephrase (prose). |
| Updated boilerplate citing both RFCs | The recommended citation phrase now references BCP 14, RFC 2119, and RFC 8174, and includes `NOT RECOMMENDED`. | The template boilerplate is the RFC 8174 version. |

## Known narrowings (stated, not hidden)

- **SHOULD-ignoring is not audited by default.** The RFC requires implications
  be "understood and carefully weighed" when a SHOULD is ignored; the tool
  cannot verify a state of mind. Projects wanting a hard record add SHOULD to
  `enforce`, which forces either a covering test or an explicit `[manual]` /
  `[review]` disposition per requirement.
- **§6 and §7 are review-guidance, not lint rules.** Both clauses require
  judgment about intent (is this method-imposition? is this security-relevant?).
  Encoding them as keyword lint would be exactly the "keyword theater" this
  tool exists to reject; they are carried as SHOULD requirements evaluated by
  spec review instead.
