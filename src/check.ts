import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, type Config } from "./config.js";
import { walk, matchGlobs } from "./files.js";
import { parseSpec } from "./spec.js";
import { scanAnnotations } from "./annotations.js";
import { computeCoverage, type CoverageResult } from "./cover.js";
import { computeReviewTargets, verdictViolations, type ReviewTask } from "./review.js";
import { scanVerdicts } from "./verdict.js";
import { runVerifyCommands } from "./verify.js";
import { allRequirements } from "./spec.js";
import type { Annotation, SpecFile, Verdict, Violation } from "./model.js";

export interface CheckContext {
  config: Config;
  repoFiles: string[];
  specs: SpecFile[];
  coverage: CoverageResult;
  annotations: Annotation[];
  /** Review hashes computed even when reviews are disabled, for incremental dependency comparison. */
  allReviewTargets: Omit<ReviewTask, "instructionPath">[];
  reviewTargets: Omit<ReviewTask, "instructionPath">[];
  verdicts: Map<string, Verdict>;
  lintViolations: Violation[];
  coverViolations: Violation[];
  reviewViolations: Violation[];
  malformedVerdictViolations: Violation[];
  verifyViolations: Violation[];
  notInitialized: boolean;
  /** Present for `check --changed`; limits report counts and manual output to affected requirements. */
  scopedRequirementIds?: Set<string>;
}

export interface BuildOptions {
  /** Run [verify] shell commands. Off for lightweight hook events. */
  runVerify?: boolean;
}

export function buildContext(root: string, options: BuildOptions = {}): CheckContext {
  const config = loadConfig(root);
  const repoFiles = walk(root);
  const specPaths = matchGlobs(repoFiles, config.specs);
  // Glob-match only: an empty specs/ directory must never read as initialized
  // and green-light a zero-requirement pass (REQ-002.4.3).
  const notInitialized = !config.explicit && specPaths.length === 0;

  const specs = specPaths.map((p) => parseSpec(join(root, p), config.prefix));
  const lintViolations = specs.flatMap((s) => s.violations);

  // Duplicate document IDs make requirement IDs ambiguous (REQ-001.1.7).
  const byDocId = new Map<string, string>();
  for (const s of specs) {
    if (!s.docId) continue;
    const prior = byDocId.get(s.docId);
    if (prior) {
      const message = `Document ID ${s.docId} is also declared by ${prior}`;
      lintViolations.push({
        file: s.path,
        line: 1,
        rule: "REQ-001.1.7",
        message,
      });
      lintViolations.push({
        file: prior,
        line: 1,
        rule: "REQ-001.1.7",
        message: `Document ID ${s.docId} is also declared by ${s.path}`,
      });
    } else {
      byDocId.set(s.docId, s.path);
    }
  }

  const specPathSet = new Set(specPaths.map((p) => join(root, p)));
  const testFiles = matchGlobs(repoFiles, config.tests).filter((p) => !specPathSet.has(join(root, p)));
  const annotations = scanAnnotations(root, testFiles, config.prefix, config.commentLeaders);
  const coverage = computeCoverage(specs, annotations, config.enforce);

  const allReviewTargets = computeReviewTargets(config, specs, coverage, repoFiles, annotations);
  const reviewTargets = config.reviews ? allReviewTargets : [];
  // Malformed verdict files are loud violations, not silent passes or skips (REQ-003.7.2).
  const { verdicts, violations: malformedVerdicts } = scanVerdicts(root);
  const reviewViolations = [...malformedVerdicts, ...verdictViolations(reviewTargets, verdicts)];

  // [review: instructions: <path>] pointing at a missing file (REQ-005.1.4),
  // and [review: <globs>] matching nothing — a typo'd glob must fail loudly
  // instead of degrading to a text-only hash (REQ-003.1.9).
  for (const req of allRequirements(specs)) {
    if (req.removed) continue;
    const specPath = specs.find((s) => s.sections.some((sec) => sec.items.includes(req)))?.path ?? "<unknown spec>";
    const path = req.coverage.instructions;
    if (path && !existsSync(join(root, path))) {
      reviewViolations.push({
        file: specPath,
        line: req.line,
        rule: "REQ-005.1.4",
        message: `${req.id} references a missing review instruction file: ${path}`,
      });
    }
    const globs = req.coverage.globs;
    if (req.coverage.kind === "review" && globs?.length && matchGlobs(repoFiles, globs).length === 0) {
      reviewViolations.push({
        file: specPath,
        line: req.line,
        rule: "REQ-003.1.9",
        message: `${req.id} has [review] globs matching no files (${globs.join(", ")}); fix the globs or the evidence`,
      });
    }
  }

  const verifyViolations = options.runVerify ? runVerifyCommands(config, specs) : [];

  return {
    config,
    repoFiles,
    specs,
    coverage,
    annotations,
    allReviewTargets,
    reviewTargets,
    verdicts,
    lintViolations,
    coverViolations: coverage.violations,
    reviewViolations,
    malformedVerdictViolations: malformedVerdicts,
    verifyViolations,
    notInitialized,
  };
}

export interface CheckReport {
  ok: boolean;
  violations: Violation[];
  uncoveredRequirements: string[];
  staleReviews: string[];
  manualRequirements: { id: string; text: string }[];
  requirementCount: number;
  coveredCount: number;
}

export function buildReport(ctx: CheckContext): CheckReport {
  const violations = [...ctx.lintViolations, ...ctx.coverViolations, ...ctx.reviewViolations, ...ctx.verifyViolations];
  const enforcedTestReqs = ctx.specs
    .flatMap((s) => s.sections.flatMap((sec) => sec.items))
    .filter((r) => !r.removed && (!ctx.scopedRequirementIds || ctx.scopedRequirementIds.has(r.id)));
  return {
    ok: violations.length === 0,
    violations,
    uncoveredRequirements: ctx.coverage.uncovered.map((r) => r.id),
    staleReviews: ctx.reviewViolations.map((v) => v.message),
    manualRequirements: ctx.coverage.manual.map((r) => ({ id: r.id, text: r.text })),
    requirementCount: enforcedTestReqs.length,
    coveredCount: ctx.coverage.covered.size,
  };
}
