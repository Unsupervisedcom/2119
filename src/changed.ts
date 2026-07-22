import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildContext, type CheckContext } from "./check.js";
import { allRequirements } from "./spec.js";
import { splitReviewId } from "./hash.js";
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
  const mergeBase = gitText(root, ["merge-base", resolved, "HEAD"], `find a merge-base for "${baseRef}" and HEAD`).trim();
  if (!mergeBase) {
    throw new IncrementalCheckError(`Cannot find a merge-base for "${baseRef}" and HEAD; the histories may be unrelated.`);
  }
  const tracked = gitNulPaths(
    root,
    ["diff", "--name-only", "-z", "--no-renames", mergeBase, "--"],
    "read tracked changes from the merge-base",
  );
  const untracked = gitNulPaths(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    "read untracked non-ignored files",
  );
  return { mergeBase, paths: new Set([...tracked, ...untracked]) };
}

function gitText(root: string, args: string[], action: string): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
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
      // Match the repository walker: symbolic links are not scanned as files.
      if (mode === "120000") continue;
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
        });
      } catch (err) {
        const e = err as { stderr?: Buffer; message?: string };
        throw new IncrementalCheckError(
          `Cannot read baseline content for "${path}": ${e.stderr?.toString().trim() || e.message || "unknown Git error"}`,
        );
      }
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
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
  const affected = new Set<string>();

  if (changedPaths.has(".2119.yml")) {
    for (const id of currentRequirements.keys()) affected.add(id);
  } else {
    for (const [id, requirement] of currentRequirements) {
      const prior = baselineRequirements.get(id);
      if (!prior || contractKey(requirement) !== contractKey(prior)) affected.add(id);
    }

    const currentEvidence = new Map(current.allReviewTargets.map((t) => [t.requirement.id, t.reviewId]));
    const baselineEvidence = new Map(baseline.allReviewTargets.map((t) => [t.requirement.id, t.reviewId]));
    for (const id of currentRequirements.keys()) {
      if (currentEvidence.get(id) !== baselineEvidence.get(id)) affected.add(id);
    }
  }

  for (const path of changedPaths) {
    if (!path.startsWith(".2119/verdicts/") || !path.endsWith(".json")) continue;
    const requirementId = verdictRequirementId(path);
    if (requirementId && currentRequirements.has(requirementId)) affected.add(requirementId);
  }

  const lintViolations = current.lintViolations.filter((v) => changedPaths.has(relativePath(root, v.file)));
  const coverViolations = current.coverViolations.filter((v) => {
    if (v.rule === "REQ-002.2.4") return affected.has(messageRequirementId(v, currentRequirements) ?? "");
    if (v.rule === "REQ-002.2.3") {
      if (changedPaths.has(relativePath(root, v.file))) return true;
      const referenced = quotedRequirementId(v.message);
      return Boolean(referenced && baselineRequirements.has(referenced) && !currentRequirements.has(referenced));
    }
    return affected.has(messageRequirementId(v, currentRequirements) ?? "");
  });

  const malformed = new Set(current.malformedVerdictViolations);
  const reviewViolations = current.reviewViolations.filter((v) => {
    if (!malformed.has(v)) return affected.has(messageRequirementId(v, currentRequirements) ?? "");
    const path = relativePath(root, v.file);
    const requirementId = verdictRequirementId(path);
    return requirementId && currentRequirements.has(requirementId)
      ? affected.has(requirementId)
      : changedPaths.has(path);
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

function verdictRequirementId(path: string): string | undefined {
  const name = basename(path).replace(/\.json$/, "");
  return splitReviewId(name)?.requirementId;
}
