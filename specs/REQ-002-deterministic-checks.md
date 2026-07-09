# REQ-002: Deterministic Checks (lint, cover, check)

## Overview

The deterministic layer is 2119's foundation: checks that parse specs and tests
exactly, produce machine decisions with no judgment involved, and run
identically from an agent hook, an agent's own shell command, or CI. Because
`2119 check` is a plain exit code, it is the one enforcement surface no agent
can talk its way past.

Three commands make up this layer: `2119 lint` (spec format), `2119 cover`
(requirement-to-test traceability), and `2119 check` (everything, including
review verdict freshness from REQ-003).

## Requirements

### REQ-002.1: Spec linting

1. `2119 lint` MUST validate every spec file against all REQ-001.1 and REQ-001.2 structure rules while ignoring headings, list items, and keywords that appear inside fenced code blocks or inline code spans.
2. `2119 lint` MUST ignore RFC 2119 keywords that appear inside inline code spans when counting a statement's normative keyword.
3. `2119 lint` MUST exit non-zero when any violation is found, printing each violation with file path, line number, and the violated rule's requirement ID.
4. `2119 lint` MUST treat compound keywords as single keywords, matching longest-first (e.g. `MUST NOT` is one keyword, not `MUST` plus a word).

### REQ-002.2: Coverage checking

1. `2119 cover` MUST require, for every requirement whose keyword severity is enforced (default: `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `REQUIRED`) and whose coverage is test coverage, at least one test annotation referencing its exact requirement ID.
2. A test annotation MUST be recognized as a comment containing `2119: <ID>[, <ID>...]` in any file matched by the configured test globs, making the convention language-agnostic.
3. `2119 cover` MUST fail when an annotation references a requirement ID that does not exist in any spec (unless that requirement is tombstoned as `REQUIREMENT REMOVED`).
4. `2119 cover` MUST fail when an enforced requirement has zero covering annotations, listing every uncovered requirement ID and its statement text.
5. An annotation referencing a section ID (e.g. `REQ-002.1`) MUST count as covering every requirement item within that section.
6. `2119 cover` SHOULD support a configurable severity set in `.2119.yml` so projects can also enforce coverage for `SHOULD`-level requirements.

### REQ-002.3: The check command

1. `2119 check` MUST run lint, cover, review-verdict freshness (REQ-003.3), and verify commands (REQ-005.2), exiting non-zero if any of them fail.
2. `2119 check` MUST complete in under 5 seconds on a repository with 100 spec files and 2000 test files, excluding time spent inside user-defined `[verify]` commands, so it is cheap enough to run from write-time hooks. [review: src/**]
3. `2119 check --json` MUST emit a machine-readable report (violations, uncovered requirements, stale verdicts, manual requirements) for use by hooks and CI annotations.
4. When invoked with `--changed`, `2119 check` SHOULD scope test-collection and lint work to files changed relative to the merge-base with the default branch, mirroring local git detection only (no network).

### REQ-002.4: Configuration

1. 2119 MUST read configuration from `.2119.yml` at the repository root, with every field optional and sensible defaults (specs at `specs/**/*REQ-*.md`, tests at common test globs, prefix `REQ`).
2. Running any command in a repository with no `.2119.yml` and no spec files MUST produce a clear "not initialized" message pointing at `2119 init`, not a zero-requirement pass.
