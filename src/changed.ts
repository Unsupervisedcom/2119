import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildContext, type CheckContext } from "./check.js";
import { CONFIG_FILENAME } from "./config.js";
import { evidenceBlockParts } from "./annotations.js";
import { matchGlobs } from "./files.js";
import { allRequirements } from "./spec.js";
import { fileParts, splitReviewId } from "./hash.js";
import { VERDICTS_DIR } from "./verdict.js";
import { runVerifyCommands, VERIFY_TIMEOUT_MS } from "./verify.js";
import type { Requirement, Violation } from "./model.js";

export class IncrementalCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncrementalCheckError";
  }
}

interface ChangeSet {
  mergeBase: string;
  paths: Set<string>;
}

export interface ChangedBuildOptions {
  runVerify?: boolean;
}

/** Build a normal current context, then conservatively narrow it by comparing a Git baseline. */
export function buildChangedContext(
  root: string,
  baseRef: string,
  options: ChangedBuildOptions = {},
): CheckContext {
  const changes = readChangeSet(root, baseRef);
  const baselineRoot = materializeBaseline(root, changes.mergeBase);
  try {
    let baseline: CheckContext;
    let current: CheckContext;
    try {
      baseline = buildContext(baselineRoot, { runVerify: false });
      const structural = baseline.lintViolations.filter(
        (violation) => violation.rule.startsWith("REQ-001.1.") || violation.rule === "REQ-001.2.3",
      );
      if (structural.length > 0) {
        throw new Error(`${structural.length} structural baseline specification violation(s)`);
      }
    } catch (err) {
      throw new IncrementalCheckError(`Cannot parse baseline configuration or content: ${(err as Error).message}`);
    }
    try {
      // Verification is run only after affected requirements are known.
      current = buildContext(root, { runVerify: false });
    } catch (err) {
      throw new IncrementalCheckError(`Cannot parse current configuration or content: ${(err as Error).message}`);
    }
    return scopeContext(root, current, baseline, changes.paths, options.runVerify !== false);
  } finally {
    rmSync(baselineRoot, { recursive: true, force: true });
  }
}

