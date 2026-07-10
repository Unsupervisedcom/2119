import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Verdict, VerdictKind, Violation } from "./model.js";
import { splitReviewId } from "./hash.js";

export const VERDICTS_DIR = ".2119/verdicts";

const SAFE_ID = /^[A-Za-z0-9.-]+--[0-9a-f]{12}$/;

function verdictPath(root: string, reviewId: string): string {
  if (!SAFE_ID.test(reviewId)) {
    throw new Error(`Invalid review ID: "${reviewId}"`);
  }
  return join(root, VERDICTS_DIR, `${reviewId}.json`);
}

export interface VerdictScan {
  /** Verdicts that passed full record validation (REQ-003.7.1), keyed by review ID. */
  verdicts: Map<string, Verdict>;
  /** One violation per malformed verdict file — the gate fails closed, loudly (REQ-003.7.2). */
  violations: Violation[];
}

/**
 * A verdict earns a place in the map only as a fully well-formed record: a
 * malformed one (missing/typo'd verdict, mangled merge, wrong filename) is a
 * check violation, never a silent pass and never a silent skip (REQ-003.7).
 */
function validateVerdict(filename: string, record: unknown): { verdict?: Verdict; reason?: string } {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return { reason: "not a JSON object" };
  }
  const r = record as Record<string, unknown>;
  if (typeof r.reviewId !== "string" || !SAFE_ID.test(r.reviewId)) {
    return { reason: "missing or invalid reviewId" };
  }
  if (filename !== `${r.reviewId}.json`) {
    return { reason: `filename does not match reviewId (expected ${r.reviewId}.json)` };
  }
  if (r.verdict !== "pass" && r.verdict !== "fail") {
    return { reason: `verdict must be exactly "pass" or "fail", got ${JSON.stringify(r.verdict)}` };
  }
  if (typeof r.summary !== "string" || r.summary.trim() === "") {
    return { reason: "summary must be a nonempty string" };
  }
  const parts = splitReviewId(r.reviewId);
  if (!parts || r.requirementId !== parts.requirementId) {
    return { reason: "requirementId does not match reviewId" };
  }
  if (r.hash !== parts.hash) {
    return { reason: "hash does not match the reviewId suffix" };
  }
  if (typeof r.timestamp !== "string" || Number.isNaN(Date.parse(r.timestamp))) {
    return { reason: "timestamp is not a parseable date" };
  }
  return { verdict: r as unknown as Verdict };
}

export function scanVerdicts(root: string): VerdictScan {
  const dir = join(root, VERDICTS_DIR);
  const out: VerdictScan = { verdicts: new Map(), violations: [] };
  const malformed = (name: string, reason: string) =>
    out.violations.push({
      file: `${VERDICTS_DIR}/${name}`,
      line: 1,
      rule: "REQ-003.7.2",
      message: `malformed verdict file: ${reason}`,
    });
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (e) {
      malformed(name, `unparseable JSON (${(e as Error).message})`);
      continue;
    }
    const { verdict, reason } = validateVerdict(name, record);
    if (verdict) out.verdicts.set(verdict.reviewId, verdict);
    else malformed(name, reason!);
  }
  return out;
}

/** Valid verdicts only; use scanVerdicts when malformed-file violations matter. */
export function readVerdicts(root: string): Map<string, Verdict> {
  return scanVerdicts(root).verdicts;
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
