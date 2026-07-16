<!-- 2119:begin -->
## Requirements workflow (2119)

This repository enforces spec-driven testing with [2119](https://www.rfc-editor.org/rfc/rfc2119).

**When planning a feature**, write or update a spec in `specs/` first. Every
requirement is a numbered item under a `### REQ-NNN.M` heading with exactly one
RFC 2119 keyword. Run `npx rfc2119 lint` after editing specs.

**When implementing**, every MUST/SHALL requirement needs at least one test
annotated with a comment containing its ID, e.g. `// 2119: REQ-001.2.3`.
Write tests that would genuinely fail if the requirement were violated — a
fresh-context reviewer will judge each test's honesty, and tautological or
over-mocked tests will be rejected.

**Before finishing any task**, run `npx rfc2119 check`. It must exit 0. If it
reports pending judgment reviews, run `npx rfc2119 review` and dispatch each
instruction file in `.2119/reviews/` to a fresh-context subagent (never
review your own work in the same context). CI runs the same check, so skipping
it locally only defers the failure.
<!-- 2119:end -->
