import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec.js";
import { computeCoverage } from "../src/cover.js";
import { computeReviewTargets } from "../src/review.js";
import { loadConfig, DEFAULT_ENFORCE } from "../src/config.js";
import { walk } from "../src/files.js";
import type { Annotation } from "../src/model.js";

const SPEC = `# REQ-001: Features

## Overview

Features.

## Requirements

### REQ-001.1: Coverage

1. The storage layer MUST persist rows.
2. The parser MUST reject malformed input.
`;

const CONFIG = [
  "shared_evidence:",
  '  - "helpers/universal.ts"',
  "evidence_groups:",
  "  storage:",
    '    tests: ["tests/storage/**"]',
    '    evidence: ["helpers/storage.ts"]',
  "  parser:",
    '    tests: ["tests/parser/**"]',
    '    evidence: ["helpers/parser.ts"]',
].join("\n");

/** Two feature groups plus one universal helper — the issue #38 synthetic project shape. */
function baseProject(config = CONFIG): string {
  const root = mkdtempSync(join(tmpdir(), "2119-eg-"));
  mkdirSync(join(root, "specs"), { recursive: true });
  mkdirSync(join(root, "helpers"), { recursive: true });
  mkdirSync(join(root, "tests/storage"), { recursive: true });
  mkdirSync(join(root, "tests/parser"), { recursive: true });
  writeFileSync(join(root, "specs/REQ-001-features.md"), SPEC);
  writeFileSync(join(root, "helpers/storage.ts"), "export const storageHelper = 1;\n");
  writeFileSync(join(root, "helpers/parser.ts"), "export const parserHelper = 1;\n");
  writeFileSync(join(root, "helpers/universal.ts"), "export const universal = 1;\n");
  writeFileSync(join(root, "tests/storage/a.test.js"), "// 2119: REQ-001.1.1\ntest('persists', () => {})\n");
  writeFileSync(join(root, "tests/parser/b.test.js"), "// 2119: REQ-001.1.2\ntest('rejects', () => {})\n");
  writeFileSync(join(root, ".2119.yml"), config + "\n");
  return root;
}

function reviewIds(
  root: string,
  anns: Annotation[] = [
    { file: "tests/storage/a.test.js", line: 1, ids: ["REQ-001.1.1"] },
    { file: "tests/parser/b.test.js", line: 1, ids: ["REQ-001.1.2"] },
  ],
): Record<string, string> {
  const specs = [parseSpec("REQ-001-features.md", "REQ", SPEC)];
  const coverage = computeCoverage(specs, anns, DEFAULT_ENFORCE);
  const targets = computeReviewTargets(loadConfig(root), specs, coverage, walk(root), anns);
  return Object.fromEntries(targets.map((t) => [t.requirement.id, t.reviewId]));
}

describe("evidence group config", () => {
  // 2119: REQ-013.1.1
  it("parses evidence_groups into named groups sorted by name", () => {
    const config = loadConfig(baseProject());
    expect(config.evidenceGroups).toEqual([
      { name: "parser", tests: ["tests/parser/**"], evidence: ["helpers/parser.ts"] },
      { name: "storage", tests: ["tests/storage/**"], evidence: ["helpers/storage.ts"] },
    ]);
  });

  // 2119: REQ-013.1.2
  it("rejects a group with missing or empty tests or evidence, naming the group", () => {
    const cases = [
      "evidence_groups:\n  storage:\n    tests: [\"tests/**\"]\n",
      "evidence_groups:\n  storage:\n    evidence: [\"helpers/**\"]\n",
      "evidence_groups:\n  storage:\n    tests: []\n    evidence: [\"helpers/**\"]\n",
      "evidence_groups:\n  storage:\n    tests: [\"tests/**\"]\n    evidence: []\n",
      "evidence_groups:\n  storage: nope\n",
      "evidence_groups: nope\n",
    ];
    for (const config of cases) {
      // Every group-level cell must name the group itself, not merely the
      // config key: a group-name-less error leaves it ambiguous which of
      // several declared groups was rejected (REQ-013.1.2).
      const expected = config.includes("storage:")
        ? /evidence_groups\["storage"\]/
        : /evidence_groups/;
      expect(() => loadConfig(baseProject(config)), config).toThrow(expected);
    }
  });
});

