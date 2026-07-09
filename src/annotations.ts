import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Annotation } from "./model.js";

/**
 * A test annotation is a comment containing `2119: <ID>[, <ID>...]` in any
 * file matched by the test globs — language-agnostic by design (REQ-002.2.2).
 */
export function buildAnnotationRegex(prefix: string): RegExp {
  return new RegExp(`2119:\\s*(${prefix}-\\d+(?:\\.\\d+)*(?:\\s*,\\s*${prefix}-\\d+(?:\\.\\d+)*)*)`, "g");
}

export function scanAnnotations(root: string, testFiles: string[], prefix: string): Annotation[] {
  const out: Annotation[] = [];
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
