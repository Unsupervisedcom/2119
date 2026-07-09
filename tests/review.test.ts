import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec.js";
import { computeCoverage } from "../src/cover.js";
import { computeReviewTargets, generateInstructions, verdictViolations } from "../src/review.js";
import { computeReviewId, splitReviewId } from "../src/hash.js";
import { readVerdicts, writeVerdict } from "../src/verdict.js";
import { DEFAULT_ENFORCE, DEFAULT_REVIEW_MODEL, loadConfig } from "../src/config.js";
import type { Annotation } from "../src/model.js";

const SPEC = `# REQ-001: Widgets

## Overview

Widgets.

## Requirements

### REQ-001.1: Basics

1. The widget MUST spin.
2. Docs MUST stay accurate. [review: docs/**]
3. Policy MUST be sensible. [review]
`;

function fixture(): { root: string; config: ReturnType<typeof loadConfig> } {
  const root = mkdtempSync(join(tmpdir(), "2119-"));
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "tests/widget.test.js"), "test('spins', () => {})\n");
  writeFileSync(join(root, "docs/guide.md"), "# Guide\n");
  return { root, config: loadConfig(root) };
}

function targetsFor(root: string) {
  const specs = [parseSpec("REQ-001-widgets.md", "REQ", SPEC)];
  const anns: Annotation[] = [{ file: "tests/widget.test.js", line: 1, ids: ["REQ-001.1.1"] }];
  const coverage = computeCoverage(specs, anns, DEFAULT_ENFORCE);
  const config = loadConfig(root);
  return computeReviewTargets(config, specs, coverage, ["tests/widget.test.js", "docs/guide.md"]);
}

