import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

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
  return {
    root,
    specs: stringList(raw.specs) ?? [`specs/**/*${prefix}-*.md`],
    tests: stringList(raw.tests) ?? DEFAULT_TEST_GLOBS,
    prefix,
    enforce: stringList(raw.enforce) ?? DEFAULT_ENFORCE,
    reviews: raw.reviews === undefined ? true : Boolean(raw.reviews),
    reviewModel: typeof raw.review_model === "string" ? raw.review_model : DEFAULT_REVIEW_MODEL,
    reviewModelExplicit: typeof raw.review_model === "string",
    sharedEvidence: stringList(raw.shared_evidence) ?? [],
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
