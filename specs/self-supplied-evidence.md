# Self-Supplied Evidence in Judgment Reviews

## Overview

Test-quality reviews can approve a passing test whose decisive evidence was supplied by the
checker, fixture, or prompt rather than by the production system. Such a test is internally
consistent but cannot establish the production property: a fixture may invent a field the real
producer omits, a test may emit the signal its watcher is meant to observe, a prompt may prescribe
the identity a report claims, an undeclared tool may exist only because the live agent installed
it, or an initial sentinel may overlap a real runtime value.

This feature changes the generated, per-requirement test-quality review instructions. It does not
try to infer boundary crossings from requirement keywords: that would recreate the project's
keyword-grep anti-pattern and still miss implicit boundaries. Instead every reviewer answers one
short independence question, and only reviewers who identify a producer/consumer or
gate/environment boundary pay for a second question. Both answers demand `file:line` evidence so
the decision remains checkable in fresh context.

The candidate rules were evaluated as follows:

- **Provenance of inputs survives, conditionally.** At a producer/consumer boundary, an honest
  test must exercise an input the production producer can actually emit. Requiring this of every
  test would burden pure functions and internal state transitions, so it is activated only when
  the reviewer identifies that boundary.
- **Provenance of claims survives in generalized form.** A self-report, readiness signal, cache
  state, or other decisive observation must be independent of the test setup or parameter that
  asks for the claim. This is not limited to systems literally describing themselves; the broader
  independence question also catches signal injection and sentinel/value collisions.
- **Declared environment survives, conditionally.** A test of a gate with an external binary or
  service must connect the dependency to its production provisioning declaration and to the
  production absence failure. Like input provenance, this applies only when the reviewer finds
  such a boundary.
- **Literal-input lint is rejected for now.** Literals are legitimate at many boundaries, while
  factory-built objects can be equally fictional. Syntax alone cannot decide provenance. The
  generated reviewer can trace values across `file:line` evidence. Viable future tooling has two
  shapes: use explicit machine-readable producer metadata, or enumerate the real artifact set
  (for example, routes on the composed app, shell files that reference a service URL, or registered
  harnesses) and assert the property over every discovered member. Such a sweep must treat an empty
  result as an error; a silently empty glob would merely reproduce self-supplied evidence inside
  the lint. Neither approach should guess provenance from literal or factory syntax.

Later fleet evidence exposed a neighboring failure class: **scope inflation**. One honest test
captured real runtime arguments for one shell library, but its committed verdict claimed that
plural “shell libraries” were exercised; two unenumerated callers included a live security defect.
The provenance questions in this spec intentionally do not claim to catch that case: production
can reach the tested failure, and the test's evidence for that one caller is independent and real.
What is false is the judgment's generalization from one set member to the category. A conditional
question asking a reviewer to enumerate plural or categorical subjects is the wrong instrument:
the reviewer's enumeration would itself be an unverified claim capable of the same generalization
error. Reliable scope completeness requires tooling that mechanically enumerates the real artifact
and fails when enumeration returns no members. That separate commitment is tracked in
[issue #17](https://github.com/Unsupervisedcom/2119/issues/17). Adding it here would also lengthen
every test-quality review with a third concern that is neither input provenance nor self-supplied
evidence. Recording the boundary prevents a future author from assuming this feature covers scope
inflation or adding the analytical question casually.

The motivating verdict also contained a cheaper, locally decidable wording defect: evidence for
the named file `task_lib.sh` was summarized as coverage of plural “shell libraries.” Preventing that
promotion does not require discovering the full set. This spec therefore constrains verdict-writing
guidance, not the review analysis: a conclusion preserves the concrete subject names and cardinality
of the evidence it cites. The rule applies to both test-quality and direct-judgment instructions,
adds no question, and does not alter the independence or conditional-boundary decisions above. It
cannot establish category completeness—that remains issue #17—but it prevents a verdict from
claiming category completeness when its own cited evidence is only member-specific.

Two additional auth failures do fall within this spec. A test that merely found a credential
template string, instead of executing the shell and capturing its arguments, cannot satisfy the
production-reachability and independent-observation obligation in 1.2. Tests that called
`create_app()` only with explicit keyword arguments, while production used environment variables
through `build_app()`, cannot satisfy 2.2's requirement to obtain boundary input through the real
production producer; the unexercised fail-open default is precisely the production failure 1.1
requires the reviewer to name.

The cheap proposed question — name the production failure and confirm production can produce it —
is the universal core. The added conditional questions make “confirm” decidable. A
producer/consumer boundary exists here only when the behavior consumes a value emitted by a
separately invoked production component or production data source; an ordinary call between units
inside the behavior under test is not enough. A runtime-environment boundary exists when the gate
invokes a binary or service outside its own process. These definitions trigger focused provenance
traces without making every pure unit test pay the cost.

This feature's own acceptance tests invoke the built CLI's real `review --dispatch` workflow
against this checked-in file-scoped spec and its annotated tests, then inspect instructions that
workflow actually writes. They do not satisfy coverage by directly calling the instruction
renderer with a hand-built requirement or by asserting against a separately copied prompt fixture.
Thus the production parser, coverage resolver, review-target computation, and instruction writer
supply the artifacts under assertion.

## Requirements

### 1: Independent production failure

1. Each generated test-quality review instruction MUST require the reviewer to name a concrete production failure the covering test would catch.
2. Each generated test-quality review instruction MUST require `file:line` evidence that production can reach the named failure without the test, its fixtures, or its prompts supplying the triggering input or decisive observation.

### 2: Conditional boundary provenance

1. Each generated test-quality review instruction MUST define a producer/consumer boundary as consumption of a value emitted by a separately invoked production component or production data source.
2. Each generated test-quality review instruction MUST require the reviewer, whenever a producer/consumer boundary exists, to cite `file:line` evidence that the covering test obtains its input through that production producer.
3. Each generated test-quality review instruction MUST require the reviewer, whenever a producer/consumer boundary exists, to cite `file:line` evidence that the input exercised by the covering test preserves the production producer's value shape.
4. Each generated test-quality review instruction MUST require the reviewer, whenever the decisive observation can equal an initial, default, placeholder, or sentinel value, to cite `file:line` evidence that the covering test distinguishes a newly produced observation from that pre-existing value.

### 3: Declared runtime environment

1. Each generated test-quality review instruction MUST define a gate/runtime-environment boundary as invocation of a binary or service outside the gate's own process.
2. Each generated test-quality review instruction MUST require the reviewer, whenever a gate/runtime-environment boundary exists, to cite `file:line` evidence of both the dependency's production provisioning declaration and the production path that fails when the dependency is absent.

### 4: Decidable verdicts

1. Each generated test-quality review instruction MUST direct the reviewer to fail the judgment when any provenance evidence required by its applicable questions is absent or shows that production cannot produce the claimed failure independently of the test setup.

### 5: Scope

1. Generated direct-judgment instructions for `[review]` requirements MUST remain exempt from the test-quality provenance questions.

### 6: Lint compatibility

1. Requirement linting MUST NOT report a provenance violation solely because a covering test constructs an input with literal or factory syntax.

### 7: Evidence-bounded verdict wording

1. Each generated review instruction MUST direct the reviewer to keep the verdict summary's subject no broader than the cited evidence, preserving concrete member names and singular or plural scope instead of promoting member-specific evidence into a category claim.
