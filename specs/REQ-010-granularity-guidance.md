# REQ-010: Requirement Granularity Guidance

## Overview

When agents draft a first-pass feature spec, 2119 should encourage workflow-level
requirements and warn against exploding a single feature into many
implementation-step `MUST`s. Without guidance, an agent can over-decompose one
feature into dozens of independently enforced requirements, making the
`cover`/`review` cycle disproportionately heavy before the team has even decided
which behaviors are core product promises versus implementation details, UI
polish, or manual acceptance criteria.

This spec governs the granularity guidance that 2119 surfaces in three places:
the generated AGENTS.md workflow section, the starter spec template, and the
README. All three should consistently nudge agents toward a small, user-meaningful
enforced surface that teams can grow incrementally.

## Requirements

### REQ-010.1: Agent instruction guidance

1. The AGENTS.md section MUST include guidance recommending around 3–8 enforced `MUST` requirements for a first-pass feature spec, with the rationale that workflow-level requirements are preferred over many implementation-step requirements.
2. The AGENTS.md section MUST include spec sizing smells — identifiable symptoms that a spec may be over-decomposed — such as a single feature producing more than ~10 enforced requirements before tests exist, requirements that restate internal implementation steps, or requirements that say "`MUST` cover" or "`MUST` test" instead of describing product behavior.

### REQ-010.2: Spec template structure

1. The starter spec template MUST include a dedicated section for core user workflows as `MUST` requirements.
2. The starter spec template MUST include a notes and non-goals section outside the `## Requirements` block, to give authors a designated place for implementation details and deferred polish rather than turning them into enforced requirements.

### REQ-010.3: README guidance

1. The README MUST include a requirement granularity section with guidance on appropriate scope for first-pass feature specs and examples of well-scoped versus over-decomposed requirements. [verify: node -e "const s = require('fs').readFileSync('README.md','utf8'); if (!s.includes('Requirement granularity')) process.exit(1)"]
