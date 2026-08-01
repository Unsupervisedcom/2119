# REQ-011: File-Scoped Requirement IDs

## Overview

REQ-001 assigns every requirement a `<prefix>-NNN.M.K` ID whose `NNN` comes
from one shared, sequential counter across the whole `specs/` tree. That
counter is a single point of silent collision: two PRs (two agents, two
humans, or one of each) each read "next free NNN" from their own base branch,
each pick the same number, and each merges cleanly — git has no way to notice,
because the two PRs never touch the same file. The collision surfaces later as
two unrelated requirements sharing one ID. The only repair is renumbering,
which invalidates the verdict hashes of every requirement whose ID moved
(REQ-003.1.2) and forces re-review of all of them.

This spec adds a second, file-scoped ID grammar that structurally cannot
collide silently, without touching the existing counter-based grammar at all.

**Rejected alternatives** (recorded so the reasoning survives):
- **Central number allocator.** Solves the race but adds new coordination
  machinery and couples the tool to an external service — the opposite of
  2119's plain-CLI, no-network design (REQ-008).
- **Random high numbers.** Still one shared namespace, just a namespace
  sparse enough that collisions are unlikely rather than impossible, and the
  resulting IDs are opaque and non-sequential for no readability gain.
- **panopticon-slug-derived IDs.** 2119 is used standalone, without
  panopticon, in this very repo; a spec-tool feature must not depend on an
  orchestration layer that may not be present. The filename generalizes the
  same idea (a human-chosen, PR-visible name is the namespace) to every
  workflow, not just panopticon-driven ones.
- **Repo-wide alias table.** A table mapping short aliases to canonical IDs
  is itself a new shared namespace two PRs can collide on — it moves the
  problem one layer down instead of removing it.

**The design.** A spec file is named for its feature with no numeric prefix
(`specs/codex-session-scrollback.md`); the filename *is* the namespace. Within
it, sections and requirements use bare numbers (`### 3`, then numbered list
items), and the canonical ID is derived at parse time as
`<file-stem>.<section>.<item>` — the same two-level shape as the legacy
`<prefix>-NNN.M.K`, just keyed by filename instead of a counter. Authors never
write their own file's stem inside that file. Two PRs that create the same
spec filename collide loudly at merge time (and meaningfully — same feature
name plausibly means same feature); two PRs that append the same next number
to one spec file collide loudly on that file. Nothing left in the design can
merge cleanly into a silent duplicate.

Test files opt into short annotations with a one-line, file-local import —
`// 2119-spec: codex-session-scrollback` — after which bare annotations
(`// 2119: 3`, `// 2119: 3.1, 4`) resolve against that spec. There is
deliberately no alias registry: the import is local to one test file, so it
creates no new repo-wide namespace. Full canonical IDs keep working
everywhere and are the only way to reference a spec other than the one a test
file imports.

The load-bearing invariant is that **sugar resolves to canonical IDs at parse
time, and everything durable — verdict files, review IDs, hashes, lint/check
output — binds only to canonical IDs.** Rewriting how a test file spells its
annotations (bare vs. full, reordering a multi-ID list) never invalidates a
recorded verdict, because the identity that matters was never the spelling.
The one thing that does move a canonical ID is renaming a spec file — that is
rare, deliberate, and loud (a `git mv` shows up in the diff), so this spec
requires only that a rename visibly invalidate that spec's verdicts, not that
2119 track or migrate IDs across a rename.

**Migration.** Both grammars are permanent, not a transitional flag day: the
legacy `<prefix>-NNN.M` grammar, `<prefix>-NNN-*` filenames, and full-ID
annotations remain valid indefinitely, nothing in this repo's existing
`specs/REQ-*.md` files is renumbered or renamed, and new specs may use either
grammar. Docs recommend file-scoped naming for specs likely to see concurrent
authorship.

