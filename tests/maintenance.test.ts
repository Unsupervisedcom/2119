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
  it("review deletes instruction files that are no longer pending", async () => {
    const { buildContext } = await import("../src/check.js");
    const root = fixture();
    writeFileSync(join(root, "specs/FIX-001-widgets.md"), `${SPEC}2. The widget MUST stop.\n`);
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spin v1', () => {})\n// 2119: FIX-001.1.2\ntest('stop', () => {})\n",
    );
    run(root, ["review"]);
    const before = reviewFiles(root);
    expect(before).toHaveLength(2);
    const superseded = before.find((file) => file.startsWith("FIX-001.1.1--"))!;
    const passingId = before.find((file) => file.startsWith("FIX-001.1.2--"))!.replace(/\.md$/, "");
    expect(run(root, ["pass", passingId, "--summary", "stop is covered"]).status).toBe(0);

    // Editing the covering test mints a new review ID; the old file must go.
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spin v2', () => {})\n// 2119: FIX-001.1.2\ntest('stop', () => {})\n",
    );
    writeFileSync(join(root, ".2119/reviews/not-pending.md"), "obsolete packet\n");
    run(root, ["review"]);
    const ctx = buildContext(root);
    const current = ctx.reviewTargets
      .filter((target) => ctx.verdicts.get(target.reviewId)?.verdict !== "pass")
      .map((target) => target.reviewId);
    const after = reviewFiles(root);
    expect(after.sort()).toEqual(current.map((id) => `${id}.md`).sort());
    expect(existsSync(join(root, ".2119/reviews", superseded))).toBe(false);
  });

  // 2119: REQ-006.1.2
  it("review empties the directory when nothing is pending", () => {
    const root = fixture();
    const review = run(root, ["review"]);
    const id = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    run(root, ["pass", id, "--summary", "asserts spin"]);
    run(root, ["review", "--audit"]);
    expect(reviewFiles(root).some((file) => file.endsWith(".audit.md"))).toBe(true);
    writeFileSync(join(root, ".2119/reviews/stale.md"), "obsolete packet\n");

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
    const stalePath = join(root, ".2119/verdicts/FIX-001.1.1.json");
    expect(existsSync(stalePath)).toBe(true);
    const orphanPath = join(root, ".2119/verdicts/FIX-999.1.1.json");
    const orphanId = `FIX-999.1.1--${"a".repeat(12)}`;
    writeFileSync(
      orphanPath,
      `${JSON.stringify({
        reviewId: orphanId,
        requirementId: "FIX-999.1.1",
        hash: "a".repeat(12),
        verdict: "pass",
        summary: "orphan evidence",
        timestamp: "2026-08-03T00:00:00.000Z",
      })}\n`,
    );
    expect(existsSync(orphanPath)).toBe(true);
    const legacyOrphanId = `FIX-998.1.1--${"b".repeat(12)}`;
    const legacyOrphanPath = join(root, `.2119/verdicts/${legacyOrphanId}.json`);
    writeFileSync(
      legacyOrphanPath,
      `${JSON.stringify({
        reviewId: legacyOrphanId,
        requirementId: "FIX-998.1.1",
        hash: "b".repeat(12),
        verdict: "pass",
        summary: "legacy orphan evidence",
        timestamp: "2026-08-03T00:00:00.000Z",
      })}\n`,
    );
    expect(existsSync(legacyOrphanPath)).toBe(true);

    // Invalidate: the passed verdict is now orphaned.
    writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spin v2', () => {})\n");
    const prune = run(root, ["prune"]);
    expect(prune.status).toBe(0);
    expect(prune.stdout).toContain("pruned .2119/verdicts/FIX-001.1.1.json");
    expect(prune.stdout).toContain("pruned .2119/verdicts/FIX-999.1.1.json");
    expect(prune.stdout).toContain(`pruned .2119/verdicts/${legacyOrphanId}.json`);
    expect(prune.stdout).toContain("removed 3 orphaned verdict(s)");
    expect(existsSync(stalePath)).toBe(false);
    expect(existsSync(orphanPath)).toBe(false);
    expect(existsSync(legacyOrphanPath)).toBe(false);
  });

  // 2119: REQ-006.2.2
  it("prune keeps current verdicts, and check still passes afterwards", async () => {
    const { readFileSync, statSync, utimesSync } = await import("node:fs");
    const root = fixture();
    const review = run(root, ["review"]);
    const id = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    run(root, ["pass", id, "--summary", "asserts spin"]);
    expect(run(root, ["check"]).status).toBe(0);
    const verdictPath = join(root, ".2119/verdicts/FIX-001.1.1.json");
    const before = readFileSync(verdictPath, "utf8");
    utimesSync(verdictPath, new Date(0), new Date(0));

    const prune = run(root, ["prune"]);
    expect(prune.stdout).toContain("removed 0 orphaned verdict(s)");
    expect(readFileSync(verdictPath, "utf8")).toBe(before);
    expect(statSync(verdictPath).mtimeMs).toBe(0);
    expect(run(root, ["check"]).status).toBe(0);
  });
});
