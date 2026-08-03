import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../src/check.js";
import { computeReviewId, fileParts } from "../src/hash.js";
import { evidenceBlockParts } from "../src/annotations.js";
import { matchGlobs } from "../src/files.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cwd: string, args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" }), stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function startRun(cwd: string, args: string[]) {
  const child = spawn("node", [CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const result = new Promise<RunResult>((resolveResult) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolveResult({ status: code ?? 1, stdout, stderr }));
  });
  return { child, result };
}

const SPEC = `# FIX-001: Widgets

## Overview

Widgets.

## Requirements

### FIX-001.1: Basics

1. The widget MUST spin.
2. The widget MUST stop.
`;

function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-stable-verdict-")));
  writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC);
  writeFileSync(
    join(root, "tests/widget.test.js"),
    "// 2119: FIX-001.1.1\ntest('spins', () => spin())\n" +
      "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
  );
  return root;
}

function reviewIds(root: string): Record<string, string> {
  run(root, ["review"]);
  const names = readdirSync(join(root, ".2119/reviews"));
  return Object.fromEntries(
    names
      .filter((name) => name.endsWith(".md") && !name.endsWith(".audit.md"))
      .map((name) => {
        const id = name.replace(/\.md$/, "");
        return [id.replace(/--[0-9a-f]{12}$/, ""), id];
      }),
  );
}

function record(reviewId: string, verdict: "pass" | "fail", summary = "honest review") {
  return {
    reviewId,
    requirementId: reviewId.replace(/--[0-9a-f]{12}$/, ""),
    hash: reviewId.slice(-12),
    verdict,
    summary,
    timestamp: "2026-08-03T00:00:00.000Z",
  };
}

function writeRecord(root: string, filename: string, value: ReturnType<typeof record>): void {
  mkdirSync(join(root, ".2119/verdicts"), { recursive: true });
  writeFileSync(join(root, ".2119/verdicts", filename), `${JSON.stringify(value, null, 2)}\n`);
}

const stablePath = (root: string, requirementId: string) => join(root, ".2119/verdicts", `${requirementId}.json`);

function produceRecord(
  root: string,
  reviewId: string,
  verdict: "pass" | "fail",
  summary: string,
): ReturnType<typeof record> {
  expect(run(root, [verdict, reviewId, "--summary", summary]).status).toBe(0);
  const requirementId = reviewId.replace(/--[0-9a-f]{12}$/, "");
  const stable = stablePath(root, requirementId);
  const legacy = join(root, ".2119/verdicts", `${reviewId}.json`);
  const produced = existsSync(stable) ? stable : legacy;
  return JSON.parse(readFileSync(produced, "utf8"));
}

function placeLegacy(root: string, reviewId: string, value: ReturnType<typeof record>): void {
  const stable = stablePath(root, value.requirementId);
  if (existsSync(stable)) unlinkSync(stable);
  writeRecord(root, `${reviewId}.json`, value);
}

