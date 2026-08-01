import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Annotation, Violation } from "./model.js";
import { readOrMissing, type HashPart } from "./hash.js";

/**
 * One annotation-ID token: a legacy full ID (the configured prefix), a
 * file-scoped full ID (a stem — at least one lowercase letter somewhere
 * before the first dot, per REQ-011.1.3 — followed by one or more `.digit`
 * groups), or a bare ID (digits and dots only, resolved against a file's
 * `2119-spec:` marker per REQ-011.4.5). The lookahead confines "contains a
 * letter" to the run of stem-charset characters before the first dot, so it
 * can't accidentally swallow ordinary prose ("fix the thing" matches none of
 * these — no dot-group follows "fix").
 */
function idTokenPattern(prefix: string): string {
  const legacy = `${prefix}-\\d+(?:\\.\\d+)*`;
  const fileScopedFull = `(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]*(?:\\.\\d+)+`;
  const bare = `\\d+(?:\\.\\d+)*`;
  return `(?:${legacy}|${fileScopedFull}|${bare})`;
}

/**
 * A test annotation is a comment containing `2119: <ID>[, <ID>...]` in any
 * file matched by the test globs — language-agnostic by design (REQ-002.2.2).
 * IDs may be full canonical IDs (legacy or file-scoped, REQ-011.4.6) or bare
 * numbers resolved against an in-scope `2119-spec:` marker (REQ-011.4.5).
 */
export function buildAnnotationRegex(prefix: string): RegExp {
  const token = idTokenPattern(prefix);
  return new RegExp(`2119:\\s*(${token}(?:\\s*,\\s*${token})*)`, "g");
}

/** A `// 2119-spec: <stem>` marker declaring the file-scoped spec a file's bare annotations import (REQ-011.4.1). */
export function buildImportRegex(): RegExp {
  return /2119-spec:\s*(\S+)/;
}

function isBareId(id: string): boolean {
  return /^\d+(?:\.\d+)*$/.test(id);
}

/**
 * Markers count only on lines that begin (after whitespace) with a comment
 * leader, so string literals, generated output, and prose never produce
 * coverage (REQ-002.2.7). `comment_leaders` in .2119.yml extends the set.
 */
export const DEFAULT_COMMENT_LEADERS = ["//", "#", "*", "/*", "--", ";", "%", "<!--"];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildLeaderRegex(extraLeaders: string[] = []): RegExp {
  const leaders = [...new Set([...DEFAULT_COMMENT_LEADERS, ...extraLeaders])]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  return new RegExp(`^\\s*(?:${leaders.join("|")})`);
}

/**
 * Evidence blocks for test-quality review hashing (REQ-003.1.7): each covering
 * annotation contributes its file's prelude (everything before the file's
 * first annotation, hashed once per file) plus the annotation's line through
 * the line before the file's next annotation, or the end of file. Unrelated
 * tests in the same file fall outside the hash; shared imports and mocks —
 * the classic test-neutering vector — stay under it.
 *
 * When an annotation's resolved ID list includes a file-scoped canonical ID,
 * its own line is hashed as the sorted, canonical ID list rather than its
 * literal text (REQ-011.6.1): a spelling-only rewrite (bare vs. full,
 * reordering, which marker supplied a bare ID) leaves the hash — and any
 * recorded verdict — unchanged. Purely-legacy annotation lines are hashed
 * from their literal text exactly as before (REQ-011.6.2): no pre-existing
 * verdict is invalidated by adopting this feature.
 */
