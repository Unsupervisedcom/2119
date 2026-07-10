import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Annotation } from "./model.js";
import { readOrMissing, type HashPart } from "./hash.js";

/**
 * A test annotation is a comment containing `2119: <ID>[, <ID>...]` in any
 * file matched by the test globs — language-agnostic by design (REQ-002.2.2).
 */
export function buildAnnotationRegex(prefix: string): RegExp {
  return new RegExp(`2119:\\s*(${prefix}-\\d+(?:\\.\\d+)*(?:\\s*,\\s*${prefix}-\\d+(?:\\.\\d+)*)*)`, "g");
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
 */
export function evidenceBlockParts(root: string, covering: Annotation[], all: Annotation[]): HashPart[] {
  const boundariesByFile = new Map<string, number[]>();
  for (const a of all) {
    boundariesByFile.set(a.file, [...(boundariesByFile.get(a.file) ?? []), a.line]);
  }
  const coveringByFile = new Map<string, Set<number>>();
  for (const a of covering) {
    coveringByFile.set(a.file, (coveringByFile.get(a.file) ?? new Set()).add(a.line));
  }

  const parts: HashPart[] = [];
  for (const file of [...coveringByFile.keys()].sort()) {
    const content = readOrMissing(root, file);
    const boundaries = [...new Set(boundariesByFile.get(file) ?? [])].sort((a, b) => a - b);
    if (content === "MISSING" || boundaries.length === 0) {
      parts.push({ label: file, content });
      continue;
    }
    const lines = content.split(/\r?\n/);
    parts.push({ label: `${file}#prelude`, content: lines.slice(0, boundaries[0] - 1).join("\n") });
    [...coveringByFile.get(file)!].sort((a, b) => a - b).forEach((line, i) => {
      const next = boundaries.find((b) => b > line);
      parts.push({ label: `${file}#${i}`, content: lines.slice(line - 1, next ? next - 1 : lines.length).join("\n") });
    });
  }
  return parts;
}

export function scanAnnotations(
  root: string,
  testFiles: string[],
  prefix: string,
  commentLeaders: string[] = [],
): Annotation[] {
  const out: Annotation[] = [];
  const leaderRe = buildLeaderRegex(commentLeaders);
  for (const file of testFiles) {
    let content: string;
    try {
      content = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (!content.includes("2119:")) continue;
    const lines = content.split(/\r?\n/);
    const re = buildAnnotationRegex(prefix);
    lines.forEach((line, idx) => {
      if (!leaderRe.test(line)) return; // not a comment line (REQ-002.2.7)
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const ids = m[1].split(",").map((s) => s.trim()).filter(Boolean);
        out.push({ file, line: idx + 1, ids });
      }
    });
  }
  return out;
}
