import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" }), stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const SPEC = `# FIX-001: Widgets

## Overview

Widgets.

## Requirements

### FIX-001.1: Basics

1. The widget MUST spin.
`;

function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-maint-")));
  writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC);
  writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spin v1', () => {})\n");
  return root;
}

const reviewFiles = (root: string) => readdirSync(join(root, ".2119/reviews")).filter((f) => f.endsWith(".md"));

describe("state maintenance (REQ-006)", () => {
  // 2119: REQ-006.1.1
  it("review deletes instruction files that are no longer pending", () => {
    const root = fixture();
    run(root, ["review"]);
    const [before] = reviewFiles(root);
    expect(before).toBeTruthy();

    // Editing the covering test mints a new review ID; the old file must go.
    writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spin v2', () => {})\n");
    run(root, ["review"]);
    const after = reviewFiles(root);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before);
    expect(existsSync(join(root, ".2119/reviews", before))).toBe(false);
  });

  // 2119: REQ-006.1.2
  it("review empties the directory when nothing is pending", () => {
    const root = fixture();
    const review = run(root, ["review"]);
    const id = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    run(root, ["pass", id, "--summary", "asserts spin"]);

    const clean = run(root, ["review"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("all judgment reviews have current passing verdicts");
    expect(reviewFiles(root)).toHaveLength(0);
  });

  // 2119: REQ-006.2.1
  it("prune deletes orphaned verdicts and lists each one", () => {
    const root = fixture();
    const review = run(root, ["review"]);
    const oldId = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    run(root, ["pass", oldId, "--summary", "asserts spin"]);

    // Invalidate: the passed verdict is now orphaned.
    writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spin v2', () => {})\n");
    const prune = run(root, ["prune"]);
    expect(prune.status).toBe(0);
    expect(prune.stdout).toContain(`pruned .2119/verdicts/${oldId}.json`);
    expect(prune.stdout).toContain("removed 1 orphaned verdict(s)");
    expect(existsSync(join(root, ".2119/verdicts", `${oldId}.json`))).toBe(false);
  });

  // 2119: REQ-006.2.2
  it("prune keeps current verdicts, and check still passes afterwards", () => {
    const root = fixture();
    const review = run(root, ["review"]);
    const id = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    run(root, ["pass", id, "--summary", "asserts spin"]);
    expect(run(root, ["check"]).status).toBe(0);

    const prune = run(root, ["prune"]);
    expect(prune.stdout).toContain("removed 0 orphaned verdict(s)");
    expect(existsSync(join(root, ".2119/verdicts", `${id}.json`))).toBe(true);
    expect(run(root, ["check"]).status).toBe(0);
  });
});
