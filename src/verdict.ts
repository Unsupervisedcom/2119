import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Verdict, VerdictKind, Violation } from "./model.js";
import { splitReviewId } from "./hash.js";

export const VERDICTS_DIR = ".2119/verdicts";
export const VERDICT_ATTRIBUTES_RULE = ".2119/verdicts/*.json linguist-generated=true";

const GITIGNORE_SECTION = `# 2119:gitignore-begin
# Review packets are scratch; verdicts are committed audit history.
!.2119/
.2119/reviews/
!.2119/verdicts/
!.2119/verdicts/**
# 2119:gitignore-end
`;

const NESTED_GITIGNORE_SECTION = `# 2119:storage-begin
reviews/
!verdicts/
!verdicts/**
# 2119:storage-end
`;

const VERDICTS_GITIGNORE_SECTION = `# 2119:verdicts-begin
!.gitignore
!*.json
# 2119:verdicts-end
`;

function putLast(path: string, section: string, pattern: RegExp): boolean {
  const existing = readFileSync(path, "utf8");
  const withoutSection = existing.replace(pattern, "").trimEnd();
  const updated = `${withoutSection}${withoutSection ? "\n" : ""}${section}`;
  if (updated === existing) return false;
  writeFileSync(path, updated);
  return true;
}

/** Keep scratch review packets ignored while verdict audit records remain trackable. */
export function ensureReviewStorageRules(root: string): boolean {
  const path = join(root, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const without2119 = existing
    .replace(/# 2119:gitignore-begin\n[\s\S]*?# 2119:gitignore-end\n?/g, "")
    .replace(
      /# 2119: review packets are scratch; verdicts are committed audit history\n!\.2119\/\n\.2119\/reviews\/\n!\.2119\/verdicts\/\n!\.2119\/verdicts\/\*\*\n?/g,
      "",
    )
    .trimEnd();
  const updated = `${without2119}${without2119 ? "\n" : ""}${GITIGNORE_SECTION}`;
  let changed = false;
  if (updated !== existing) {
    writeFileSync(path, updated);
    changed = true;
  }
  const nested = join(root, ".2119/.gitignore");
  if (existsSync(nested)) {
    changed = putLast(nested, NESTED_GITIGNORE_SECTION, /# 2119:storage-begin\n[\s\S]*?# 2119:storage-end\n?/g) || changed;
  }
  const verdicts = join(root, `${VERDICTS_DIR}/.gitignore`);
  if (existsSync(verdicts)) {
    changed =
      putLast(verdicts, VERDICTS_GITIGNORE_SECTION, /# 2119:verdicts-begin\n[\s\S]*?# 2119:verdicts-end\n?/g) ||
      changed;
  }
  return changed;
}

/** Mark committed verdict records as generated in GitHub's diff UI. */
export function ensureVerdictAttributes(root: string): boolean {
  const path = join(root, ".gitattributes");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.split(/\r?\n/).includes(VERDICT_ATTRIBUTES_RULE)) return false;
  const updated = `${existing.trimEnd()}${existing.trimEnd() ? "\n" : ""}${VERDICT_ATTRIBUTES_RULE}\n`;
  writeFileSync(path, updated);
  return true;
}

const SAFE_ID = /^[A-Za-z0-9.-]+--[0-9a-f]{12}$/;
export const SAFE_REQUIREMENT_ID = /^[A-Za-z0-9.-]+$/;

function verdictPath(root: string, requirementId: string): string {
  if (!SAFE_REQUIREMENT_ID.test(requirementId)) {
    throw new Error(`Invalid requirement ID: "${requirementId}"`);
  }
  return join(root, VERDICTS_DIR, `${requirementId}.json`);
}

export interface VerdictFile {
  name: string;
  kind: "stable" | "legacy";
  requirementId: string;
  verdict?: Verdict;
}

export interface VerdictScan {
  /** Verdicts that passed full record validation (REQ-003.7.1), keyed by review ID. */
  verdicts: Map<string, Verdict>;
  /** One violation per malformed verdict file — the gate fails closed, loudly (REQ-003.7.2). */
  violations: Violation[];
  /** Every JSON file, including malformed records, for migration and pruning. */
  files: VerdictFile[];
  /** Stable paths are authoritative even when their contents are malformed. */
  stableFiles: Map<string, VerdictFile>;
}

/**
 * A verdict earns a place in the map only as a fully well-formed record: a
 * malformed one (missing/typo'd verdict, mangled merge, wrong filename) is a
 * check violation, never a silent pass and never a silent skip (REQ-003.7).
 */
function validateVerdict(
  filename: string,
  kind: "stable" | "legacy",
  pathRequirementId: string,
  record: unknown,
): { verdict?: Verdict; reason?: string } {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return { reason: "not a JSON object" };
  }
  const r = record as Record<string, unknown>;
  if (typeof r.reviewId !== "string" || !SAFE_ID.test(r.reviewId)) {
    return { reason: "missing or invalid reviewId" };
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
  if (typeof r.hash !== "string" || !/^[0-9a-f]{12}$/.test(r.hash) || r.hash !== parts.hash) {
    return { reason: "hash does not match the reviewId suffix" };
  }
  if (typeof r.timestamp !== "string" || Number.isNaN(Date.parse(r.timestamp))) {
    return { reason: "timestamp is not a parseable date" };
  }
  const expected = kind === "stable" ? `${r.requirementId}.json` : `${r.reviewId}.json`;
  if (filename !== expected || pathRequirementId !== r.requirementId) {
    return { reason: `filename does not match ${kind === "stable" ? "requirementId" : "reviewId"} (expected ${expected})` };
  }
  return { verdict: r as unknown as Verdict };
}

export function scanVerdicts(root: string): VerdictScan {
  const dir = join(root, VERDICTS_DIR);
  const out: VerdictScan = { verdicts: new Map(), violations: [], files: [], stableFiles: new Map() };
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
    const stem = name.replace(/\.json$/, "");
    const legacyParts = splitReviewId(stem);
    const kind = legacyParts ? "legacy" : "stable";
    const requirementId = legacyParts?.requirementId ?? stem;
    const file: VerdictFile = { name, kind, requirementId };
    out.files.push(file);
    if (kind === "stable") out.stableFiles.set(requirementId, file);
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (e) {
      malformed(name, `unparseable JSON (${(e as Error).message})`);
      continue;
    }
    const { verdict, reason } = validateVerdict(name, kind, requirementId, record);
    if (verdict) file.verdict = verdict;
    else malformed(name, reason!);
  }
  // A stable path is the sole authority for its requirement. Legacy records
  // remain transitional evidence only where no stable path exists.
  for (const file of out.files) {
    if (!file.verdict) continue;
    if (file.kind === "stable" || !out.stableFiles.has(file.requirementId)) {
      out.verdicts.set(file.verdict.reviewId, file.verdict);
    }
  }
  return out;
}

export interface MigrationNotice {
  requirementId: string;
  message: string;
}

export function legacyMigrationNotices(
  scan: VerdictScan,
  currentReviewIds: Map<string, string>,
): MigrationNotice[] {
  return scan.files
    .filter((file) => file.kind === "legacy" && file.verdict && !scan.stableFiles.has(file.requirementId))
    .map((file) => ({
      requirementId: file.requirementId,
      message:
        `migration: ${VERDICTS_DIR}/${file.name} -> ${VERDICTS_DIR}/${file.requirementId}.json ` +
        `(${currentReviewIds.get(file.requirementId) === file.verdict!.reviewId ? "current" : "superseded"} legacy verdict; run \`2119 prune\`)`,
    }));
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
export interface PruneAction {
  kind: "migrated" | "pruned";
  source: string;
  destination?: string;
}

export interface PruneResult {
  actions: PruneAction[];
  kept: number;
}

export function pruneVerdicts(root: string, currentIds: Map<string, string>): PruneResult {
  const dir = join(root, VERDICTS_DIR);
  const result: PruneResult = { actions: [], kept: 0 };
  if (!existsSync(dir)) return result;
  const scan = scanVerdicts(root);
  const keep = new Set<string>();
  for (const [requirementId, currentReviewId] of currentIds) {
    const stable = scan.stableFiles.get(requirementId);
    if (stable?.verdict?.reviewId === currentReviewId) {
      keep.add(stable.name);
      continue;
    }
    const legacy = scan.files.find(
      (file) => file.kind === "legacy" && file.verdict?.reviewId === currentReviewId,
    );
    if (legacy?.verdict) {
      const destination = `${requirementId}.json`;
      writeFileSync(join(dir, destination), `${JSON.stringify(legacy.verdict, null, 2)}\n`);
      keep.add(destination);
      result.actions.push({ kind: "migrated", source: legacy.name, destination });
    }
  }
  for (const file of scan.files) {
    if (file.kind === "stable" && keep.has(file.name)) continue;
    // A migrated source is already represented by its conversion action.
    const migrated = result.actions.some((action) => action.kind === "migrated" && action.source === file.name);
    if (existsSync(join(dir, file.name))) unlinkSync(join(dir, file.name));
    if (!migrated) result.actions.push({ kind: "pruned", source: file.name });
  }
  result.kept = keep.size;
  return result;
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
  const parts = splitReviewId(reviewId);
  if (!parts || parts.requirementId !== requirementId) {
    throw new Error(`Review ID ${reviewId} does not belong to ${requirementId}`);
  }
  ensureReviewStorageRules(root);
  const record: Verdict = {
    reviewId,
    requirementId,
    hash: parts.hash,
    verdict,
    summary,
    timestamp: new Date().toISOString(),
  };
  mkdirSync(join(root, VERDICTS_DIR), { recursive: true });
  const path = verdictPath(root, requirementId);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  // Successful replacement removes every legacy version of this one
  // requirement without touching independently reviewed requirements.
  for (const name of readdirSync(join(root, VERDICTS_DIR))) {
    if (!name.endsWith(".json")) continue;
    const legacy = splitReviewId(name.replace(/\.json$/, ""));
    if (legacy?.requirementId === requirementId) unlinkSync(join(root, VERDICTS_DIR, name));
  }
  return record;
}
