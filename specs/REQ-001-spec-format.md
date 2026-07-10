# REQ-001: Requirements Document Format

## Overview

2119 enforces a structured format for requirements documents ("specs") so that
requirements are individually addressable, machine-parseable, and stable over
time. This file defines that format. It is itself written in the format it
defines, and 2119's own checks run against it.

Specs live in `specs/` by default (configurable via `.2119.yml`) and are named
`REQ-NNN-<topic>.md`, where `NNN` is any positive integer — `REQ-1` is as valid
as `REQ-001`. Zero-padding is recommended purely for lexicographic file
ordering; it carries no meaning, and the load-bearing invariant is ID stability
and exact-match uniqueness, not digit width. An optional project prefix
(e.g. `DW-REQ-NNN`) may be configured.

RFC 2119 keywords appearing inside inline code spans (backticks) are treated as
quoted text, not as the statement's normative keyword. Example phrases and
keyword lists below use backticks for this reason.

## Requirements

### REQ-001.1: Document structure

1. A spec file MUST begin with a top-level heading of the form `# REQ-NNN: Title` whose `REQ-NNN` matches the filename prefix.
2. A spec file MUST contain an `## Overview` section before the `## Requirements` section.
3. A spec file MUST contain a `## Requirements` section composed of one or more `### REQ-NNN.M: Title` subsections.
4. Every `### REQ-NNN.M` heading in a file MUST use the same `NNN` as the filename, with `M` values unique and sequential starting from 1.
5. The BCP 14 boilerplate citation SHOULD live once in project-level documentation (README or `docs/rfc-conformance.md`) rather than in each spec file, keeping spec files free of ritual text that costs agent context.
6. A spec file SHOULD elaborate the security implications of its security-relevant requirements, per RFC 2119 §7.
7. Two spec files MUST NOT declare the same document ID, so every requirement ID resolves to exactly one obligation.

### REQ-001.2: Requirement statements

1. Each requirement MUST be a numbered list item within a `### REQ-NNN.M` section, giving it the stable ID `REQ-NNN.M.K` where `K` is its list position.
2. Each requirement statement MUST contain exactly one RFC 2119 keyword outside inline code spans (`MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `NOT RECOMMENDED`, `MAY`, `OPTIONAL`, `REQUIRED`).
3. Requirement items within a section MUST be numbered sequentially starting from 1, with no gaps or duplicates.
4. Each requirement SHOULD state a concrete, evaluable criterion rather than a vague quality (e.g. `MUST respond in under 200ms`, not `MUST be fast`).
5. A requirement SHOULD constrain observable outcomes rather than impose an implementation method that is not required for the outcome, keeping imperatives sparse per RFC 2119 §6.
6. RFC 2119 keywords MUST be recognized as normative only in UPPERCASE form, with lowercase occurrences treated as ordinary prose, per RFC 8174.

### REQ-001.3: Requirement ID stability

1. An existing requirement's ID MUST NOT be renumbered or reassigned to a different obligation. [verify: node scripts/verify-id-stability.mjs]
2. New requirements MUST be appended at the end of their section (or in a new section) with the next sequential number. [verify: node scripts/verify-id-stability.mjs]
3. A removed requirement MUST keep its number, with the statement body replaced by the exact text `REQUIREMENT REMOVED`, so that external references (tests, verdicts) never dangle. [verify: node scripts/verify-id-stability.mjs]

### REQ-001.4: Coverage declarations

1. A requirement whose statement ends with a `[review]` or `[review: <globs>]` tag MUST be validated by a judgment review instead of a test (see REQ-003).
2. A requirement whose statement ends with a `[manual]` tag MUST be exempt from automated coverage checking, with manual requirements surfaced in the `2119 check` summary rather than silently skipped.
3. Requirements without a coverage tag MUST default to test coverage (see REQ-002).
