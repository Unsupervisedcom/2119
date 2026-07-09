import type { Annotation, Requirement, SpecFile, Violation } from "./model.js";
import { allRequirements } from "./spec.js";

export interface CoverageResult {
  violations: Violation[];
  /** Requirement ID -> annotations that cover it (directly or via section ID). */
  covered: Map<string, Annotation[]>;
  /** Enforced test-coverage requirements with zero annotations. */
  uncovered: Requirement[];
  /** Requirements tagged [manual], surfaced rather than silently skipped. */
  manual: Requirement[];
}

function isEnforced(req: Requirement, enforce: string[]): boolean {
  return req.keywords.length === 1 && enforce.includes(req.keywords[0]);
}

export function computeCoverage(
  specs: SpecFile[],
  annotations: Annotation[],
  enforce: string[],
): CoverageResult {
  const violations: Violation[] = [];
  const reqs = allRequirements(specs);
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const sectionIds = new Map(specs.flatMap((s) => s.sections.map((sec) => [sec.id, sec] as const)));

  const covered = new Map<string, Annotation[]>();
  const addCover = (reqId: string, ann: Annotation) => {
    const list = covered.get(reqId) ?? [];
    list.push(ann);
    covered.set(reqId, list);
  };

  for (const ann of annotations) {
    for (const id of ann.ids) {
      const req = byId.get(id);
      if (req) {
        if (req.removed) {
          // Tombstoned target: annotation is stale but tolerated (REQ-002.2.3).
          continue;
        }
        addCover(id, ann);
        continue;
      }
      const section = sectionIds.get(id);
      if (section) {
        // Section-level annotation covers every item in the section (REQ-002.2.5).
        for (const item of section.items) {
          if (!item.removed) addCover(item.id, ann);
        }
        continue;
      }
      violations.push({
        file: ann.file,
        line: ann.line,
        rule: "REQ-002.2.3",
        message: `Annotation references unknown requirement ID "${id}"`,
      });
    }
  }

  const uncovered: Requirement[] = [];
  const manual: Requirement[] = [];
  for (const req of reqs) {
    if (req.removed) continue;
    if (req.coverage.kind === "manual") {
      manual.push(req);
      continue;
    }
    if (req.coverage.kind !== "test") continue;
    if (!isEnforced(req, enforce)) continue;
    if (!covered.has(req.id)) {
      uncovered.push(req);
      violations.push({
        file: specPathFor(specs, req),
        line: req.line,
        rule: "REQ-002.2.4",
        message: `${req.id} (${req.keywords[0]}) has no covering test annotation: "${truncate(req.text, 100)}"`,
      });
    }
  }

  return { violations, covered, uncovered, manual };
}

function specPathFor(specs: SpecFile[], req: Requirement): string {
  for (const s of specs) {
    if (s.sections.some((sec) => sec.items.includes(req))) return s.path;
  }
  return "<unknown spec>";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
