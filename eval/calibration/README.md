# Reviewer calibration corpus

Every case here is a **known review escape** (or a known-good control): a requirement, the
evidence a reviewer saw, and the verdict a correct reviewer must reach. Together they make the
judgment layer's quality a measured quantity instead of a matter of taste (REQ-003.8).

**The ratchet:** when a defect passes review and is caught later — by meta-review, a cross-model
audit, or the field — it becomes a case here, the instruction template gains whatever clause
catches its class, and REQ-003.8.2 forbids any future template change that would lose the catch.
The review layer only drifts upward.

**Uses:** (1) regression bed for template changes; (2) task set for SkillOpt-style optimization
runs (the template is the trainable document, `expected_verdict` is the scorer, and a held-out
split gates acceptance — see `docs/calibration-ratchet` notes); (3) the destination for every
future escape.

**Format:** one markdown file per case with a small YAML frontmatter
(`expected_verdict: pass|fail`, `prompt: test-quality|audit|requirement`, `source`, `failure_mode`)
followed by `## Requirement`, `## Evidence`, and `## Why` sections. Evidence is condensed and,
for field-sourced cases, sanitized to neutral code — the pattern is the payload, not the origin.

Cases from the first field deployment (2026-07-10) and the first external audits are seeded
below. Mode A = positive-space bias (accepting behavior tested, forbidden behavior never
probed). Mode B = requirement states mechanism, not outcome.
