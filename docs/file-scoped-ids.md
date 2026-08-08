# File-scoped requirement IDs (no shared counter)

Specs named `<prefix>-NNN-*.md` share one counter for `NNN`, and two concurrent
PRs can each grab the same free number and merge cleanly into a silent
collision — the only repair is renumbering, which invalidates every verdict
whose ID moved. A second, file-scoped grammar avoids the counter entirely:
name the spec for its feature, with no numeric prefix, and the filename itself
becomes the namespace.

```markdown
# Codex Session Scrollback

## Overview

What this subsystem is and why.

## Requirements

### 1: Retention

1. The pane MUST retain the last 10000 lines.
```

Section headings are bare — `### N: Title`, not `### <prefix>-NNN.M: Title` —
and the canonical ID is derived at parse time as `<stem>.N.M` (file stem,
section, item), the same two-level shape as the legacy `<prefix>-NNN.M.K` ID,
just keyed by the filename instead of a counter. Authors never write their own
file's stem inside that file — a heading like
`### codex-session-scrollback.1: Retention` is a lint error, not a shortcut.

Test files opt into short annotations with a one-line, file-local import:

```
// 2119-spec: codex-session-scrollback
// 2119: 3
```

The `2119-spec:` marker resolves any bare number below it (`// 2119: 3`,
`// 2119: 3.1, 4`) to its full canonical ID — sugar for
`codex-session-scrollback.3` — for that one file only; there's deliberately no
repo-wide alias table. Full canonical IDs (`<prefix>-NNN.M.K` or `<stem>.N.M`)
always work, with or without an import, and are the only way to reference a
spec other than the one a file imports.

Rewriting an annotation's spelling — bare vs. full, reordering a multi-ID
list, switching which marker supplies a bare ID — never invalidates a recorded
verdict: everything durable (verdict files, review IDs, hashes) binds only to
the resolved canonical ID, never to how it was spelled. Renaming a spec file
is different: since the stem *is* the namespace, renaming a spec file changes
the canonical ID of everything it contains, which invalidates that spec's
recorded verdicts and requires re-review — loud and deliberate, exactly like a
`git mv` showing up in a diff.

Both grammars are permanent — legacy `<prefix>-NNN.M.K` specs, filenames, and
full-ID annotations keep working indefinitely, nothing is renumbered, and new
specs may use either. Prefer file-scoped naming for anything likely to see
concurrent authorship, since it's the one grammar that can't collide silently.

The normative requirements for this grammar live in
[`specs/REQ-011-file-scoped-req-ids.md`](../specs/REQ-011-file-scoped-req-ids.md).
