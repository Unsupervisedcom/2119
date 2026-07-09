# REQ-005: Bespoke Validation

## Overview

Most requirements are validated by the standard loop: annotated tests plus a
judgment review. Two escape hatches cover the cases that loop can't express
while keeping the requirement as the anchor:

- **Custom review instructions** — when the judgment criteria outgrow a
  one-sentence requirement, a `[review]` tag can reference an instruction file
  whose content extends the reviewer's brief. Because criteria are part of
  what a verdict vouches for, the instruction file's content participates in
  the review-ID hash: editing the criteria invalidates prior verdicts.
- **Deterministic verify commands** — when a requirement is machine-checkable
  but not a unit test (a sync invariant, a generated-file freshness check),
  a `[verify: <command>]` tag runs a shell command whose exit status is the
  validation. This borrows DeepWork's `verification_bash_command` idea at
  per-requirement granularity.

Verify commands execute arbitrary shell from spec files. They carry the same
trust level as `package.json` scripts: repository-controlled code that
contributors already implicitly run.

## Requirements

### REQ-005.1: Custom review instructions

1. A `[review]` tag MUST accept an `instructions: <path>` entry alongside its globs (e.g. `[review: docs/**, instructions: .2119/review/db-policy.md]`), with the path resolved from the repository root.
2. The instruction file's content MUST be included in the review-ID hash input, so editing the criteria invalidates existing verdicts.
3. Generated review instruction files MUST inline the custom instructions under their own section, so the reviewer needs no additional fetches.
4. A `[review]` tag referencing a nonexistent instruction file MUST produce a check violation naming the requirement ID and the missing path.

### REQ-005.2: Deterministic verify commands

1. A requirement whose statement ends with `[verify: <command>]` MUST be validated by running the command from the repository root, where exit status 0 means the requirement is satisfied.
2. `2119 check` MUST run the verify command of every enforced verify-tagged requirement and report each non-zero exit as a violation containing the requirement ID and the command's output.
3. Verify commands MUST be terminated and reported as failures if they exceed a 30-second timeout.
4. Verify-tagged requirements MUST be exempt from test-annotation coverage and judgment reviews, since the command is their validation mechanism.
5. A `[verify]` tag with no command MUST be reported as a lint violation.
6. The documentation MUST state that verify commands execute arbitrary shell from spec files and carry the same trust level as package scripts. [review: README.md]
