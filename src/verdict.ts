import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Verdict, VerdictKind } from "./model.js";

export const VERDICTS_DIR = ".2119/verdicts";

const SAFE_ID = /^[A-Za-z0-9.-]+--[0-9a-f]{12}$/;

function verdictPath(root: string, reviewId: string): string {
  if (!SAFE_ID.test(reviewId)) {
    throw new Error(`Invalid review ID: "${reviewId}"`);
  }
  return join(root, VERDICTS_DIR, `${reviewId}.json`);
}

export function readVerdicts(root: string): Map<string, Verdict> {
  const dir = join(root, VERDICTS_DIR);
  const out = new Map<string, Verdict>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const v = JSON.parse(readFileSync(join(dir, name), "utf8")) as Verdict;
      if (v.reviewId) out.set(v.reviewId, v);
    } catch {
      // Corrupt verdict files are treated as absent; check will report staleness.
    }
  }
  return out;
}

/**
 * Delete verdict files whose review ID matches no current target (REQ-006.2).
 * Verdicts for current targets are never touched, so a passing check stays
 * passing. Returns the deleted review IDs.
 */
export function pruneVerdicts(root: string, currentIds: Set<string>): string[] {
  const dir = join(root, VERDICTS_DIR);
  const pruned: string[] = [];
  if (!existsSync(dir)) return pruned;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const reviewId = name.replace(/\.json$/, "");
    if (!currentIds.has(reviewId)) {
      unlinkSync(join(dir, name));
      pruned.push(reviewId);
    }
  }
  return pruned;
}

/**
 * Record a verdict. Verdicts are committed JSON — never gitignored — so they
 * appear in PR diffs for human audit (REQ-003.2.2).
 */
export function writeVerdict(
  root: string,
  reviewId: string,
  requirementId: string,
  verdict: VerdictKind,
  summary: string,
): Verdict {
  const record: Verdict = {
    reviewId,
    requirementId,
    hash: reviewId.slice(-12),
    verdict,
    summary,
    timestamp: new Date().toISOString(),
  };
  const path = verdictPath(root, reviewId);
  mkdirSync(join(root, VERDICTS_DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