describe("evidence group hashing", () => {
  // 2119: REQ-013.2.1
  it("includes applicable group helper content, so weakening it invalidates the dependent verdict", () => {
    const root = baseProject();
    const before = reviewIds(root);
    writeFileSync(join(root, "helpers/storage.ts"), "export const storageHelper = 2;\n");
    const after = reviewIds(root);
    expect(after["REQ-001.1.1"]).not.toBe(before["REQ-001.1.1"]);
  });

  // 2119: REQ-013.2.1
  it("hashes every file an applicable group's evidence globs match, not just the first", () => {
    // One glob matching several helpers: the requirement is about the whole
    // match set, so weakening any matched file — including the ones a
    // first-match-only hash would silently drop — must invalidate the
    // dependent verdict.
    const root = mkdtempSync(join(tmpdir(), "2119-eg-multi-"));
    mkdirSync(join(root, "specs"), { recursive: true });
    mkdirSync(join(root, "helpers"), { recursive: true });
    mkdirSync(join(root, "tests/core"), { recursive: true });
    writeFileSync(join(root, "specs/REQ-001-features.md"), SPEC);
    writeFileSync(join(root, "helpers/alpha.ts"), "export const alpha = 1;\n");
    writeFileSync(join(root, "helpers/beta.ts"), "export const beta = 1;\n");
    writeFileSync(join(root, "helpers/gamma.ts"), "export const gamma = 1;\n");
    writeFileSync(join(root, "tests/core/c.test.js"), "// 2119: REQ-001.1.1\ntest('persists', () => {})\n");
    writeFileSync(
      join(root, ".2119.yml"),
      'evidence_groups:\n  core:\n    tests: ["tests/core/**"]\n    evidence: ["helpers/*.ts"]\n',
    );
    const anns: Annotation[] = [{ file: "tests/core/c.test.js", line: 1, ids: ["REQ-001.1.1"] }];
    const before = reviewIds(root, anns)["REQ-001.1.1"];
    expect(before).toBeTruthy();
    // walk() returns paths sorted, so the matches arrive alpha, beta, gamma:
    // beta and gamma are exactly the files a first-match-only hash drops.
    for (const name of ["alpha.ts", "beta.ts", "gamma.ts"]) {
      writeFileSync(join(root, "helpers", name), `export const ${name.replace(".ts", "")} = 2;\n`);
      expect(reviewIds(root, anns)["REQ-001.1.1"], name).not.toBe(before);
      writeFileSync(join(root, "helpers", name), `export const ${name.replace(".ts", "")} = 1;\n`);
      expect(reviewIds(root, anns)["REQ-001.1.1"], `${name} restored`).toBe(before);
    }
  });

  // 2119: REQ-013.2.1
  it("hashes the union of every group the requirement's covering tests belong to", () => {
    const root = baseProject();
    // REQ-001.1.1 is covered by one test file per group: both groups' helpers
    // must join its hash, so weakening either one invalidates it.
    const anns: Annotation[] = [
      { file: "tests/storage/a.test.js", line: 1, ids: ["REQ-001.1.1"] },
      { file: "tests/parser/b.test.js", line: 1, ids: ["REQ-001.1.1"] },
      { file: "tests/parser/b.test.js", line: 1, ids: ["REQ-001.1.2"] },
    ];
    const both = reviewIds(root, anns);
    writeFileSync(join(root, "helpers/parser.ts"), "export const parserHelper = 2;\n");
    expect(reviewIds(root, anns)["REQ-001.1.1"]).not.toBe(both["REQ-001.1.1"]);
    writeFileSync(join(root, "helpers/parser.ts"), "export const parserHelper = 1;\n");
    writeFileSync(join(root, "helpers/storage.ts"), "export const storageHelper = 2;\n");
    expect(reviewIds(root, anns)["REQ-001.1.1"]).not.toBe(both["REQ-001.1.1"]);
  });

  // 2119: REQ-013.2.2
  it("binds declared globs so editing, reordering (no scope change), or removing a mapping has the recorded effect", () => {
    const root = baseProject();
    const before = reviewIds(root);
    // Cosmetic reorder — same declared scope, so no invalidation.
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG.replace(
        "    tests: [\"tests/storage/**\"]\n    evidence: [\"helpers/storage.ts\"]",
        "    evidence: [\"helpers/storage.ts\"]\n    tests: [\"tests/storage/**\"]",
      ) + "\n",
    );
    expect(reviewIds(root)["REQ-001.1.1"]).toBe(before["REQ-001.1.1"]);
    // Scope edit: the group now also covers the universal helper.
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG.replace(
        "    evidence: [\"helpers/storage.ts\"]",
        "    evidence: [\"helpers/storage.ts\", \"helpers/universal.ts\"]",
      ) + "\n",
    );
    expect(reviewIds(root)["REQ-001.1.1"]).not.toBe(before["REQ-001.1.1"]);
    // Mapping removal cannot retain the old approval for the affected evidence.
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG.replace(/  storage:\n(?:    .*\n)+/, "") + "\n",
    );
    const afterRemove = reviewIds(root);
    expect(afterRemove["REQ-001.1.1"]).not.toBe(before["REQ-001.1.1"]);
    // Removing an inapplicable group leaves the unrelated requirement's hash alone.
    expect(afterRemove["REQ-001.1.2"]).toBe(before["REQ-001.1.2"]);
  });

  // 2119: REQ-013.2.2
  it("invalidates on a declaration-only mapping edit, with no change to matched files or applicability", () => {
    const root = baseProject();
    const before = reviewIds(root);
    // Evidence glob swapped for an equivalent-matching one: the matched file
    // set and the applicability predicate are unchanged, so the only thing
    // that moved is the declared boundary itself — and the declaration is
    // part of the review identity (REQ-013.2.2).
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG.replace(
        '    evidence: ["helpers/storage.ts"]',
        '    evidence: ["helpers/stor*.ts"]',
      ) + "\n",
    );
    expect(reviewIds(root)["REQ-001.1.1"]).not.toBe(before["REQ-001.1.1"]);
    // A storage-scoped declaration edit leaves the unrelated feature's hash alone.
    expect(reviewIds(root)["REQ-001.1.2"]).toBe(before["REQ-001.1.2"]);
    // tests-glob edit that likewise changes no applicability: a redundant
    // extra glob over the same covering files still rewrites the declared
    // mapping, so the dependent verdict cannot ride through it.
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG.replace(
        '    tests: ["tests/storage/**"]',
        '    tests: ["tests/storage/**", "tests/storage/*.test.js"]',
      ) + "\n",
    );
    expect(reviewIds(root)["REQ-001.1.1"]).not.toBe(before["REQ-001.1.1"]);
  });

  // 2119: REQ-013.4.1
  it("excludes inapplicable groups' content and declarations from a requirement's review hash", () => {
    const root = baseProject();
    const before = reviewIds(root);
    writeFileSync(join(root, "helpers/parser.ts"), "export const parserHelper = 2;\n");
    const after = reviewIds(root);
    expect(after["REQ-001.1.2"]).not.toBe(before["REQ-001.1.2"]);
    expect(after["REQ-001.1.1"]).toBe(before["REQ-001.1.1"]);
  });

  // 2119: REQ-003.1.8
  it("keeps global shared_evidence hashed into every test-quality review", () => {
    const root = baseProject();
    const before = reviewIds(root);
    writeFileSync(join(root, "helpers/universal.ts"), "export const universal = 2;\n");
    const after = reviewIds(root);
    expect(after["REQ-001.1.1"]).not.toBe(before["REQ-001.1.1"]);
    expect(after["REQ-001.1.2"]).not.toBe(before["REQ-001.1.2"]);
  });
});