describe("judgment reviews", () => {
  // 2119: REQ-003.1.2
  it("builds review IDs as <req-id>--<hash12> over statement text plus sorted evidence content", () => {
    const { root } = fixture();
    const id = computeReviewId(root, "REQ-001.1.1", "The widget MUST spin.", ["tests/widget.test.js"]);
    expect(id).toMatch(/^REQ-001\.1\.1--[0-9a-f]{12}$/);
    expect(splitReviewId(id)).toEqual({ requirementId: "REQ-001.1.1", hash: id.slice(-12) });

    // Any edit to a covering test invalidates the ID.
    writeFileSync(join(root, "tests/widget.test.js"), "test('spins', () => { expect(1).toBe(1) })\n");
    const after = computeReviewId(root, "REQ-001.1.1", "The widget MUST spin.", ["tests/widget.test.js"]);
    expect(after).not.toBe(id);

    // Changing the requirement text also invalidates it.
    const reworded = computeReviewId(root, "REQ-001.1.1", "The widget MUST rotate.", ["tests/widget.test.js"]);
    expect(reworded).not.toBe(after);
  });

  // 2119: REQ-003.1.3
  it("hashes [review: globs] requirements over the files matching their globs", () => {
    const { root } = fixture();
    const before = targetsFor(root).find((t) => t.requirement.id === "REQ-001.1.2")!;
    expect(before.evidence).toEqual(["docs/guide.md"]);
    writeFileSync(join(root, "docs/guide.md"), "# Guide\n\nEdited.\n");
    const after = targetsFor(root).find((t) => t.requirement.id === "REQ-001.1.2")!;
    expect(after.reviewId).not.toBe(before.reviewId);
  });

  it("gives bare [review] requirements a text-only hash and test-covered ones a test-quality review", () => {
    const { root } = fixture();
    const targets = targetsFor(root);
    expect(targets.map((t) => [t.requirement.id, t.kind])).toEqual([
      ["REQ-001.1.1", "test-quality"],
      ["REQ-001.1.2", "requirement"],
      ["REQ-001.1.3", "requirement"],
    ]);
    expect(targets[2].evidence).toEqual([]);
  });

  // 2119: REQ-003.1.1
  it("emits one self-contained instruction file per pending review", () => {
    const { root, config } = fixture();
    const tasks = generateInstructions(config, targetsFor(root), new Map());
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.instructionPath).toBe(`.2119/reviews/${t.reviewId}.md`);
      const body = readFileSync(join(root, t.instructionPath), "utf8");
      expect(body).toContain(t.requirement.text);
      // The evidence files hashed into the review ID are listed for the reviewer.
      for (const evidence of t.evidence) expect(body).toContain(`- ${evidence}`);
      expect(body).toContain(`2119 pass ${t.reviewId}`);
      expect(body).toContain(`2119 fail ${t.reviewId}`);
    }
    // The test-quality task really lists its covering test file.
    const testQuality = tasks.find((t) => t.kind === "test-quality")!;
    expect(readFileSync(join(root, testQuality.instructionPath), "utf8")).toContain("tests/widget.test.js");
  });

  // 2119: REQ-003.1.5
  it("directs test-quality reviewers at the would-it-fail question and cheat patterns", () => {
    const { root, config } = fixture();
    const tasks = generateInstructions(config, targetsFor(root), new Map());
    const body = readFileSync(join(root, tasks[0].instructionPath), "utf8");
    expect(body).toContain("Would the covering tests fail if this requirement were violated?");
    expect(body).toContain("Tautological assertions");
    expect(body).toContain("Over-mocking");
    expect(body).toContain("Unrelated assertions");
  });

  // 2119: REQ-003.5.1
  it("defaults review_model to a platform-neutral phrase and honors configured values", () => {
    const { root } = fixture();
    const defaults = loadConfig(root);
    expect(defaults.reviewModel).toBe(DEFAULT_REVIEW_MODEL);
    expect(DEFAULT_REVIEW_MODEL).toBe("a capable, cost-effective model"); // no vendor model name
    expect(defaults.reviewModelExplicit).toBe(false);

    writeFileSync(join(root, ".2119.yml"), 'review_model: "opus"\n');
    const configured = loadConfig(root);
    expect(configured.reviewModel).toBe("opus");
    expect(configured.reviewModelExplicit).toBe(true);
  });

  // 2119: REQ-003.5.2, REQ-003.5.3
  it("recommends the pinned model for test-quality reviews and the dispatcher's own model for [review] ones", () => {
    const { root } = fixture();
    writeFileSync(join(root, ".2119.yml"), 'review_model: "opus"\n');
    const config = loadConfig(root);
    const tasks = generateInstructions(config, targetsFor(root), new Map());
    const testQuality = tasks.find((t) => t.kind === "test-quality")!;
    const judgment = tasks.find((t) => t.kind === "requirement")!;
    expect(readFileSync(join(root, testQuality.instructionPath), "utf8")).toContain(
      "Recommended reviewer model: opus",
    );
    expect(readFileSync(join(root, judgment.instructionPath), "utf8")).toContain(
      "Recommended reviewer model: your current model",
    );
  });

  // 2119: REQ-003.4.1
  it("directs that the reviewer be a fresh-context agent that did not write the code", () => {
    const { root, config } = fixture();
    const tasks = generateInstructions(config, targetsFor(root), new Map());
    const body = readFileSync(join(root, tasks[0].instructionPath), "utf8");
    expect(body).toContain("fresh-context reviewer");
    expect(body).toContain("must not be the agent that wrote the code");
  });

  // 2119: REQ-003.1.4
  it("skips reviews whose current review ID already has a passing verdict", () => {
    const { root, config } = fixture();
    const targets = targetsFor(root);
    writeVerdict(root, targets[0].reviewId, targets[0].requirement.id, "pass", "genuine");
    const tasks = generateInstructions(config, targets, readVerdicts(root));
    expect(tasks.map((t) => t.requirement.id)).toEqual(["REQ-001.1.2", "REQ-001.1.3"]);
  });

  // 2119: REQ-003.2.1
  it("records verdicts with review ID, requirement ID, hash, summary, and ISO 8601 timestamp", () => {
    const { root } = fixture();
    const targets = targetsFor(root);
    writeVerdict(root, targets[0].reviewId, "REQ-001.1.1", "pass", "asserts real spin behavior");
    const v = readVerdicts(root).get(targets[0].reviewId)!;
    expect(v.requirementId).toBe("REQ-001.1.1");
    expect(v.hash).toBe(targets[0].reviewId.slice(-12));
    expect(v.summary).toBe("asserts real spin behavior");
    expect(v.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // 2119: REQ-003.3.1
  it("reports missing and stale verdicts as check violations", () => {
    const { root } = fixture();
    const targets = targetsFor(root);
    const missing = verdictViolations(targets, new Map());
    expect(missing).toHaveLength(3);
    expect(missing.every((v) => v.rule === "REQ-003.3.1")).toBe(true);

    // A verdict recorded against an older hash does not satisfy the current ID.
    writeVerdict(root, `REQ-001.1.1--${"0".repeat(12)}`, "REQ-001.1.1", "pass", "old");
    const stale = verdictViolations(targets, readVerdicts(root));
    expect(stale.some((v) => v.message.includes("REQ-001.1.1"))).toBe(true);
  });

  // 2119: REQ-003.2.4
  it("treats a failing verdict as a check violation until superseded", () => {
    const { root } = fixture();
    const targets = targetsFor(root);
    writeVerdict(root, targets[0].reviewId, "REQ-001.1.1", "fail", "tautological assertion");
    const violations = verdictViolations(targets, readVerdicts(root));
    expect(violations.some((v) => v.rule === "REQ-003.2.4" && v.message.includes("tautological"))).toBe(true);

    writeVerdict(root, targets[0].reviewId, "REQ-001.1.1", "pass", "rewritten; now genuine");
    const after = verdictViolations(targets, readVerdicts(root));
    expect(after.filter((v) => v.message.includes("REQ-001.1.1--"))).toEqual([]);
  });

  // 2119: REQ-003.3.2
  it("ignores verdicts for tombstoned requirements instead of reporting staleness", () => {
    const { root } = fixture();
    const tombSpec = parseSpec(
      "REQ-001-widgets.md",
      "REQ",
      SPEC.replace("Policy MUST be sensible. [review]", "REQUIREMENT REMOVED"),
    );
    const coverage = computeCoverage([tombSpec], [{ file: "tests/widget.test.js", line: 1, ids: ["REQ-001.1.1"] }], DEFAULT_ENFORCE);
    const targets = computeReviewTargets(loadConfig(root), [tombSpec], coverage, []);
    expect(targets.map((t) => t.requirement.id)).not.toContain("REQ-001.1.3");
    // An old verdict for the tombstoned requirement produces no violation.
    writeVerdict(root, `REQ-001.1.3--${"a".repeat(12)}`, "REQ-001.1.3", "pass", "obsolete");
    expect(verdictViolations(targets, readVerdicts(root)).map((v) => v.message).join()).not.toContain("REQ-001.1.3");
  });
});