function readChangeSet(root: string, baseRef: string): ChangeSet {
  const resolved = gitText(
    root,
    ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`],
    `resolve base ref "${baseRef}"`,
  ).trim();
  const mergeBase = gitText(
    root,
    ["merge-base", resolved, "HEAD"],
    `find a merge-base for "${baseRef}" and HEAD (the histories may be unrelated)`,
  ).trim();
  const committed = gitNulPaths(
    root,
    ["diff", "--name-only", "-z", "--no-renames", mergeBase, "HEAD", "--"],
    "read committed changes from the merge-base",
  );
  const staged = gitNulPaths(
    root,
    ["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD", "--"],
    "read staged changes",
  );
  const unstaged = gitNulPaths(
    root,
    ["diff", "--name-only", "-z", "--no-renames", "--"],
    "read unstaged changes",
  );
  const untracked = gitNulPaths(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    "read untracked non-ignored files",
  );
  return { mergeBase, paths: new Set([...committed, ...staged, ...unstaged, ...untracked]) };
}

const NO_NETWORK_ENV = { ...process.env, GIT_NO_LAZY_FETCH: "1" };

function gitText(root: string, args: string[], action: string): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: NO_NETWORK_ENV,
  });
  const warning = result.stderr?.trim();
  if (result.error || result.status !== 0 || warning) {
    const detail = warning || result.error?.message || `Git exited ${result.status ?? "without a status"}`;
    throw new IncrementalCheckError(`Cannot ${action}: ${detail}`);
  }
  return result.stdout;
}

function gitNulPaths(root: string, args: string[], action: string): string[] {
  const raw = gitText(root, args, action);
  return raw ? raw.split("\0").filter(Boolean) : [];
}

/** Materialize the exact baseline tree without checking it out or contacting a remote. */
function materializeBaseline(root: string, commit: string): string {
  const target = mkdtempSync(join(tmpdir(), "2119-baseline-"));
  try {
    let listing: Buffer;
    try {
      listing = execFileSync("git", ["ls-tree", "-rz", "--full-tree", commit], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: NO_NETWORK_ENV,
      });
    } catch (err) {
      const e = err as { stderr?: Buffer; message?: string };
      throw new IncrementalCheckError(
        `Cannot read baseline tree ${commit}: ${e.stderr?.toString().trim() || e.message || "unknown Git error"}`,
      );
    }
    for (const record of listing.toString("utf8").split("\0").filter(Boolean)) {
      const tab = record.indexOf("\t");
      const header = tab === -1 ? "" : record.slice(0, tab);
      const path = tab === -1 ? "" : record.slice(tab + 1);
      const [mode, type, object] = header.split(" ");
      if (!path || !object) throw new IncrementalCheckError(`Cannot parse baseline tree entry: ${record}`);
      if (type === "commit") {
        throw new IncrementalCheckError(`Cannot read baseline content for submodule path "${path}" without a checkout.`);
      }
      if (type !== "blob") continue;
      const destination = resolve(target, path);
      if (isAbsolute(path) || path.split("/").includes("..") || !destination.startsWith(`${target}${sep}`)) {
        throw new IncrementalCheckError(`Unsafe path in baseline tree: "${path}"`);
      }
      let content: Buffer;
      try {
        content = execFileSync("git", ["cat-file", "blob", object], {
          cwd: root,
          maxBuffer: 256 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
          env: NO_NETWORK_ENV,
        });
      } catch (err) {
        const e = err as { stderr?: Buffer; message?: string };
        throw new IncrementalCheckError(
          `Cannot read baseline content for "${path}": ${e.stderr?.toString().trim() || e.message || "unknown Git error"}`,
        );
      }
      mkdirSync(dirname(destination), { recursive: true });
      if (mode === "120000") {
        const linkTarget = content.toString("utf8");
        const resolvedTarget = resolve(dirname(destination), linkTarget);
        if (isAbsolute(linkTarget) || !resolvedTarget.startsWith(`${target}${sep}`)) {
          throw new IncrementalCheckError(`Unsafe symbolic link in baseline tree: "${path}" -> "${linkTarget}"`);
        }
        symlinkSync(linkTarget, destination);
      } else {
        writeFileSync(destination, content);
      }
    }
    return target;
  } catch (err) {
    rmSync(target, { recursive: true, force: true });
    if (err instanceof IncrementalCheckError) throw err;
    throw new IncrementalCheckError(`Cannot materialize baseline content: ${(err as Error).message}`);
  }
}

function scopeContext(
  root: string,
  current: CheckContext,
  baseline: CheckContext,
  changedPaths: Set<string>,
  runVerify: boolean,
): CheckContext {
  const currentRequirements = new Map(allRequirements(current.specs).filter((r) => !r.removed).map((r) => [r.id, r]));
  const baselineRequirements = new Map(allRequirements(baseline.specs).filter((r) => !r.removed).map((r) => [r.id, r]));
  const currentKnownIds = new Set([
    ...currentRequirements.keys(),
    ...current.specs.flatMap((spec) => spec.sections.map((section) => section.id)),
  ]);
  const baselineKnownIds = new Set([
    ...baselineRequirements.keys(),
    ...baseline.specs.flatMap((spec) => spec.sections.map((section) => section.id)),
  ]);
  const affected = new Set<string>();
  const configChanged = changedPaths.has(CONFIG_FILENAME);

  if (configChanged) {
    for (const id of currentRequirements.keys()) affected.add(id);
  } else {
    for (const [id, requirement] of currentRequirements) {
      const prior = baselineRequirements.get(id);
      if (!prior || contractKey(requirement) !== contractKey(prior)) affected.add(id);
    }

    for (const id of currentRequirements.keys()) {
      if (evidenceKey(current, id) !== evidenceKey(baseline, id)) affected.add(id);
    }
  }

  const currentReviewIds = new Map(current.allReviewTargets.map((target) => [target.requirement.id, target.reviewId]));
  const baselineReviewIds = new Map(baseline.allReviewTargets.map((target) => [target.requirement.id, target.reviewId]));
  for (const path of changedPaths) {
    if (!path.startsWith(`${VERDICTS_DIR}/`) || !path.endsWith(".json")) continue;
    const parsed = verdictReview(path);
    if (
      parsed &&
      currentRequirements.has(parsed.requirementId) &&
      (currentReviewIds.get(parsed.requirementId) === parsed.reviewId ||
        baselineReviewIds.get(parsed.requirementId) === parsed.reviewId)
    ) {
      affected.add(parsed.requirementId);
    }
  }

  const lintViolations = current.lintViolations.filter((v) => changedPaths.has(relativePath(root, v.file)));
  const coverViolations = current.coverViolations.filter((v) => {
    if (v.rule === "REQ-002.2.4") return affected.has(messageRequirementId(v, currentRequirements) ?? "");
    if (v.rule === "REQ-002.2.3") {
      if (configChanged || changedPaths.has(relativePath(root, v.file))) return true;
      const referenced = quotedRequirementId(v.message);
      return Boolean(referenced && baselineKnownIds.has(referenced) && !currentKnownIds.has(referenced));
    }
    return affected.has(messageRequirementId(v, currentRequirements) ?? "");
  });

  const malformed = new Set(current.malformedVerdictViolations);
  const reviewViolations = current.reviewViolations.filter((v) => {
    if (!malformed.has(v)) return affected.has(messageRequirementId(v, currentRequirements) ?? "");
    const path = relativePath(root, v.file);
    const parsed = verdictReview(path);
    const assigned = Boolean(
      parsed &&
        currentRequirements.has(parsed.requirementId) &&
        (currentReviewIds.get(parsed.requirementId) === parsed.reviewId ||
          baselineReviewIds.get(parsed.requirementId) === parsed.reviewId),
    );
    return assigned ? affected.has(parsed!.requirementId) : changedPaths.has(path);
  });

  const covered = new Map([...current.coverage.covered].filter(([id]) => affected.has(id)));
  const coverage = {
    violations: coverViolations,
    covered,
    uncovered: current.coverage.uncovered.filter((r) => affected.has(r.id)),
    manual: current.coverage.manual.filter((r) => affected.has(r.id)),
  };
  const reviewTargets = current.reviewTargets.filter((t) => affected.has(t.requirement.id));
  const verifyViolations = runVerify
    ? runVerifyCommands(current.config, current.specs, VERIFY_TIMEOUT_MS, affected)
    : [];

  return {
    ...current,
    coverage,
    reviewTargets,
    lintViolations,
    coverViolations,
    reviewViolations,
    verifyViolations,
    scopedRequirementIds: affected,
  };
}

function evidenceKey(ctx: CheckContext, requirementId: string): string | undefined {
  const requirement = allRequirements(ctx.specs).find((candidate) => !candidate.removed && candidate.id === requirementId);
  if (!requirement) return undefined;
  const covering = ctx.coverage.covered.get(requirementId) ?? [];
  const parts = evidenceBlockParts(ctx.config.root, covering, ctx.annotations);
  if (requirement.coverage.kind === "test") {
    parts.push(...fileParts(ctx.config.root, matchGlobs(ctx.repoFiles, ctx.config.sharedEvidence)));
  } else if (requirement.coverage.kind === "review") {
    const evidence = requirement.coverage.globs ? matchGlobs(ctx.repoFiles, requirement.coverage.globs) : [];
    const selected = requirement.coverage.instructions ? [requirement.coverage.instructions, ...evidence] : evidence;
    parts.push(...fileParts(ctx.config.root, selected));
  }
  return JSON.stringify(parts);
}

function contractKey(requirement: Requirement): string {
  return JSON.stringify({
    text: requirement.text,
    keywords: requirement.keywords,
    kind: requirement.coverage.kind,
    command: requirement.coverage.command ?? null,
    globs: requirement.coverage.globs ?? [],
    instructions: requirement.coverage.instructions ?? null,
  });
}

function relativePath(root: string, path: string): string {
  if (!isAbsolute(path)) return path.split(sep).join("/");
  return relative(root, path).split(sep).join("/");
}

function messageRequirementId(violation: Violation, requirements: Map<string, Requirement>): string | undefined {
  for (const id of requirements.keys()) {
    if (violation.message.startsWith(`${id} `)) return id;
  }
  return undefined;
}

function quotedRequirementId(message: string): string | undefined {
  return message.match(/requirement ID "([^"]+)"/)?.[1];
}

function verdictReview(path: string): { reviewId: string; requirementId: string } | undefined {
  const name = basename(path).replace(/\.json$/, "");
  const parsed = splitReviewId(name);
  return parsed ? { reviewId: name, requirementId: parsed.requirementId } : undefined;
}
