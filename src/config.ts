import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/** A declared dependency boundary: covering test-file globs → helper/fixture globs (REQ-013.1.1). */
export interface EvidenceGroup {
  name: string;
  /** Globs matching the group's covering test files. */
  tests: string[];
  /** Globs matching the helpers/fixtures those tests depend on. */
  evidence: string[];
}

export interface Config {
  root: string;
  /** Globs selecting spec files. */
  specs: string[];
  /** Globs selecting files scanned for test annotations. */
  tests: string[];
  /** Requirement ID prefix, e.g. "REQ" or "DW-REQ". */
  prefix: string;
  /** Keyword severities whose requirements need coverage. */
  enforce: string[];
  /** Whether judgment reviews are required for covered requirements. */
  reviews: boolean;
  /** Recommended reviewer model for test-quality reviews (advisory). */
  reviewModel: string;
  /** True when review_model was set in .2119.yml (vs. defaulted). */
  reviewModelExplicit: boolean;
  /** Globs of shared fixtures/helpers hashed into every test-quality review (REQ-003.1.8). */
  sharedEvidence: string[];
  /** Scoped dependency groups hashed only into reviews their tests cover (REQ-013.2.1), sorted by name. */
  evidenceGroups: EvidenceGroup[];
  /** All recommended reviewer models; reviewModel is their display join (REQ-003.5.6). */
  reviewModels: string[];
  /** Extra comment leaders recognized for annotations (REQ-002.2.7). */
  commentLeaders: string[];
  /** "always" makes plain `review` also generate audit instructions (REQ-003.6.4). */
  auditAlways: boolean;
  /** True when a .2119.yml file was found. */
  explicit: boolean;
}

// Platform-neutral: 2119 runs under Claude Code, Codex, Gemini, and others,
// so the default recommendation is a tier description, not a model name.
export const DEFAULT_REVIEW_MODEL = "a capable, cost-effective model";

export const DEFAULT_ENFORCE = ["MUST", "MUST NOT", "SHALL", "SHALL NOT", "REQUIRED"];

export const DEFAULT_TEST_GLOBS = [
  "test/**",
  "tests/**",
  "spec/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test_*.py",
];

export const CONFIG_FILENAME = ".2119.yml";

export function loadConfig(root: string): Config {
  const path = join(root, CONFIG_FILENAME);
  let raw: Record<string, unknown> = {};
  let explicit = false;
  if (existsSync(path)) {
    explicit = true;
    const parsed = parseYaml(readFileSync(path, "utf8"));
    if (parsed !== null && typeof parsed !== "object") {
      throw new Error(`${CONFIG_FILENAME} must be a YAML mapping`);
    }
    raw = (parsed ?? {}) as Record<string, unknown>;
  }
  const prefix = typeof raw.prefix === "string" ? raw.prefix : "REQ";
  // review_model accepts a single value or a list; all values are advisory
  // strings resolved by the dispatching agent, never invoked here (REQ-003.5.6).
  const reviewModels = stringList(raw.review_model) ?? [DEFAULT_REVIEW_MODEL];
  return {
    root,
    // Matches file-scoped spec filenames too (REQ-011.3.1) — they carry no `<prefix>-` substring.
    specs: stringList(raw.specs) ?? [`specs/**/*.md`],
    tests: stringList(raw.tests) ?? DEFAULT_TEST_GLOBS,
    prefix,
    enforce: stringList(raw.enforce) ?? DEFAULT_ENFORCE,
    reviews: raw.reviews === undefined ? true : Boolean(raw.reviews),
    reviewModel: reviewModels.join(", "),
    reviewModelExplicit: raw.review_model !== undefined,
    reviewModels,
    sharedEvidence: stringList(raw.shared_evidence) ?? [],
    evidenceGroups: parseEvidenceGroups(raw.evidence_groups),
    commentLeaders: stringList(raw.comment_leaders) ?? [],
    auditAlways: raw.audit === "always",
    explicit,
  };
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  throw new Error(`Expected a string or list of strings, got: ${JSON.stringify(value)}`);
}

/**
 * Parse the optional `evidence_groups` mapping (REQ-013.1). A group with a
 * missing or empty `tests`/`evidence` list is rejected with an error naming
 * the group (REQ-013.1.2) — silently reading it as empty coverage would hide
 * a dependency boundary the author believed they had declared.
 */
function parseEvidenceGroups(value: unknown): EvidenceGroup[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`evidence_groups must be a mapping of group name to { tests, evidence }, got: ${JSON.stringify(value)}`);
  }
  const out: EvidenceGroup[] = [];
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`evidence_groups["${name}"] must be a mapping with "tests" and "evidence" glob lists`);
    }
    const group = raw as Record<string, unknown>;
    const tests = stringList(group.tests);
    const evidence = stringList(group.evidence);
    if (!tests || tests.length === 0 || !evidence || evidence.length === 0) {
      throw new Error(`evidence_groups["${name}"] must define non-empty "tests" and "evidence" glob lists`);
    }
    out.push({ name, tests, evidence });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