**Note for the spec-gate reviewer:** making file-scoped specs discoverable by
default requires broadening the default `specs` glob from
`specs/**/*<prefix>-*.md` to `specs/**/*.md` (REQ-011.3.1), since a
file-scoped filename has no `<prefix>-` substring to match. This is the one
default-behavior change in this spec: any other Markdown file placed directly
under a repo's `specs/` root is now lint-checked as a spec candidate. This
repo has no such stray files today.

## Requirements

### REQ-011.1: File-scoped spec filenames

1. A spec file whose base filename, with the `.md` extension removed, does not begin with the configured `prefix` followed by `-` and one or more digits MUST be parsed under the file-scoped grammar defined by this spec, with that base filename (extension removed) as its namespace stem.
2. A file-scoped spec's namespace stem MUST consist only of lowercase ASCII letters, digits, and hyphens (any other character is a lint violation).
3. A file-scoped spec's namespace stem MUST contain at least one lowercase letter (a digit-only stem is a lint violation). [A stem with no letters would make its full canonical IDs indistinguishable from bare-number annotation sugar (REQ-011.4), which relies on full IDs containing at least one letter before the first `.`.]
4. A file-scoped spec's namespace stem MUST NOT start with a hyphen, end with a hyphen, or contain two consecutive hyphens (any of these is a lint violation).

### REQ-011.2: File-scoped document structure and canonical IDs

1. A file-scoped spec's first content MUST be a top-level `# Title` heading, with no document-ID prefix required, unlike REQ-001.1.1's legacy form.
2. A file-scoped spec MUST satisfy REQ-001.1.2 (an `## Overview` section before `## Requirements`) and the "at least one requirements subsection" half of REQ-001.1.3.
3. Within a file-scoped spec's `## Requirements` section, each subsection heading MUST match the exact grammar `### N: Title` — `N` the section number, a colon, exactly one space, then a non-empty title — with no other spacing, omission, or qualifier accepted as this grammar.
4. A subsection heading that includes the file's own stem (e.g. `### <stem>.N: Title` inside the file that declares stem `<stem>`) MUST be a lint violation, since a file-scoped spec's own stem is never written inside itself.
5. Section numbers and requirement-item numbers within a file-scoped spec MUST be unique and sequential from 1, exactly as REQ-001.1.4 and REQ-001.2.3 require for legacy specs.
6. A file-scoped requirement's canonical ID MUST be `<stem>.N.M` (section number `.` item number), mirroring the legacy `<docId>.M.K` shape with the filename stem standing in for `<docId>`.
7. A file-scoped section's canonical ID MUST be `<stem>.N`, mirroring the legacy `<docId>.M` section-ID shape.
8. Coverage tags (`[review]`, `[review: globs]`, `[manual]`, `[verify: command]`), the exactly-one-RFC-2119-keyword rule, and the `REQUIREMENT REMOVED` tombstone mechanism MUST apply to file-scoped requirements identically to legacy requirements.

### REQ-011.3: Discovery and namespace-collision protection

1. The default `specs` glob (used when `.2119.yml` does not set `specs:`) MUST match file-scoped spec filenames without requiring configuration, so a newly created `specs/<slug>.md` is discovered the same way a newly created `specs/<PREFIX>-NNN-<slug>.md` already is.
2. The duplicate-document-ID lint check (REQ-001.1.7) MUST treat a file-scoped spec's namespace stem as its document ID, so two spec files with the same base filename in different directories under the specs root (e.g. `specs/foo.md` and `specs/sub/foo.md`) are flagged exactly as two legacy specs declaring the same `<prefix>-NNN` already are.

### REQ-011.4: Annotation import and bare-number sugar

