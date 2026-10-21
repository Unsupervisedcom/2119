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

## `evidence_groups` for scoped helper invalidation

A universal `shared_evidence` list couples every review to every shared file. Declare per-feature
groups when most helpers serve one feature, keeping the global list for genuinely universal
helpers:

```yaml
# .2119.yml
shared_evidence:
  - tests/helpers/**          # universal: joins every test-quality hash
evidence_groups:
  storage:
    tests: ["tests/storage/**"]
    evidence: ["helpers/storage.ts", "fixtures/storage/**"]
  parser:
    tests: ["tests/parser/**"]
    evidence: ["helpers/parser.ts"]
```

A requirement's review hash then includes only the groups its covering tests belong to, so
changing a storage helper re-opens storage reviews and leaves parser reviews current. The
declared globs themselves join the hash: adding, removing, or editing a mapping invalidates the
verdicts that depended on it, so a dependency cannot be quietly dropped under an old approval. A
group whose `tests` or `evidence` globs match no files fails `check` loudly — a typo must not
read as coverage. Cosmetic glob reordering does not invalidate: the declaration is canonicalized
before hashing.

The integrity caveat is the mapping's own reviewability. A group is a declared dependency
boundary; a helper the tests really use but no group declares (and no global list covers) keeps
old approvals alive across edits to itself. Review `evidence_groups` changes like code: the globs
are a claim about what the evidence depends on. Groups do not attempt semantic change detection
and never delete evidence; they only make invalidation match the declared boundary.

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

## Measured baselines

Wall-clock for the full deterministic gate (`time npx -y rfc2119 check`, Apple
M-series, rfc2119 0.7.0, measured 2026-08; "cold" includes npx package
resolution):

| Corpus | Scale | `check` wall time |
|---|---|---|
| Production application (private) | ~5,400 tracked files, ~600k lines incl. subprojects; sparse specs, 110 committed verdicts (hash verification in path) | ~1.4s steady, ~2.7s cold |
| Subproject of the same application (private) | 84 files, ~40k lines | ~1.0s |
| Synthetic dense corpus (reproducible) | 100 spec files · 3,000 MUST requirements · 2,000 annotated test files, ~300k lines; judgment layer disabled | ~1.7–2.0s steady |

The spread is the point: a sparse-specced production codebase and a corpus
with 3,000 requirements land within a second of each other, because the walk
and parse are the cost and both are bounded — spec/annotation volume, not
repository size, is what you are budgeting. All three sit well inside the
enforced sub-5-second perf requirement.

To regenerate the synthetic corpus: 100 spec files of 5 sections × 6
single-keyword MUST items each; 2,000 test files of ~150 lines, each opening
with one section-level annotation (`// 2119: REQ-0NN.M`); `reviews: false` in
`.2119.yml`. Numbers rot with hardware and versions — re-measure on yours
before relying on them.
