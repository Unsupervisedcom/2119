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

REQ-002.3.4 (a `--changed` flag) was removed unbuilt: coverage is a whole-repo
property in both directions — an unchanged test can cover a changed requirement
— so scoping the scan to git-changed files cannot answer "is everything
covered" and would quietly weaken what `check` means. If large-repo performance
ever becomes real (full `check` runs in ~0.2s here), the sound fix is `git
ls-files` enumeration plus a content-keyed annotation cache, both of which
preserve whole-repo semantics.

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
7. An annotation marker MUST be recognized only when the marker's line begins (after optional whitespace) with a comment leader — `//`, `#`, `*`, `/*`, `--`, `;`, `%`, or `<!--` by default, extendable via a `comment_leaders` list in `.2119.yml` — so markers inside string literals, generated output, or prose never count as coverage.

### REQ-002.3: The check command

1. `2119 check` MUST run lint, cover, review-verdict freshness (REQ-003.3), and verify commands (REQ-005.2), exiting non-zero if any of them fail.
2. `2119 check` MUST complete in under 5 seconds on a repository with 100 spec files and 2000 test files, excluding time spent inside user-defined `[verify]` commands, so it is cheap enough to run from write-time hooks.
3. `2119 check --json` MUST emit a machine-readable report (violations, uncovered requirements, stale verdicts, manual requirements) for use by hooks and CI annotations.
4. REQUIREMENT REMOVED
5. When invoked with `--no-verify`, `2119 check` MUST skip `[verify]` command execution and surface those requirements alongside the manual exemptions, so CI for untrusted contributions can refuse to execute spec-supplied shell without silently dropping the requirements.

### REQ-002.4: Configuration

1. 2119 MUST read configuration from `.2119.yml` at the repository root, with every field optional and sensible defaults (specs at `specs/**/*REQ-*.md`, tests at common test globs, prefix `REQ`).
2. Running any command in a repository with no `.2119.yml` and no spec files MUST produce a clear "not initialized" message pointing at `2119 init`, not a zero-requirement pass.
3. The not-initialized determination MUST depend on whether the spec globs match any files, not on whether a specs directory exists, so an empty `specs/` directory can never produce a zero-requirement pass.