1. A test file MUST be permitted to declare a `2119-spec: <stem>` marker on a comment-leader line (recognized the same way `2119:` markers are recognized), naming the file-scoped spec that bare-number annotations on later lines of that same file resolve against.
2. A `2119-spec: <stem>` marker whose `<stem>` does not match any discovered file-scoped spec's namespace MUST be a lint violation.
3. A test file containing more than one `2119-spec:` marker MUST be a lint violation, regardless of whether the markers name the same or different stems.
4. A bare-number annotation (an ID consisting only of digits and `.`, e.g. `// 2119: 3` or `// 2119: 3.1, 4`) MUST be a lint violation when no `2119-spec:` marker appears earlier in the same file.
5. A bare-number annotation with an earlier `2119-spec:` marker in scope MUST resolve, for coverage, review generation, and check purposes, to the full canonical ID formed by prefixing it with that marker's stem — identically to writing that full canonical ID directly.
6. A full canonical ID — legacy `<prefix>-NNN.M.K` or file-scoped `<stem>.N.M` — MUST resolve to that exact requirement regardless of any `2119-spec:` marker in scope, remaining the only way to annotate a requirement outside the spec named by the file's own marker (or in a file with no marker).

### REQ-011.5: Grammar coexistence

1. Within one repository, `2119 lint` and `2119 cover` MUST discover and validate both a legacy-grammar and a file-scoped-grammar spec file in the same run.
2. `2119 review` MUST generate an instruction file for every pending requirement in scope, regardless of whether it came from a legacy-grammar or file-scoped-grammar spec.
3. `2119 pass` and `2119 fail` MUST record a verdict for a review ID regardless of whether the review ID's requirement came from a legacy-grammar or file-scoped-grammar spec.
4. `2119 check` MUST report the same violation kind (uncovered, stale, or failing) for a requirement regardless of whether it came from a legacy-grammar or file-scoped-grammar spec.
5. `2119 prune` MUST delete an orphaned verdict file regardless of whether its review ID's requirement came from a legacy-grammar or file-scoped-grammar spec.
6. The configured `prefix` MUST govern only legacy-grammar filename, heading, and full-ID-annotation matching, leaving file-scoped filenames, headings, canonical IDs, and `2119-spec:` markers unaffected by its value.

### REQ-011.6: Verdict-hash binding to canonical spelling

1. The review-ID hash for a covering annotation whose resolved canonical ID list includes at least one file-scoped canonical ID MUST be computed from that line's sorted, resolved canonical ID list rather than from the annotation's literal source text, so a spelling-only rewrite of the annotation (bare vs. full, multi-ID reordering, switching which in-scope `2119-spec:` marker supplies a bare ID) that leaves the resolved canonical ID set unchanged also leaves the review ID, and any recorded passing verdict for it, unchanged.
2. This normalization MUST NOT change the review-ID hash for an annotation line whose resolved IDs are entirely legacy `<prefix>-NNN.M.K` IDs, so verdict hashes recorded before this feature exists remain valid and no pre-existing verdict is invalidated by adopting it.

### REQ-011.7: Rename invalidation

1. Renaming a file-scoped spec file's basename MUST cause `2119 check` to report every one of its enforced requirements as having no current review verdict, exactly as if each had been deleted and an unreviewed one recreated in its place, since the stem-derived canonical ID of each changes with the rename.

### REQ-011.8: Documentation

Prose completeness and causal framing are judgment calls, not deterministic facts — RFC 2119 keyword
choice follows the project's own guidance (REQ-001.2.5, and the "keyword-grep test standing in for a
judgment call" anti-pattern in the README) by using SHOULD here rather than forcing a keyword-grep MUST
to stand in for what a human reader actually judges.

1. The project's spec-format documentation SHOULD describe both the legacy `<prefix>-NNN.M.K` grammar and the file-scoped `<stem>.N.M` grammar, including the bare `### N: Title` heading form, the `2119-spec:` import marker, and bare-number annotation sugar.
2. The project's documentation SHOULD state that renaming a spec file invalidates that spec's recorded verdicts and requires re-review.
3. The project's documentation SHOULD recommend file-scoped naming for specs likely to see concurrent authorship.