export function evidenceBlockParts(root: string, covering: Annotation[], all: Annotation[], prefix: string): HashPart[] {
  const boundariesByFile = new Map<string, number[]>();
  for (const a of all) {
    boundariesByFile.set(a.file, [...(boundariesByFile.get(a.file) ?? []), a.line]);
  }
  const coveringByFile = new Map<string, Annotation[]>();
  for (const a of covering) {
    coveringByFile.set(a.file, [...(coveringByFile.get(a.file) ?? []), a]);
  }
  const legacyIdRe = new RegExp(`^${prefix}-\\d+`);

  const parts: HashPart[] = [];
  for (const file of [...coveringByFile.keys()].sort()) {
    const content = readOrMissing(root, file);
    const boundaries = [...new Set(boundariesByFile.get(file) ?? [])].sort((a, b) => a - b);
    if (content === "MISSING" || boundaries.length === 0) {
      parts.push({ label: file, content });
      continue;
    }
    const lines = content.split(/\r?\n/);
    const fileCoverings = coveringByFile.get(file)!;
    // A `2119-spec:` marker line is spelling, not evidence: when this file's covering annotations
    // resolve any file-scoped ID, blank the marker line(s) in the prelude so switching markers, or
    // adding/removing one in favor of full IDs, doesn't move the hash (REQ-011.6.1). Legacy-only
    // coverage never triggers this, so pre-existing prelude hashes stay exact (REQ-011.6.2).
    const coveringHasFileScopedId = fileCoverings.some((a) => a.ids.some((id) => !legacyIdRe.test(id)));
    const importRe = buildImportRegex();
    const preludeLines = lines.slice(0, boundaries[0] - 1);
    const normalizedPrelude = coveringHasFileScopedId
      ? preludeLines.map((l) => (importRe.test(l) ? "" : l))
      : preludeLines;
    parts.push({ label: `${file}#prelude`, content: normalizedPrelude.join("\n") });
    [...fileCoverings]
      .sort((a, b) => a.line - b.line)
      .forEach((ann, i) => {
        const next = boundaries.find((b) => b > ann.line);
        const blockLines = lines.slice(ann.line - 1, next ? next - 1 : lines.length);
        const hasFileScopedId = ann.ids.some((id) => !legacyIdRe.test(id));
        if (hasFileScopedId && blockLines.length > 0) {
          blockLines[0] = [...ann.ids].sort().join(",");
        }
        parts.push({ label: `${file}#${i}`, content: blockLines.join("\n") });
      });
  }
  return parts;
}

export interface AnnotationScan {
  annotations: Annotation[];
  /** Lint violations from `2119-spec:` markers and bare-ID resolution (REQ-011.4.2/.3/.4). */
  violations: Violation[];
}

/**
 * Scan test files for `2119:` coverage annotations, resolving bare-number
 * sugar (REQ-011.4) against each file's own `2119-spec:` marker (at most
 * one per file, and only in scope for lines after it) into full canonical
 * IDs. `knownFileScopedStems` is the set of discovered file-scoped specs'
 * namespace stems, used to validate a marker names a real spec.
 */
export function scanAnnotations(
  root: string,
  testFiles: string[],
  prefix: string,
  commentLeaders: string[] = [],
  knownFileScopedStems: Set<string> = new Set(),
): AnnotationScan {
  const out: Annotation[] = [];
  const violations: Violation[] = [];
  const leaderRe = buildLeaderRegex(commentLeaders);
  const idRe = buildAnnotationRegex(prefix);
  const importRe = buildImportRegex();

  for (const file of testFiles) {
    let content: string;
    try {
      content = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (!content.includes("2119:") && !content.includes("2119-spec:")) continue;
    const lines = content.split(/\r?\n/);

    // Pass 1: locate the file's `2119-spec:` marker(s) — at most one is allowed (REQ-011.4.3).
    let importStem: string | null = null;
    let importLine = 0;
    let markerCount = 0;
    lines.forEach((line, idx) => {
      if (!leaderRe.test(line)) return;
      const m = line.match(importRe);
      if (!m) return;
      markerCount++;
      if (markerCount === 1) {
        importStem = m[1];
        importLine = idx + 1;
      }
    });
    if (markerCount > 1) {
      violations.push({
        file,
        line: importLine,
        rule: "REQ-011.4.3",
        message: `File declares ${markerCount} "2119-spec:" markers; at most one is allowed per file`,
      });
    }
    if (markerCount === 1 && importStem !== null && !knownFileScopedStems.has(importStem)) {
      violations.push({
        file,
        line: importLine,
        rule: "REQ-011.4.2",
        message: `"2119-spec: ${importStem}" names a spec that does not exist`,
      });
    }
    // A marker conflict (0 or >1) leaves no spec in scope for bare resolution.
    const effectiveStem = markerCount === 1 ? importStem : null;

    // Pass 2: resolve `2119:` annotations, prefixing bare IDs with the in-scope marker's stem.
    lines.forEach((line, idx) => {
      if (!leaderRe.test(line)) return; // not a comment line (REQ-002.2.7)
      idRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = idRe.exec(line)) !== null) {
        const rawIds = m[1].split(",").map((s) => s.trim()).filter(Boolean);
        const ids: string[] = [];
        for (const raw of rawIds) {
          if (!isBareId(raw)) {
            ids.push(raw);
            continue;
          }
          const inScope = effectiveStem !== null && importLine > 0 && importLine < idx + 1;
          if (inScope) {
            ids.push(`${effectiveStem}.${raw}`);
          } else {
            violations.push({
              file,
              line: idx + 1,
              rule: "REQ-011.4.4",
              message: `Bare annotation "${raw}" has no "2119-spec:" import in scope earlier in this file`,
            });
          }
        }
        if (ids.length > 0) out.push({ file, line: idx + 1, ids });
      }
    });
  }
  return { annotations: out, violations };
}
