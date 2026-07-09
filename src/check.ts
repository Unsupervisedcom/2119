import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, type Config } from "./config.js";
import { walk, matchGlobs } from "./files.js";
import { parseSpec } from "./spec.js";
import { scanAnnotations } from "./annotations.js";
import { computeCoverage, type CoverageResult } from "./cover.js";
import { computeReviewTargets, verdictViolations, type ReviewTask } from "./review.js";
import { readVerdicts } from "./verdict.js";
import { runVerifyCommands } from "./verify.js";
import { allRequirements } from "./spec.js";
import type { SpecFile, Verdict, Violation } from "./model.js";

export interface CheckContext {
  config: Config;
  repoFiles: string[];
  specs: SpecFile[];
  coverage: CoverageResult;
  reviewTargets: Omit<ReviewTask, "instructionPath">[];
  verdicts: Map<string, Verdict>;
  lintViolations: Violation[];
  coverViolations: Violation[];
  reviewViolations: Violation[];
  verifyViolations: Violation[];
  notInitialized: boolean;
}

export interface BuildOptions {
  /** Run [verify] shell commands. Off for lightweight hook events. */
  runVerify?: boolean;
}

export function buildContext(root: string, options: BuildOptions = {}): CheckContext {
  const config = loadConfig(root);
  const repoFiles = walk(root);
  const specPaths = matchGlobs(repoFiles, config.specs);
  const notInitialized = !config.explicit && specPaths.length === 0 && !existsSync(join(root, "specs"));

  const specs = specPaths.map((p) => parseSpec(join(root, p), config.prefix));
  const lintViolations = specs.flatMap((s) => s.violations);

  const specPathSet = new Set(specPaths.map((p) => join(root, p)));
  const testFiles = matchGlobs(repoFiles, config.tests).filter((p) => !specPathSet.has(join(root, p)));
  const annotations = scanAnnotations(root, testFiles, config.prefix);
  const coverage = computeCoverage(specs, annotations, config.enforce);

  const reviewTargets = config.reviews ? computeReviewTargets(config, specs, coverage, repoFiles, annotations) : [];
  const verdicts = readVerdicts(root);
  const reviewViolations = verdictViolations(reviewTargets, verdicts);

  // [review: instructions: <path>] pointing at a missing file (REQ-005.1.4).
  for (const req of allRequirements(specs)) {
    const path = req.coverage.instructions;
    if (!req.removed && path && !existsSync(join(root, path))) {
      reviewViolations.push({
        file: specs.find((s) => s.sections.some((sec) => sec.items.includes(req)))?.path ?? "<unknown spec>",
        line: req.line,
        rule: "REQ-005.1.4",
        message: `${req.id} references a missing review instruction file: ${path}`,
      });
    }
  }

  const verifyViolations = options.runVerify ? runVerifyCommands(config, specs) : [];

  return {
    config,
    repoFiles,
    specs,
    coverage,
    reviewTargets,
    verdicts,
    lintViolations,
    coverViolations: coverage.violations,
    reviewViolations,
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
    .filter((r) => !r.removed);
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