describe("stable verdict files (REQ-012)", () => {
  // 2119: REQ-012.1.1
  it("records one stable file and supersedes both its prior stable record and legacy files", () => {
    const root = fixture();
    const first = reviewIds(root)["FIX-001.1.1"];
    expect(run(root, ["pass", first, "--summary", "first honest review"]).status).toBe(0);
    const path = stablePath(root, "FIX-001.1.1");
    expect(JSON.parse(readFileSync(path, "utf8")).reviewId).toBe(first);

    // Replacement is required even when the review input and hash did not
    // change between two successful recording commands.
    expect(run(root, ["fail", first, "--summary", "same-hash replacement"]).status).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      reviewId: first,
      verdict: "fail",
      summary: "same-hash replacement",
    });
    expect(run(root, ["pass", first, "--summary", "restored same-hash pass"]).status).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      reviewId: first,
      verdict: "pass",
      summary: "restored same-hash pass",
    });

    // A legacy duplicate must not survive the next successful recording.
    writeRecord(root, `${first}.json`, record(first, "pass", "legacy duplicate"));
    expect(run(root, ["pass", first, "--summary", "pass cleans legacy duplicate"]).status).toBe(0);
    expect(readdirSync(join(root, ".2119/verdicts")).filter((name) => name.startsWith("FIX-001.1.1"))).toEqual([
      "FIX-001.1.1.json",
    ]);
    writeRecord(root, `${first}.json`, record(first, "pass", "legacy duplicate for changed hash"));
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins strongly', () => spin())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    const second = reviewIds(root)["FIX-001.1.1"];
    expect(second).not.toBe(first);
    expect(run(root, ["fail", second, "--summary", "new test is dishonest"]).status).toBe(0);

    const files = readdirSync(join(root, ".2119/verdicts")).filter((name) => name.startsWith("FIX-001.1.1"));
    expect(files).toEqual(["FIX-001.1.1.json"]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ reviewId: second, verdict: "fail" });
  });

  // 2119: REQ-012.2.1
  it("isolates overlapping recordings for distinct requirements", async () => {
    const root = fixture();
    const ids = reviewIds(root);
    const spinRun = startRun(root, ["pass", ids["FIX-001.1.1"], "--summary", "spin behavior covered"]);
    const stopRun = startRun(root, ["fail", ids["FIX-001.1.2"], "--summary", "stop boundary missing"]);
    // Both production CLI processes exist simultaneously before either is
    // awaited, so this exercises the requirement's overlapping-command case.
    expect(spinRun.child.exitCode).toBeNull();
    expect(stopRun.child.exitCode).toBeNull();
    const [spin, stop] = await Promise.all([spinRun.result, stopRun.result]);
    expect([spin.status, stop.status]).toEqual([0, 0]);
    const spinRecord = JSON.parse(readFileSync(stablePath(root, "FIX-001.1.1"), "utf8"));
    const stopRecord = JSON.parse(readFileSync(stablePath(root, "FIX-001.1.2"), "utf8"));
    expect(spinRecord).toMatchObject({
      reviewId: ids["FIX-001.1.1"],
      requirementId: "FIX-001.1.1",
      hash: ids["FIX-001.1.1"].slice(-12),
      verdict: "pass",
      summary: "spin behavior covered",
    });
    expect(stopRecord).toMatchObject({
      reviewId: ids["FIX-001.1.2"],
      requirementId: "FIX-001.1.2",
      hash: ids["FIX-001.1.2"].slice(-12),
      verdict: "fail",
      summary: "stop boundary missing",
    });
    expect(Number.isNaN(Date.parse(spinRecord.timestamp))).toBe(false);
    expect(Number.isNaN(Date.parse(stopRecord.timestamp))).toBe(false);
  });

  // 2119: REQ-012.3.1
  it("stores a complete internally content-addressed record at the canonical stable path", () => {
    const root = fixture();
    const reviewId = reviewIds(root)["FIX-001.1.1"];
    expect(run(root, ["pass", reviewId, "--summary", "spin assertion reaches production"]).status).toBe(0);
    const saved = JSON.parse(readFileSync(stablePath(root, "FIX-001.1.1"), "utf8"));
    expect(saved).toMatchObject({
      reviewId,
      requirementId: "FIX-001.1.1",
      hash: reviewId.slice(-12),
      verdict: "pass",
      summary: "spin assertion reaches production",
    });
    expect(saved.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(saved.timestamp))).toBe(false);

    expect(run(root, ["fail", reviewId, "--summary", "spin boundary is missing"]).status).toBe(0);
    const savedFail = JSON.parse(readFileSync(stablePath(root, "FIX-001.1.1"), "utf8"));
    expect(savedFail).toMatchObject({
      reviewId,
      requirementId: "FIX-001.1.1",
      hash: reviewId.slice(-12),
      verdict: "fail",
      summary: "spin boundary is missing",
    });
    expect(savedFail.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(savedFail.timestamp))).toBe(false);
    expect(run(root, ["pass", reviewId, "--summary", "spin assertion reaches production"]).status).toBe(0);

    // A second current pass keeps the unrelated requirement from masking
    // schema failures in the record under test.
    const ids = reviewIds(root);
    writeRecord(root, "FIX-001.1.2.json", record(ids["FIX-001.1.2"], "pass"));
    const valid = record(reviewId, "pass", "spin assertion reaches production");
    const malformed: Array<[string, object]> = [
      ["requirement ID", { ...valid, requirementId: "FIX-001.1.9" }],
      ["review ID", { ...valid, reviewId: ids["FIX-001.1.2"] }],
      ["uppercase hash", { ...valid, hash: valid.hash.toUpperCase() }],
      ["mismatched hash", { ...valid, hash: "0".repeat(12) }],
      ["invalid verdict", { ...valid, verdict: "passed" }],
      ["empty summary", { ...valid, summary: "" }],
      ["invalid timestamp", { ...valid, timestamp: "not-a-date" }],
    ];
    for (const field of ["reviewId", "requirementId", "hash", "verdict", "summary", "timestamp"] as const) {
      const missing = { ...valid } as Record<string, unknown>;
      delete missing[field];
      malformed.push([`missing ${field}`, missing]);
    }
    for (const [, candidate] of malformed) {
      writeFileSync(stablePath(root, "FIX-001.1.1"), `${JSON.stringify(candidate)}\n`);
      expect(run(root, ["check"]).status).toBe(1);
    }
    writeFileSync(stablePath(root, "FIX-001.1.1"), `${JSON.stringify(valid)}\n`);
    writeFileSync(join(root, ".2119/verdicts/FIX-001.1.1-wrong.json"), `${JSON.stringify(valid)}\n`);
    const wrongPath = run(root, ["check"]);
    expect(wrongPath.status).toBe(1);
    expect(wrongPath.stderr).toContain("FIX-001.1.1-wrong.json");
  });

  // 2119: REQ-012.3.2
  it("changes hashes for every review input but leaves both review kinds stable across unrelated edits", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-hash-boundary-")));
    mkdirSync(join(root, "specs"));
    mkdirSync(join(root, "tests/shared"), { recursive: true });
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, ".2119/review"), { recursive: true });
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, ".2119.yml"),
      'prefix: "FIX"\nshared_evidence: ["tests/shared/**"]\n',
    );
    writeFileSync(
      join(root, "specs/FIX-001-widgets.md"),
      SPEC.replace(
        "2. The widget MUST stop.",
        "2. The widget MUST stop.\n3. Policy MUST match the guide. [review: docs/**, instructions: .2119/review/policy.md]",
      ),
    );
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "import { fixture } from './shared/setup.js';\n" +
        "// 2119: FIX-001.1.1\ntest('spins', () => spin())\n" +
        "// 2119: FIX-001.1.1\ntest('spins again', () => spinAgain())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    writeFileSync(
      join(root, "tests/widget-extra.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins from another file', () => externalSpin())\n",
    );
    writeFileSync(join(root, "tests/shared/setup.js"), "export const fixture = 'v1';\n");
    writeFileSync(join(root, "docs/guide.md"), "policy v1\n");
    writeFileSync(join(root, ".2119/review/policy.md"), "reject contradictions\n");
    writeFileSync(join(root, "src/unrelated.ts"), "export const unrelated = 1;\n");

    const ids = () => Object.fromEntries(buildContext(root).allReviewTargets.map((t) => [t.requirement.id, t.reviewId]));
    const before = ids();
    writeFileSync(join(root, "src/unrelated.ts"), "export const unrelated = 2;\n");
    expect(ids()).toEqual(before);

    writeFileSync(
      join(root, "tests/widget.test.js"),
      "import { fixture as sharedFixture } from './shared/setup.js';\n" +
        "// 2119: FIX-001.1.1\ntest('spins', () => spin())\n" +
        "// 2119: FIX-001.1.1\ntest('spins again', () => spinAgain())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    const preludeEdit = ids();
    expect(preludeEdit["FIX-001.1.1"]).not.toBe(before["FIX-001.1.1"]);
    expect(preludeEdit["FIX-001.1.2"]).not.toBe(before["FIX-001.1.2"]);
    expect(preludeEdit["FIX-001.1.3"]).toBe(before["FIX-001.1.3"]);

    writeFileSync(
      join(root, "tests/widget.test.js"),
      "import { fixture as sharedFixture } from './shared/setup.js';\n" +
        "// 2119: FIX-001.1.1\ntest('spins twice', () => spin())\n" +
        "// 2119: FIX-001.1.1\ntest('spins again', () => spinAgain())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    const coveredEdit = ids();
    expect(coveredEdit["FIX-001.1.1"]).not.toBe(preludeEdit["FIX-001.1.1"]);
    expect(coveredEdit["FIX-001.1.2"]).toBe(preludeEdit["FIX-001.1.2"]);
    expect(coveredEdit["FIX-001.1.3"]).toBe(preludeEdit["FIX-001.1.3"]);

    writeFileSync(
      join(root, "tests/widget.test.js"),
      "import { fixture as sharedFixture } from './shared/setup.js';\n" +
        "// 2119: FIX-001.1.1\ntest('spins twice', () => spin())\n" +
        "// 2119: FIX-001.1.1\ntest('spins a third way', () => spinAgain())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    const laterBlockEdit = ids();
    expect(laterBlockEdit["FIX-001.1.1"]).not.toBe(coveredEdit["FIX-001.1.1"]);
    expect(laterBlockEdit["FIX-001.1.2"]).toBe(coveredEdit["FIX-001.1.2"]);
    expect(laterBlockEdit["FIX-001.1.3"]).toBe(coveredEdit["FIX-001.1.3"]);

    writeFileSync(
      join(root, "tests/widget-extra.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins differently from another file', () => externalSpin())\n",
    );
    const extraBlockEdit = ids();
    expect(extraBlockEdit["FIX-001.1.1"]).not.toBe(laterBlockEdit["FIX-001.1.1"]);
    expect(extraBlockEdit["FIX-001.1.2"]).toBe(laterBlockEdit["FIX-001.1.2"]);
    expect(extraBlockEdit["FIX-001.1.3"]).toBe(laterBlockEdit["FIX-001.1.3"]);

    writeFileSync(
      join(root, "tests/widget.test.js"),
      "import { fixture as sharedFixture } from './shared/setup.js';\n" +
        "// 2119: FIX-001.1.1\ntest('spins twice', () => spin())\n" +
        "// 2119: FIX-001.1.1\ntest('spins a third way', () => spinAgain())\n" +
        "// 2119: FIX-001.1.2\ntest('stops immediately', () => stop())\n",
    );
    const neighboringBlockEdit = ids();
    expect(neighboringBlockEdit["FIX-001.1.1"]).toBe(extraBlockEdit["FIX-001.1.1"]);
    expect(neighboringBlockEdit["FIX-001.1.2"]).not.toBe(extraBlockEdit["FIX-001.1.2"]);
    expect(neighboringBlockEdit["FIX-001.1.3"]).toBe(extraBlockEdit["FIX-001.1.3"]);

    writeFileSync(join(root, "tests/shared/setup.js"), "export const fixture = 'v2';\n");
    const sharedEdit = ids();
    expect(sharedEdit["FIX-001.1.1"]).not.toBe(neighboringBlockEdit["FIX-001.1.1"]);
    expect(sharedEdit["FIX-001.1.2"]).not.toBe(neighboringBlockEdit["FIX-001.1.2"]);
    expect(sharedEdit["FIX-001.1.3"]).toBe(neighboringBlockEdit["FIX-001.1.3"]);

    writeFileSync(join(root, "docs/guide.md"), "policy v2\n");
    const evidenceEdit = ids();
    expect(evidenceEdit["FIX-001.1.3"]).not.toBe(sharedEdit["FIX-001.1.3"]);
    expect(evidenceEdit["FIX-001.1.1"]).toBe(sharedEdit["FIX-001.1.1"]);
    expect(evidenceEdit["FIX-001.1.2"]).toBe(sharedEdit["FIX-001.1.2"]);
    writeFileSync(join(root, ".2119/review/policy.md"), "reject contradictions and omissions\n");
    const instructionEdit = ids();
    expect(instructionEdit["FIX-001.1.3"]).not.toBe(evidenceEdit["FIX-001.1.3"]);
    expect(instructionEdit["FIX-001.1.1"]).toBe(evidenceEdit["FIX-001.1.1"]);
    expect(instructionEdit["FIX-001.1.2"]).toBe(evidenceEdit["FIX-001.1.2"]);

    // REQ-003's canonical whole-file ordering and exact hash stream are
    // observable here, not inferred from selected sensitivity checks.
    const beforeAdditionalMatches = ids();
    writeFileSync(join(root, "docs/a.md"), "A\n");
    writeFileSync(join(root, "docs/b.md"), "B\n");
    const additionalMatches = ids();
    expect(additionalMatches["FIX-001.1.3"]).not.toBe(beforeAdditionalMatches["FIX-001.1.3"]);
    expect(additionalMatches["FIX-001.1.1"]).toBe(beforeAdditionalMatches["FIX-001.1.1"]);
    expect(additionalMatches["FIX-001.1.2"]).toBe(beforeAdditionalMatches["FIX-001.1.2"]);
    const parts = fileParts(root, ["docs/b.md", ".2119/review/policy.md", "docs/a.md"]);
    expect(parts.map((part) => part.label)).toEqual([".2119/review/policy.md", "docs/a.md", "docs/b.md"]);
    const exact = createHash("sha256").update("Policy MUST match the guide.");
    for (const part of parts) exact.update("\0").update(part.label).update("\0").update(part.content);
    const digest = exact.digest("hex").slice(0, 12);
    expect(computeReviewId("FIX-001.1.3", "Policy MUST match the guide.", parts)).toBe(
      `FIX-001.1.3--${digest}`,
    );
    expect(computeReviewId("FIX-001.1.3", "Policy MUST match every guide.", parts)).not.toBe(
      `FIX-001.1.3--${digest}`,
    );
    expect(computeReviewId("FIX-001.1.3", "Policy MUST match the guide.", [...parts].reverse())).not.toBe(
      `FIX-001.1.3--${digest}`,
    );

    const ctx = buildContext(root);
    const reviewRequirement = ctx.allReviewTargets.find((target) => target.requirement.id === "FIX-001.1.3")!;
    const matchedReviewParts = fileParts(root, [
      reviewRequirement.requirement.coverage.instructions!,
      ...matchGlobs(ctx.repoFiles, reviewRequirement.requirement.coverage.globs!),
    ]);
    expect(computeReviewId("FIX-001.1.3", reviewRequirement.requirement.text, matchedReviewParts)).toBe(
      reviewRequirement.reviewId,
    );
    const annotations = ctx.annotations.filter((annotation) => annotation.ids.includes("FIX-001.1.1"));
    const testParts = [
      ...evidenceBlockParts(root, annotations, ctx.annotations, ctx.config.prefix, ctx.markerLineByFile),
      ...fileParts(root, matchGlobs(ctx.repoFiles, ctx.config.sharedEvidence)),
    ];
    const annotationLabels = testParts
      .filter((part) => part.label.includes("widget") && part.label.includes("#"))
      .map((part) => part.label);
    // Two file preludes plus three covering annotation blocks.
    expect(annotationLabels).toEqual([
      "tests/widget-extra.test.js#prelude",
      "tests/widget-extra.test.js#0",
      "tests/widget.test.js#prelude",
      "tests/widget.test.js#0",
      "tests/widget.test.js#1",
    ]);
    const testTarget = ctx.allReviewTargets.find((target) => target.requirement.id === "FIX-001.1.1")!;
    expect(computeReviewId("FIX-001.1.1", testTarget.requirement.text, testParts)).toBe(testTarget.reviewId);
    expect(computeReviewId("FIX-001.1.1", testTarget.requirement.text, [...testParts].reverse())).not.toBe(
      testTarget.reviewId,
    );

    expect(run(root, ["pass", testTarget.reviewId, "--summary", "hash boundaries verified"]).status).toBe(0);
    expect(JSON.parse(readFileSync(stablePath(root, "FIX-001.1.1"), "utf8")).hash).toBe(
      testTarget.reviewId.slice(-12),
    );
    expect(run(root, ["pass", reviewRequirement.reviewId, "--summary", "review evidence hash verified"]).status).toBe(0);
    expect(JSON.parse(readFileSync(stablePath(root, "FIX-001.1.3"), "utf8")).hash).toBe(
      reviewRequirement.reviewId.slice(-12),
    );
  });

  // 2119: REQ-012.4.1
  it("accepts only a current stable pass and never bypasses stable-path defects with legacy evidence", () => {
    const root = fixture();
    const current = reviewIds(root)["FIX-001.1.1"];
    const stable = stablePath(root, "FIX-001.1.1");
    const ids = reviewIds(root);
    expect(run(root, ["pass", current, "--summary", "current stable pass"]).status).toBe(0);
    expect(run(root, ["pass", ids["FIX-001.1.2"], "--summary", "other current stable pass"]).status).toBe(0);
    expect(JSON.parse(readFileSync(stablePath(root, "FIX-001.1.1"), "utf8")).reviewId).toBe(current);
    expect(run(root, ["check"]).status).toBe(0);

    const staleId = current.replace(/[0-9a-f]{12}$/, "000000000000");
    writeRecord(root, "FIX-001.1.1.json", record(staleId, "pass", "obsolete pass"));
    writeRecord(root, `${current}.json`, record(current, "pass", "legacy bypass attempt"));
    const stale = run(root, ["check"]);
    expect(stale.status).toBe(1);
    expect(`${stale.stdout}\n${stale.stderr}`).toMatch(/stale/i);

    const currentIdWrongHash = { ...record(current, "pass"), hash: "f".repeat(12) };
    writeFileSync(stable, `${JSON.stringify(currentIdWrongHash)}\n`);
    const mismatchedHash = run(root, ["check"]);
    expect(mismatchedHash.status).toBe(1);
    expect(mismatchedHash.stderr).toMatch(/hash/i);

    writeRecord(root, "FIX-001.1.1.json", record(current, "fail", "boundary missing"));
    const failing = run(root, ["check"]);
    expect(failing.status).toBe(1);
    expect(`${failing.stdout}\n${failing.stderr}`).toContain("boundary missing");

    writeFileSync(stable, `${JSON.stringify({ ...record(current, "pass"), summary: "" })}\n`);
    const structurallyMalformed = run(root, ["check"]);
    expect(structurallyMalformed.status).toBe(1);
    expect(structurallyMalformed.stderr).toMatch(/summary/i);

    for (const candidate of [
      { ...record(current, "pass"), requirementId: "FIX-001.1.9" },
      { ...record(current, "pass"), verdict: "passed" },
      { ...record(current, "pass"), timestamp: "not-a-date" },
      { hash: current.slice(-12), verdict: "pass", summary: "missing IDs", timestamp: "2026-08-03T00:00:00Z" },
      { ...record(current, "pass"), hash: undefined },
      { ...record(current, "pass"), timestamp: undefined },
    ]) {
      writeFileSync(stable, `${JSON.stringify(candidate)}\n`);
      expect(run(root, ["check"]).status).toBe(1);
    }

    writeFileSync(stable, "{broken");
    const malformed = run(root, ["check"]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("malformed verdict file");
  });

  // 2119: REQ-012.5.1
  it("uses only current valid legacy evidence during transition and diagnoses every legacy state", () => {
    const root = fixture();
    const firstIds = reviewIds(root);
    const supersededPass = produceRecord(root, firstIds["FIX-001.1.1"], "pass", "obsolete pass");
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins v2', () => spin())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    const secondIds = reviewIds(root);
    const supersededFail = produceRecord(root, secondIds["FIX-001.1.1"], "fail", "obsolete failure");
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins v3', () => spin())\n" +
        "// 2119: FIX-001.1.2\ntest('stops', () => stop())\n",
    );
    const ids = reviewIds(root);
    placeLegacy(
      root,
      ids["FIX-001.1.1"],
      produceRecord(root, ids["FIX-001.1.1"], "pass", "current legacy pass"),
    );
    placeLegacy(
      root,
      ids["FIX-001.1.2"],
      produceRecord(root, ids["FIX-001.1.2"], "pass", "other current legacy pass"),
    );
    const obsoleteId = firstIds["FIX-001.1.1"];
    const supersededFailId = secondIds["FIX-001.1.1"];
    writeRecord(root, `${obsoleteId}.json`, supersededPass);
    writeRecord(root, `${supersededFailId}.json`, supersededFail);
    const accepted = run(root, ["check"]);
    expect(accepted.status).toBe(0);
    expect(`${accepted.stdout}\n${accepted.stderr}`).toContain("migration");
    expect(`${accepted.stdout}\n${accepted.stderr}`).toContain(`${ids["FIX-001.1.1"]}.json`);
    expect(`${accepted.stdout}\n${accepted.stderr}`).toContain("FIX-001.1.1.json");
    expect(`${accepted.stdout}\n${accepted.stderr}`).toMatch(
      new RegExp(`${ids["FIX-001.1.1"]}\\.json[^\\n]*FIX-001\\.1\\.1\\.json`),
    );
    expect(`${accepted.stdout}\n${accepted.stderr}`).toMatch(
      new RegExp(`${ids["FIX-001.1.2"]}\\.json[^\\n]*FIX-001\\.1\\.2\\.json`),
    );

    const currentRecord = record(ids["FIX-001.1.1"], "pass", "current legacy pass");
    for (const candidate of [
      { ...currentRecord, verdict: "passed" },
      { ...currentRecord, requirementId: "FIX-001.1.9" },
      { ...currentRecord, hash: "f".repeat(12) },
      { ...currentRecord, timestamp: "not-a-date" },
    ]) {
      writeFileSync(
        join(root, ".2119/verdicts", `${ids["FIX-001.1.1"]}.json`),
        `${JSON.stringify(candidate)}\n`,
      );
      const malformedCurrent = run(root, ["check"]);
      expect(malformedCurrent.status).toBe(1);
      expect(malformedCurrent.stderr).toContain(`${ids["FIX-001.1.1"]}.json`);
      expect(malformedCurrent.stderr).toMatch(/malformed/i);
    }
    placeLegacy(
      root,
      ids["FIX-001.1.1"],
      produceRecord(root, ids["FIX-001.1.1"], "pass", "current legacy pass"),
    );

    const nonTwelveName = "FIX-001.1.1--abc";
    writeRecord(root, `${nonTwelveName}.json`, currentRecord);
    const looseHashName = run(root, ["check"]);
    expect(looseHashName.status).toBe(1);
    expect(looseHashName.stderr).toContain(`${nonTwelveName}.json`);
    unlinkSync(join(root, ".2119/verdicts", `${nonTwelveName}.json`));

    const overlappingId = `FIX-001.1.10--${"c".repeat(12)}`;
    writeRecord(root, `${overlappingId}.json`, record(overlappingId, "pass", "different requirement"));
    unlinkSync(join(root, ".2119/verdicts", `${ids["FIX-001.1.1"]}.json`));
    expect(run(root, ["check"]).status).toBe(1);
    placeLegacy(
      root,
      ids["FIX-001.1.1"],
      produceRecord(root, ids["FIX-001.1.1"], "pass", "current legacy pass"),
    );
    // The normal writer correctly removes this requirement's legacy files;
    // restore historical fixtures to exercise the upgrade diagnostics below.
    writeRecord(root, `${obsoleteId}.json`, supersededPass);
    writeRecord(root, `${supersededFailId}.json`, supersededFail);

    const withSuperseded = run(root, ["check"]);
    expect(withSuperseded.status).toBe(0);
    expect(`${withSuperseded.stdout}\n${withSuperseded.stderr}`).toMatch(/superseded/i);
    expect(`${withSuperseded.stdout}\n${withSuperseded.stderr}`).toContain(`${obsoleteId}.json`);
    expect(`${withSuperseded.stdout}\n${withSuperseded.stderr}`).toContain("FIX-001.1.1.json");
    expect(`${withSuperseded.stdout}\n${withSuperseded.stderr}`).toMatch(
      new RegExp(`${obsoleteId}\\.json[^\\n]*FIX-001\\.1\\.1\\.json`),
    );

    const withSupersededFail = run(root, ["check"]);
    expect(withSupersededFail.status).toBe(0);
    expect(`${withSupersededFail.stdout}\n${withSupersededFail.stderr}`).toMatch(
      new RegExp(`${supersededFailId}\\.json[^\\n]*FIX-001\\.1\\.1\\.json`),
    );

    placeLegacy(root, ids["FIX-001.1.1"], produceRecord(root, ids["FIX-001.1.1"], "fail", "legacy fail"));
    const legacyFail = run(root, ["check"]);
    expect(legacyFail.status).toBe(1);
    expect(`${legacyFail.stdout}\n${legacyFail.stderr}`).toContain("legacy fail");
    expect(`${legacyFail.stdout}\n${legacyFail.stderr}`).toMatch(
      new RegExp(`${ids["FIX-001.1.1"]}\\.json[^\\n]*FIX-001\\.1\\.1\\.json`),
    );
    writeRecord(root, `${ids["FIX-001.1.1"]}.json`, record(ids["FIX-001.1.1"], "pass"));

    writeFileSync(join(root, ".2119/verdicts", `${obsoleteId}.json`), `${JSON.stringify({ ...record(obsoleteId, "pass"), summary: "" })}\n`);
    const malformedSuperseded = run(root, ["check"]);
    expect(malformedSuperseded.status).toBe(1);
    expect(malformedSuperseded.stderr).toContain(`${obsoleteId}.json`);
    writeRecord(root, `${obsoleteId}.json`, supersededPass);

    writeFileSync(join(root, ".2119/verdicts", `${obsoleteId}.json`), "{broken");
    writeFileSync(join(root, ".2119/verdicts", `${supersededFailId}.json`), "{also-broken");
    const everyMalformed = run(root, ["check"]);
    expect(everyMalformed.status).toBe(1);
    expect(everyMalformed.stderr).toContain(`${obsoleteId}.json`);
    expect(everyMalformed.stderr).toContain(`${supersededFailId}.json`);
    writeRecord(root, `${obsoleteId}.json`, supersededPass);
    writeRecord(root, `${supersededFailId}.json`, supersededFail);

    writeRecord(root, `${supersededFailId}.json`, supersededPass);
    const mismatchedLegacy = run(root, ["check"]);
    expect(mismatchedLegacy.status).toBe(1);
    expect(mismatchedLegacy.stderr).toContain(`${supersededFailId}.json`);
    writeRecord(root, `${supersededFailId}.json`, supersededFail);

    unlinkSync(join(root, ".2119/verdicts", `${ids["FIX-001.1.1"]}.json`));
    expect(run(root, ["check"]).status).toBe(1); // the superseded pass cannot satisfy freshness

    writeFileSync(join(root, ".2119/verdicts", `${ids["FIX-001.1.1"]}.json`), "{broken");
    const malformed = run(root, ["check"]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain(`${ids["FIX-001.1.1"]}.json`);
    expect(malformed.stderr).toContain("unparseable JSON");
  });

  // 2119: REQ-012.6.1, REQ-012.6.2
  it("prune preserves the best current evidence, removes all legacy files, and reports every migration action", () => {
    const root = fixture();
    const ids = reviewIds(root);
    const currentStable = produceRecord(root, ids["FIX-001.1.1"], "fail", "authoritative current failure");
    const conflictingLegacy = produceRecord(root, ids["FIX-001.1.1"], "pass", "conflicting legacy");
    const migratable = produceRecord(root, ids["FIX-001.1.2"], "pass", "current legacy evidence");
    writeRecord(root, "FIX-001.1.1.json", currentStable);
    writeRecord(root, `${ids["FIX-001.1.1"]}.json`, conflictingLegacy);

    const staleStable = record(`FIX-001.1.2--${"0".repeat(12)}`, "pass", "stale stable");
    writeRecord(root, "FIX-001.1.2.json", staleStable);
    writeRecord(root, `${ids["FIX-001.1.2"]}.json`, migratable);
    const staleExisting = `FIX-001.1.2--${"d".repeat(12)}`;
    writeRecord(root, `${staleExisting}.json`, record(staleExisting, "pass", "stale existing requirement"));
    const orphan = `FIX-999.1.1--${"a".repeat(12)}`;
    writeRecord(root, `${orphan}.json`, record(orphan, "pass", "orphan"));

    const pruned = run(root, ["prune"]);
    expect(pruned.status).toBe(0);
    expect(JSON.parse(readFileSync(stablePath(root, "FIX-001.1.1"), "utf8"))).toEqual(currentStable);
    expect(JSON.parse(readFileSync(stablePath(root, "FIX-001.1.2"), "utf8"))).toEqual(migratable);
    expect(readdirSync(join(root, ".2119/verdicts")).filter((name) => name.endsWith(".json")).sort()).toEqual([
      "FIX-001.1.1.json",
      "FIX-001.1.2.json",
    ]);
    expect(pruned.stdout).toMatch(
      new RegExp(`(?:convert|migrat)[^\\n]*${ids["FIX-001.1.2"]}\\.json[^\\n]*FIX-001\\.1\\.2\\.json`, "i"),
    );
    for (const removed of [ids["FIX-001.1.1"], staleExisting, orphan]) {
      expect(pruned.stdout).toMatch(new RegExp(`(?:remove|prune)[^\\n]*${removed}\\.json`, "i"));
    }

    // A malformed stable record cannot block recovery from valid current
    // legacy evidence, and malformed legacy debris is still removed/listed.
    const recoveryRoot = fixture();
    const recoveryIds = reviewIds(recoveryRoot);
    const recovered = produceRecord(
      recoveryRoot,
      recoveryIds["FIX-001.1.1"],
      "pass",
      "recoverable current evidence",
    );
    writeFileSync(stablePath(recoveryRoot, "FIX-001.1.1"), "{broken");
    writeRecord(recoveryRoot, `${recoveryIds["FIX-001.1.1"]}.json`, recovered);
    const malformedLegacy = `FIX-001.1.1--${"b".repeat(12)}`;
    writeFileSync(join(recoveryRoot, ".2119/verdicts", `${malformedLegacy}.json`), "{broken");
    const recovery = run(recoveryRoot, ["prune"]);
    expect(recovery.status).toBe(0);
    expect(JSON.parse(readFileSync(stablePath(recoveryRoot, "FIX-001.1.1"), "utf8"))).toEqual(recovered);
    expect(readdirSync(join(recoveryRoot, ".2119/verdicts")).filter((name) => name.startsWith("FIX-001.1.1"))).toEqual([
      "FIX-001.1.1.json",
    ]);
    expect(recovery.stdout).toMatch(
      new RegExp(
        `(?:convert|migrat)[^\\n]*${recoveryIds["FIX-001.1.1"]}\\.json[^\\n]*FIX-001\\.1\\.1\\.json`,
        "i",
      ),
    );
    expect(recovery.stdout).toMatch(new RegExp(`(?:remove|prune)[^\\n]*${malformedLegacy}\\.json`, "i"));

    for (const malformedStable of [
      { ...recovered, verdict: "passed" },
      { ...recovered, requirementId: "FIX-001.1.9" },
      { ...recovered, hash: "0".repeat(12) },
      { ...recovered, summary: "" },
      { ...recovered, timestamp: "not-a-date" },
    ]) {
      const semanticRoot = fixture();
      const semanticIds = reviewIds(semanticRoot);
      const semanticLegacy = produceRecord(
        semanticRoot,
        semanticIds["FIX-001.1.1"],
        "pass",
        "valid recovery source",
      );
      writeFileSync(stablePath(semanticRoot, "FIX-001.1.1"), `${JSON.stringify(malformedStable)}\n`);
      writeRecord(semanticRoot, `${semanticIds["FIX-001.1.1"]}.json`, semanticLegacy);
      const semanticPrune = run(semanticRoot, ["prune"]);
      expect(semanticPrune.status).toBe(0);
      expect(JSON.parse(readFileSync(stablePath(semanticRoot, "FIX-001.1.1"), "utf8"))).toEqual(semanticLegacy);
      expect(semanticPrune.stdout).toMatch(
        new RegExp(
          `(?:convert|migrat)[^\\n]*${semanticIds["FIX-001.1.1"]}\\.json[^\\n]*FIX-001\\.1\\.1\\.json`,
          "i",
        ),
      );
    }

    const invalidLegacyRoot = fixture();
    const invalidLegacyId = reviewIds(invalidLegacyRoot)["FIX-001.1.1"];
    const invalidProduced = produceRecord(invalidLegacyRoot, invalidLegacyId, "pass", "will be malformed");
    mkdirSync(join(invalidLegacyRoot, ".2119/verdicts"), { recursive: true });
    const invalidStable = stablePath(invalidLegacyRoot, "FIX-001.1.1");
    if (existsSync(invalidStable)) unlinkSync(invalidStable);
    writeFileSync(
      join(invalidLegacyRoot, ".2119/verdicts", `${invalidLegacyId}.json`),
      `${JSON.stringify({ ...invalidProduced, hash: "0".repeat(12) })}\n`,
    );
    const invalidPrune = run(invalidLegacyRoot, ["prune"]);
    expect(invalidPrune.status).toBe(0);
    expect(existsSync(stablePath(invalidLegacyRoot, "FIX-001.1.1"))).toBe(false);
    expect(readdirSync(join(invalidLegacyRoot, ".2119/verdicts")).filter((name) => name.endsWith(".json"))).toEqual([]);
    expect(invalidPrune.stdout).toMatch(new RegExp(`(?:remove|prune)[^\\n]*${invalidLegacyId}\\.json`, "i"));
  });

  // 2119: REQ-012.7.1
  it("init marks verdict JSON as generated while leaving it eligible for tracking", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-init-attributes-")));
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitattributes"), "docs/** linguist-documentation=true\n");
    writeFileSync(join(root, ".gitignore"), "*\n!docs/\n");
    expect(run(root, ["init"]).status).toBe(0);
    const attributeLine = ".2119/verdicts/*.json linguist-generated=true";
    const attributes = readFileSync(join(root, ".gitattributes"), "utf8").split(/\r?\n/);
    expect(attributes).toContain("docs/** linguist-documentation=true");
    expect(attributes).toContain(attributeLine);

    mkdirSync(join(root, ".2119/verdicts"), { recursive: true });
    writeFileSync(join(root, ".2119/verdicts/REQ-001.1.1.json"), "{}\n");
    expect(runGit(root, ["check-attr", "linguist-generated", "--", ".2119/verdicts/REQ-001.1.1.json"]).stdout).toContain(
      ".2119/verdicts/REQ-001.1.1.json: linguist-generated: true",
    );
    expect(runGit(root, ["check-ignore", ".2119/verdicts/REQ-001.1.1.json"]).status).toBe(1);
    expect(runGit(root, ["add", ".2119/verdicts/REQ-001.1.1.json"]).status).toBe(0);
    expect(runGit(root, ["status", "--short", ".2119/verdicts/REQ-001.1.1.json"]).stdout).toContain(
      "A  .2119/verdicts/REQ-001.1.1.json",
    );
    expect(existsSync(join(root, ".2119/verdicts/REQ-001.1.1.json"))).toBe(true);
  });
});

function runGit(cwd: string, args: string[]): RunResult {
  try {
    return { status: 0, stdout: execFileSync("git", args, { cwd, encoding: "utf8" }), stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
