# Design decisions and non-goals

2119's boundaries are load-bearing. Each stance below is deliberate, and each is enforced as a
`[review]`-covered requirement in [`specs/REQ-008-honest-boundaries.md`](../specs/REQ-008-honest-boundaries.md),
so this document is judged against the shipped tool on every change — it cannot quietly drift
into marketing.

## 2119 is not a test runner

`2119 check` never executes your test suite. It answers a different question: *is every
requirement traceably verified by tests that a fresh-context reviewer judged honest?* Your test
runner answers *do the tests pass?* Both questions matter and neither substitutes for the other —
a repo can be fully traceable with failing tests, or fully green with tests that verify nothing.
Compose them: `npm test && npx rfc2119 check` (or your language's equivalent). The CI workflow
`init --ci` generates carries a separate project-test step for exactly this reason.

Why not run the tests ourselves? Because every ecosystem already has a test runner it trusts,
and wrapping them all would make 2119 large, opinionated, and wrong somewhere forever. One exit
code that composes beats a framework that absorbs.

## 2119 composes with CI; it does not replicate it

There is no 2119 server, dashboard, queue, or bot. The entire enforcement surface is a CLI exit
code, which means anything that can run a command — an agent hook, a git hook, any CI vendor —
is already integrated. Platform adapters only change *when* an agent hears about a failure,
never *whether* the gate holds.

## 2119 is not a security boundary

No local tool can stop an agent that controls the shell from running `2119 pass` on its own
work. 2119's anti-cheat is **governance with visibility**: verdicts are committed and auditable,
hash invalidation makes stale or pre-computed approvals stop counting, and CI re-runs the same
check. That defeats accidental process collapse and makes deliberate cheating *conspicuous* — it
does not make it impossible. If you need a hard trust boundary, see the independent-runner
pattern below; do not get one by pretending a local CLI can provide it.

## Verdicts are committed audit documents, not attestations

A verdict file records what a reviewer concluded and vouches for exact content (its hash). We
deliberately rejected adding reviewer identity, model name, or provenance fields to the record:
**self-reported provenance is unenforceable decoration.** The agent that writes the verdict
writes the fields, so they would add audit theater — exactly the keyword-theater failure mode
this tool exists to catch in tests. Where real provenance is needed, it comes free from git: in
the **independent-runner pattern**, a CI job or bot account that the authoring agent cannot log
in as re-dispatches the judgment reviews and commits the verdicts itself. The committer identity
on a protected branch *is* the attestation — enforced by your git host, not by fields anyone can
type. This is presented as a **reference architecture** — the recipe in [`scaling.md`](scaling.md)
describes the shape; an executable example has not shipped yet, and we say so rather than
overclaim "supported."

## Specs are agent context; ritual text is banned

Every line in a spec file is read by agents on every relevant task, so every line must change
agent behavior. Boilerplate (like the BCP 14 citation) lives once at project level, not in every
file. Requirements have real marginal cost here — coverage, review, churn — so each one must
clear the bar: *would an agent write worse code without this sentence?*

## Simplicity is a feature requirement

The default path — `init`, write specs, annotate tests, `check` — must stay learnable in ten
minutes and fast enough for a write-time hook. Rare or heavyweight needs get **escape hatches**
(a config key, a CLI flag, a documented recipe), never additions to the default path. Applied
examples: `--no-verify` is a flag on the CI invocation where the untrusted-PR risk lives, not a
sandbox subsystem; `shared_evidence` is one optional config key, not a dependency analyzer;
independent review is a recipe, not a server. When an edge case can't be solved without
degrading the normal experience, we document the limitation honestly instead.