// --- end-to-end: the issue #38 evaluation properties, through the real gate ---

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cwd: string, args: string[]): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

/** Build the project, generate instructions, record passing verdicts for both requirements. */
function greenProject(): string {
  const root = realpathSync(baseProject());
  run(root, ["review"]);
  for (const name of readdirSync(join(root, ".2119/reviews"))) {
    if (!name.endsWith(".md")) continue;
    const reviewId = name.replace(/\.md$/, "");
    const recorded = run(root, ["pass", reviewId, "--summary", "fixture: valid test-quality review"]);
    expect(recorded.status).toBe(0);
  }
  const check = run(root, ["check"]);
  expect(check.status).toBe(0);
  return root;
}

describe("evidence group gate behavior", () => {
  // 2119: REQ-013.2.1, REQ-013.4.1
  it("a changed group helper invalidates its dependent review and leaves the unrelated feature's reviews current", () => {
    const root = greenProject();
    writeFileSync(join(root, "helpers/storage.ts"), "export const storageHelper = 2;\n");
    const check = run(root, ["check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("REQ-001.1.1");
    expect(check.stderr).not.toContain("REQ-001.1.2");
  });

  // 2119: REQ-003.1.8
  it("weakening the universal helper invalidates both groups", () => {
    const root = greenProject();
    writeFileSync(join(root, "helpers/universal.ts"), "export const universal = 2;\n");
    const check = run(root, ["check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("REQ-001.1.1");
    expect(check.stderr).toContain("REQ-001.1.2");
  });

  // 2119: REQ-013.2.2
  it("removing a dependency mapping cannot retain the old approval for the affected evidence", () => {
    const root = greenProject();
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG.replace(/  storage:\n(?:    .*\n)+/, "") + "\n",
    );
    const check = run(root, ["check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("REQ-001.1.1");
    expect(check.stderr).not.toContain("REQ-001.1.2");
  });

  // 2119: REQ-013.3.1
  it("surfaces groups whose globs match no files instead of reading them as coverage", () => {
    const root = greenProject();
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG + "\n  typo:\n    tests: [\"tests/storage/**\"]\n    evidence: [\"helpers/nope/**\"]\n" + "\n",
    );
    const check = run(root, ["check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('evidence group "typo"');
    expect(check.stderr).toContain("helpers/nope/**");
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG + "\n  typo:\n    tests: [\"tests/missing/**\"]\n    evidence: [\"helpers/storage.ts\"]\n" + "\n",
    );
    const checkTests = run(root, ["check"]);
    expect(checkTests.status).toBe(1);
    expect(checkTests.stderr).toContain('evidence group "typo"');
    expect(checkTests.stderr).toContain("tests/missing/**");
  });

  // 2119: REQ-013.1.2
  it("rejects a declared group with a missing or empty evidence list at the gate, naming the group", () => {
    const root = greenProject();
    const brokenGroups = [
      // Missing evidence key.
      '  storage:\n    tests: ["tests/storage/**"]\n',
      // Empty evidence list with tests present.
      '  storage:\n    tests: ["tests/storage/**"]\n    evidence: []\n',
    ];
    for (const group of brokenGroups) {
      writeFileSync(
        join(root, ".2119.yml"),
        `shared_evidence:\n  - "helpers/universal.ts"\nevidence_groups:\n${group}`,
      );
      const check = run(root, ["check"]);
      expect(check.status, group).not.toBe(0);
      // The gate error names the rejected group, not just the config key.
      expect(check.stderr, group).toContain('evidence_groups["storage"]');
    }
  });

  // 2119: REQ-013.2.1, REQ-013.4.1
  it("check --changed marks exactly the group's dependent requirement affected", () => {
    const root = greenProject();
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "2119 tests");
    git(root, "config", "user.email", "tests@2119.invalid");
    git(root, "add", ".");
    git(root, "commit", "-m", "reviewed baseline");
    writeFileSync(join(root, "helpers/storage.ts"), "export const storageHelper = 2;\n");
    const result = run(root, ["check", "--changed", "HEAD", "--json"]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as { staleReviews: string[]; violations: Array<{ message: string }> };
    expect(report.staleReviews.join("\n")).toContain("REQ-001.1.1");
    expect(report.staleReviews.join("\n")).not.toContain("REQ-001.1.2");
    expect(report.violations.map((v) => v.message).join("\n")).not.toContain("REQ-001.1.2");
  });

  // 2119: REQ-013.3.1
  it("check --changed surfaces unresolved group globs when the config changed", () => {
    const root = greenProject();
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "2119 tests");
    git(root, "config", "user.email", "tests@2119.invalid");
    git(root, "add", ".");
    git(root, "commit", "-m", "reviewed baseline");
    writeFileSync(
      join(root, ".2119.yml"),
      CONFIG + "\n  typo:\n    tests: [\"tests/storage/**\"]\n    evidence: [\"helpers/nope/**\"]\n" + "\n",
    );
    const result = run(root, ["check", "--changed", "HEAD", "--json"]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as { violations: Array<{ rule: string; message: string }> };
    expect(report.violations.some((v) => v.rule === "REQ-013.3.1" && v.message.includes("typo"))).toBe(true);
  });

  // 2119: REQ-010.2.1 (guard parity with shared_evidence)
  it("check --changed refuses an ignored helper matched by a group's evidence globs", () => {
    const root = greenProject();
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "2119 tests");
    git(root, "config", "user.email", "tests@2119.invalid");
    writeFileSync(join(root, ".gitignore"), "helpers/storage.ts\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "reviewed baseline");
    const result = run(root, ["check", "--changed", "HEAD"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot compare ignored requirement dependency");
    expect(result.stderr).toContain("helpers/storage.ts");
  });
});
