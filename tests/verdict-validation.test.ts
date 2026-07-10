import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
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

function fixture(): { root: string; reviewId: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-vv-")));
  writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC);
  writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spins', () => {})\n");
  const review = run(root, ["review"]);
  const reviewId = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
  return { root, reviewId };
}

const verdictsDir = (root: string) => join(root, ".2119/verdicts");

describe("verdict record validation (REQ-003.7)", () => {
  // 2119: REQ-003.7.1
  it("counts a verdict only when the full record is well-formed", () => {
    const { root, reviewId } = fixture();
    mkdirSync(verdictsDir(root), { recursive: true });

    // The reported exploit: a bare reviewId with no verdict field must NOT pass.
    writeFileSync(join(verdictsDir(root), `${reviewId}.json`), JSON.stringify({ reviewId }));
    const bare = run(root, ["check"]);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("malformed verdict file");

    // A typo'd verdict value fails closed too.
    writeFileSync(
      join(verdictsDir(root), `${reviewId}.json`),
      JSON.stringify({
        reviewId,
        requirementId: "FIX-001.1.1",
        hash: reviewId.slice(-12),
        verdict: "passd",
        summary: "looks fine",
        timestamp: new Date().toISOString(),
      }),
    );
    const typo = run(root, ["check"]);
    expect(typo.status).toBe(1);
    expect(typo.stderr).toContain('verdict must be exactly "pass" or "fail"');

    // A genuine record written by the CLI satisfies the gate.
    expect(run(root, ["pass", reviewId, "--summary", "asserts spin"]).status).toBe(0);
    expect(run(root, ["check"]).status).toBe(0);
  });

  // 2119: REQ-003.7.2
  it("reports unparseable or invalid verdict files as violations naming file and reason", () => {
    const { root, reviewId } = fixture();
    run(root, ["pass", reviewId, "--summary", "asserts spin"]);

    // Simulate a mangled merge: truncate the committed verdict.
    const path = join(verdictsDir(root), `${reviewId}.json`);
    writeFileSync(path, readFileSync(path, "utf8").slice(0, 20));
    const r = run(root, ["check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`.2119/verdicts/${reviewId}.json`);
    expect(r.stderr).toContain("[REQ-003.7.2]");
    expect(r.stderr).toContain("unparseable JSON");
  });

  // 2119: REQ-003.7.3
  it("treats a valid record under the wrong filename as malformed", () => {
    const { root, reviewId } = fixture();
    run(root, ["pass", reviewId, "--summary", "asserts spin"]);
    expect(run(root, ["check"]).status).toBe(0);

    renameSync(
      join(verdictsDir(root), `${reviewId}.json`),
      join(verdictsDir(root), `FIX-001.1.1--${"0".repeat(12)}.json`),
    );
    const r = run(root, ["check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("filename does not match reviewId");
  });
});
