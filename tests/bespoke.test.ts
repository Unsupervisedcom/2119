import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec.js";
import { computeCoverage } from "../src/cover.js";
import { computeReviewTargets, generateInstructions } from "../src/review.js";
import { runVerifyCommands, VERIFY_TIMEOUT_MS } from "../src/verify.js";
import { buildContext } from "../src/check.js";
import { DEFAULT_ENFORCE, loadConfig } from "../src/config.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

const SPEC = `# REQ-001: Widgets

## Overview

Widgets.

## Requirements

### REQ-001.1: Basics

1. Policy MUST hold. [review: docs/**, instructions: .2119/review/policy.md]
2. The marker file MUST exist. [verify: node -e "process.exit(require('fs').existsSync('marker.txt') ? 0 : 1)"]
`;

function fixture(spec = SPEC): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-bespoke-")));
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, ".2119/review"), { recursive: true });
  writeFileSync(join(root, "specs/REQ-001-widgets.md"), spec);
  writeFileSync(join(root, "docs/guide.md"), "# Guide\n");
  writeFileSync(join(root, ".2119/review/policy.md"), "Reject any doc that contradicts the CLI flags.\n");
  writeFileSync(join(root, "marker.txt"), "present\n");
  return root;
}

function targetsFor(root: string) {
  const specs = [parseSpec(join(root, "specs/REQ-001-widgets.md"), "REQ")];
  const coverage = computeCoverage(specs, [], DEFAULT_ENFORCE);
  return { specs, targets: computeReviewTargets(loadConfig(root), specs, coverage, ["docs/guide.md"], []) };
}

describe("bespoke validation (REQ-005)", () => {
  // 2119: REQ-005.1.1
  it("parses instructions: alongside globs inside a [review] tag", () => {
    const spec = parseSpec("REQ-001-w.md", "REQ", SPEC);
    const req = spec.sections[0].items[0];
    expect(req.coverage).toEqual({
      kind: "review",
      globs: ["docs/**"],
      instructions: ".2119/review/policy.md",
    });
    expect(req.text).toBe("Policy MUST hold.");
  });

  // 2119: REQ-005.2.5
  it("lints a [verify] tag with no command as a violation", () => {
    const empty = SPEC.replace(/\[verify:[^\]]*\]/, "[verify]");
    const spec = parseSpec("REQ-001-w.md", "REQ", empty);
    expect(spec.violations.some((v) => v.rule === "REQ-005.2.5" && v.message.includes("REQ-001.1.2"))).toBe(true);
  });

  // 2119: REQ-005.2.1
  it("runs verify commands from the repository root and passes on exit 0", () => {
    const root = fixture();
    const specs = [parseSpec(join(root, "specs/REQ-001-widgets.md"), "REQ")];
    // The command checks for marker.txt relative to cwd — it only passes if
    // cwd is the repo root.
    expect(runVerifyCommands(loadConfig(root), specs)).toEqual([]);
  });

  // 2119: REQ-005.2.2
  it("reports a failing verify command with the requirement ID and its output", () => {
    const root = fixture(
      SPEC.replace(
        /\[verify:[^\]]*\]/,
        '[verify: node -e "console.error(\'sync drift detected\'); process.exit(1)"]',
      ),
    );
    const specs = [parseSpec(join(root, "specs/REQ-001-widgets.md"), "REQ")];
    const violations = runVerifyCommands(loadConfig(root), specs);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("REQ-005.2.2");
    expect(violations[0].message).toContain("REQ-001.1.2");
    expect(violations[0].message).toContain("sync drift detected");
  });

  // 2119: REQ-005.2.3
  it("kills verify commands at the timeout and reports the failure", () => {
    // The mandated production default is 30 seconds.
    expect(VERIFY_TIMEOUT_MS).toBe(30_000);
    const root = fixture(SPEC.replace(/\[verify:[^\]]*\]/, '[verify: node -e "setTimeout(() => {}, 5000)"]'));
    const specs = [parseSpec(join(root, "specs/REQ-001-widgets.md"), "REQ")];
    const violations = runVerifyCommands(loadConfig(root), specs, 300);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("REQ-005.2.3");
    expect(violations[0].message).toContain("timeout");
  });

  // 2119: REQ-005.2.4
  it("exempts verify-tagged requirements from annotation coverage and judgment reviews", () => {
    const root = fixture();
    const { specs, targets } = targetsFor(root);
    const coverage = computeCoverage(specs, [], DEFAULT_ENFORCE);
    expect(coverage.uncovered.map((r) => r.id)).not.toContain("REQ-001.1.2");
    expect(targets.map((t) => t.requirement.id)).not.toContain("REQ-001.1.2");
  });

  // 2119: REQ-005.1.2
  it("invalidates review verdicts when the instruction file changes", () => {
    const root = fixture();
    const before = targetsFor(root).targets.find((t) => t.requirement.id === "REQ-001.1.1")!;
    writeFileSync(join(root, ".2119/review/policy.md"), "Reject any doc that contradicts the CLI flags OR the config schema.\n");
    const after = targetsFor(root).targets.find((t) => t.requirement.id === "REQ-001.1.1")!;
    expect(after.reviewId).not.toBe(before.reviewId);
  });

  // 2119: REQ-005.1.3
  it("inlines the custom criteria into the generated instruction file", () => {
    const root = fixture();
    const { targets } = targetsFor(root);
    const tasks = generateInstructions(loadConfig(root), targets, new Map());
    const task = tasks.find((t) => t.requirement.id === "REQ-001.1.1")!;
    const body = readFileSync(join(root, task.instructionPath), "utf8");
    expect(body).toContain("Additional review criteria");
    expect(body).toContain(".2119/review/policy.md");
    expect(body).toContain("Reject any doc that contradicts the CLI flags.");
  });

  // 2119: REQ-005.1.4
  it("flags a [review] tag whose instruction file does not exist", () => {
    const root = fixture(
      SPEC.replace("instructions: .2119/review/policy.md", "instructions: .2119/review/gone.md"),
    );
    const ctx = buildContext(root);
    expect(
      ctx.reviewViolations.some(
        (v) => v.rule === "REQ-005.1.4" && v.message.includes("REQ-001.1.1") && v.message.includes("gone.md"),
      ),
    ).toBe(true);
  });

  // 2119: REQ-002.3.1
  it("check runs verify commands and fails on a non-zero exit, end to end", () => {
    const root = fixture(
      `# REQ-001: Widgets\n\n## Overview\n\nWidgets.\n\n## Requirements\n\n### REQ-001.1: Basics\n\n` +
        `1. The marker file MUST exist. [verify: node -e "process.exit(require('fs').existsSync('marker.txt') ? 0 : 1)"]\n`,
    );
    const run = (args: string[]) => {
      try {
        return { status: 0, out: execFileSync("node", [CLI, ...args], { cwd: root, encoding: "utf8" }) };
      } catch (err) {
        const e = err as { status: number; stderr: string };
        return { status: e.status, out: e.stderr };
      }
    };
    expect(run(["check"]).status).toBe(0);
    writeFileSync(join(root, "marker.txt.moved"), "");
    execFileSync("node", ["-e", `require('fs').unlinkSync('${join(root, "marker.txt")}')`]);
    const failing = run(["check"]);
    expect(failing.status).toBe(1);
    expect(failing.out).toContain("REQ-005.2.2");
  });
});
