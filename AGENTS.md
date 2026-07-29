<!-- 2119:begin -->
## Requirements workflow (2119)

This repository enforces spec-driven testing with [2119](https://www.rfc-editor.org/rfc/rfc2119).

**When planning a feature**, write or update a spec in `specs/` first. Every
requirement is a numbered item under a `### REQ-NNN.M` heading with exactly one
RFC 2119 keyword, stating an observable outcome — not an implementation
mechanism. Run `npx rfc2119 lint` after editing specs. **Before writing tests
against a new spec**, dispatch a fresh-context reviewer to critique the draft
requirements themselves: outcome-stated, individually testable, one obligation
each. A flawed requirement steers the whole implementation wrong.

**Requirement granularity**: A first-pass feature spec should aim for around
3–8 enforced `MUST` requirements. Prefer workflow-level requirements (what the
user can observably do) over implementation-step requirements (how the code
achieves it). Spec sizing smells — reconsider the spec if: one feature produces
more than ~10 enforced requirements before tests exist; most requirements
restate internal steps rather than user-visible outcomes; a single test would
cover many requirements at once; or requirements say "MUST cover" or "MUST test"
instead of describing product behavior. Use `SHOULD` for polish and edge cases,
`[manual]` for UI-only behaviors, and notes or acceptance-checklist bullets for
implementation details rather than making every detail an enforced `MUST`.

**When implementing**, every MUST/SHALL requirement needs at least one test
annotated with a comment containing its ID, e.g. `// 2119: REQ-001.2.3` (the
marker line must start with a comment leader). Write tests that would genuinely
fail if the requirement were violated — including its negative space: what the
requirement forbids needs a rejection test, not just what it allows. A
fresh-context reviewer judges each test's honesty; tautological or over-mocked
tests will be rejected.

**Reviewer diversity**: use reviewer models from different providers, routinely
or as periodic `npx rfc2119 review --audit` sweeps — adversarial audits of
passing verdicts. Audit especially the challenging or high-consequence
requirements; a single model family shares blind spots.

**Before finishing any task**, run `npx rfc2119 check`. It must exit 0. If it
reports pending judgment reviews, run `npx rfc2119 review --dispatch` and
dispatch each instruction file in `.2119/reviews/` to a fresh-context subagent
(never review your own work in the same context). CI runs the same check, so
skipping it locally only defers the failure.
<!-- 2119:end -->
