# Suggestions for larger or more formal projects

The defaults are tuned for a team that trusts its agents and reviews its own PRs. As the stakes,
headcount, or formality grow, add these — each is a recipe or a one-line config, in keeping with
[design.md](design.md)'s rule that heavyweight needs must not complicate the default path.

## Pin the exact version

A gate that floats its own version can change behavior with no repository change. Generated
hooks and CI already pin the version that generated them; for belt-and-suspenders, install it as
an exact dev dependency and route everything through package scripts:

```bash
npm install --save-dev --save-exact rfc2119
```

```json
{ "scripts": { "ci": "npm test && 2119 check" } }
```

Upgrades then arrive as reviewable lockfile diffs, not silent registry drift.

## Run your test suite as its own CI gate

2119 is not a test runner ([design.md](design.md)). CI must run both, as separate steps so
failures attribute cleanly:

```yaml
- run: npm test            # do the tests pass?
- run: npx --yes rfc2119@<pinned> check   # is every requirement traceably, honestly verified?
```

The workflow `init --ci` generates includes both steps.

## Protect specs and verdicts with CODEOWNERS

2119 enforces the spec as written — it cannot know when a requirement is *weakened* (a `MUST`
softened to `SHOULD`, a requirement tombstoned, evidence globs narrowed, `[manual]` added).
That's a Goodhart risk: once coverage is the target, editing the requirement is the cheapest way
to hit it. Make weakening conspicuous and human-gated:

```
# CODEOWNERS
/specs/           @your-org/spec-owners
/.2119/verdicts/  @your-org/spec-owners
```

Reviewers should treat any severity downgrade, tombstone, or coverage-tag change in a PR the way
they'd treat a CI-config change.

## Independent-runner reviews (real provenance)

By default, whoever runs `2119 pass` writes the verdict — including, potentially, the agent that
wrote the code (the residual risk in the README). For high-consequence requirements, move
verdict-writing to an identity the author cannot impersonate:

1. A CI job (or bot account) checks out the PR, runs `2119 review`, and dispatches each
   instruction file to a fresh agent session **it** controls.
2. That job records the verdicts and pushes the commit itself.
3. Branch protection requires that verdict commits for protected paths come from the bot.

The provenance is the **git committer identity on a protected branch** — enforced by your git
host, unforgeable by the authoring session, and requiring zero new fields in the verdict format.

## Explicit evidence globs for critical requirements

A bare `[review]` tag hashes only the requirement's text, so its verdict stands until the
requirement is reworded — appropriate for policy statements, too weak for anything whose truth
lives in code. For critical requirements, always name the evidence:

```markdown
3. Exports MUST strip other tenants' rows. [review: app/exports/**, lib/tenancy/**]
```

Now implementation edits invalidate the verdict, as they should.

## `shared_evidence` for shared fixtures and helpers

Test-quality hashing covers each annotated test's block and its file's prelude — but not helper
modules imported from *other* files. A shared fixture could change (or be neutered) without
invalidating the verdicts that depend on it. If your suite leans on shared helpers, list them:

```yaml
# .2119.yml
shared_evidence:
  - tests/helpers/**
  - tests/fixtures/**
```

Their content then joins every test-quality hash. The cost is honest churn: editing a shared
helper re-opens every dependent review, which is exactly what should happen.

## Periodic adversarial audits (cross-provider)

Fresh context is not fresh framing: reviewers sharing one model family and one instruction
template share blind spots. `2119 review --audit` generates adversarial instructions for every
currently-passing verdict — the auditor's job is to construct a mutant under which the
requirement is violated while the tests stay green, and a recorded `fail` flips the gate. As a
QA cadence: monthly, dispatched to a model from a **different provider** than your routine
reviewer. Between sweeps, audit individually the requirements that are particularly challenging
or high-consequence — multi-clause invariants, security boundaries, statistical formulas. The
first field deployment's sampled audit found rubber-stamps at a 2-in-12 rate; assume yours has
some too. (`audit: "always"` in `.2119.yml` runs audits on every review cycle — off by default,
since it multiplies review cost on every run.)

## `[verify]` policy for untrusted contributions

`[verify: <command>]` executes shell from spec files — the same trust level as `package.json`
scripts. That's fine when every spec author is trusted; it is not fine on CI that runs
third-party pull requests. For those repositories, run the gate as:

```bash
npx --yes rfc2119@<pinned> check --no-verify
```

`[verify]` requirements are then surfaced alongside `[manual]` exemptions instead of executed;
run the full `check` (with verify) only on trusted branches, or in a job gated on maintainer
approval.
