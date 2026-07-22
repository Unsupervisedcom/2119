import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cwd: string, args: string[], input?: string): RunResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { cwd, input, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
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
  // realpath: the CLI's process.cwd() resolves macOS /var -> /private/var,
  // and hook payloads must use paths consistent with that cwd.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-cli-")));
  writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC);
  writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spin', () => {})\n");
  return root;
}

describe("cli end-to-end", () => {
  // 2119: REQ-002.4.2
  it("points at `2119 init` when run in an uninitialized repository", () => {
    const root = mkdtempSync(join(tmpdir(), "2119-raw-"));
    const result = run(root, ["check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("2119 init");
  });

  // 2119: REQ-002.4.1
  it("reads prefix and globs from .2119.yml with all fields optional", () => {
    const root = fixture();
    const result = run(root, ["lint"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 spec file(s) clean");
  });

  // 2119: REQ-002.1.3
  it("lint exits non-zero printing file, line, and rule for each violation", () => {
    const root = fixture();
    writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC.replace("MUST spin", "spins"));
    const result = run(root, ["lint"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/specs\/FIX-001-widgets\.md:\d+ \[REQ-001\.2\.2\]/);
  });

  // 2119: REQ-002.3.1
  it("check aggregates lint, coverage, and review freshness with a non-zero exit on failure", () => {
    const root = fixture();
    // Leg 1 — lint: a keywordless requirement fails check even though coverage is fine.
    writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC.replace("MUST spin", "spins"));
    const lintFail = run(root, ["check"]);
    expect(lintFail.status).toBe(1);
    expect(lintFail.stderr).toContain("REQ-001.2.2");

    // Leg 2 — coverage: restore the spec, drop the annotation.
    writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC);
    writeFileSync(join(root, "tests/widget.test.js"), "test('spin', () => {})\n");
    const coverFail = run(root, ["check"]);
    expect(coverFail.status).toBe(1);
    expect(coverFail.stderr).toContain("REQ-002.2.4");

    // Leg 3 — review freshness: restore coverage; only the missing verdict remains.
    writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spin', () => {})\n");
    const reviewFail = run(root, ["check"]);
    expect(reviewFail.status).toBe(1);
    expect(reviewFail.stderr).toContain("REQ-003.3.1");

    const review = run(root, ["review"]);
    const reviewId = review.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)?.[0];
    expect(reviewId).toBeTruthy();
    expect(run(root, ["pass", reviewId!, "--summary", "asserts spin behavior"]).status).toBe(0);
    expect(run(root, ["check"]).status).toBe(0);
  });

  // 2119: REQ-002.3.3
  it("check --json emits a machine-readable report reflecting actual state", () => {
    const root = fixture();
    // Fixture state: lint/cover clean, but the judgment review has no verdict.
    const pending = JSON.parse(run(root, ["check", "--json"]).stdout);
    expect(pending.ok).toBe(false);
    expect(pending.staleReviews.join()).toContain("FIX-001.1.1");
    expect(pending.uncoveredRequirements).toEqual([]);
    expect(pending.violations.some((v: { rule: string }) => v.rule === "REQ-003.3.1")).toBe(true);

    // Drop the annotation: the report's uncovered list must reflect it.
    writeFileSync(join(root, "tests/widget.test.js"), "test('spin', () => {})\n");
    const uncovered = JSON.parse(run(root, ["check", "--json"]).stdout);
    expect(uncovered.uncoveredRequirements).toContain("FIX-001.1.1");

    // Manual requirements are surfaced in the report.
    writeFileSync(
      join(root, "specs/FIX-001-widgets.md"),
      `${SPEC}2. Support MUST answer the phone. [manual]\n`,
    );
    const manual = JSON.parse(run(root, ["check", "--json"]).stdout);
    expect(manual.manualRequirements.map((m: { id: string }) => m.id)).toContain("FIX-001.1.2");
  });

  // 2119: REQ-003.2.3
  it("refuses to record a verdict whose hash does not match current content", () => {
    const root = fixture();
    run(root, ["review"]);
    const files = readdirSync(join(root, ".2119/reviews"));
    const realId = files[0].replace(/\.md$/, "");
    const forged = realId.replace(/--[0-9a-f]{12}$/, `--${"a".repeat(12)}`);
    const result = run(root, ["pass", forged, "--summary", "looks great"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Stale review ID");
    expect(run(root, ["check"]).status).toBe(1);
  });

  // 2119: REQ-004.3.1
  it("init scaffolds a commented config and a template spec", () => {
    const root = mkdtempSync(join(tmpdir(), "2119-init-"));
    const result = run(root, ["init"]);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, ".2119.yml"), "utf8")).toContain("# 2119 configuration");
    expect(readFileSync(join(root, "specs/REQ-001-example.md"), "utf8")).toContain("## Requirements");
  });

  // 2119: REQ-004.3.2, REQ-004.3.5
  it("init appends the AGENTS.md workflow section exactly once, mentioning the CI backstop", () => {
    const root = mkdtempSync(join(tmpdir(), "2119-agents-"));
    writeFileSync(join(root, "AGENTS.md"), "# My project\n");
    run(root, ["init"]);
    run(root, ["init"]);
    const body = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(body.match(/<!-- 2119:begin -->/g)).toHaveLength(1);
    expect(body.match(/<!-- 2119:end -->/g)).toHaveLength(1);
    expect(body).toContain("# My project");
    // The mandated workflow content: spec-first planning, test annotations,
    // judgment reviews, and the check gate.
    expect(body).toContain("write or update a spec in `specs/` first");
    expect(body).toContain("RFC 2119 keyword");
    const marker = ["21", "19"].join(""); // avoid a literal self-annotation
    expect(body).toContain(`\`// ${marker}: REQ-001.2.3\``);
    expect(body).toContain("fresh-context subagent");
    expect(body).toMatch(/npx rfc2119 check.*must exit 0/s);
    expect(body).toContain("CI runs the same check");
    // 0.6 topics: draft-time spec critique + reviewer diversity (REQ-004.3.2).
    expect(body).toContain("critique the draft\nrequirements");
    expect(body).toContain("review --audit");
    expect(body).toContain("different providers");
  });

  // 2119: REQ-003.5.2, REQ-003.5.5
  it("review surfaces the recommended model in dispatch output without blocking when stdin is not a TTY", () => {
    const root = fixture(); // no review_model configured
    // execFileSync pipes stdin (not a TTY): must complete instead of prompting.
    const result = run(root, ["review"], "");
    expect(result.status).toBe(1); // pending reviews exist
    expect(result.stdout).toContain("Recommended reviewer model: a capable, cost-effective model");
    expect(result.stdout).toContain("[review]-tagged");
  });

  // 2119: REQ-004.2.2
  it("init --agent codex prints the one-time /hooks trust instruction", () => {
    const root = mkdtempSync(join(tmpdir(), "2119-codex-"));
    const result = run(root, ["init", "--agent", "codex"]);
    expect(result.stdout).toContain("/hooks");
    expect(result.stdout).toContain(".codex/hooks.json");
  });

  // 2119: REQ-003.1.6, REQ-003.2.2
  it("init gitignores .2119/reviews/ but never .2119/verdicts/", () => {
    const root = mkdtempSync(join(tmpdir(), "2119-ign-"));
    execFileSync("git", ["init"], { cwd: root });
    run(root, ["init"]);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".2119/reviews/");
    mkdirSync(join(root, ".2119/reviews"), { recursive: true });
    mkdirSync(join(root, ".2119/verdicts"), { recursive: true });
    writeFileSync(join(root, ".2119/reviews/pending.md"), "scratch\n");
    writeFileSync(join(root, ".2119/verdicts/REQ-001.1.1--aaaaaaaaaaaa.json"), "{}\n");
    expect(() => execFileSync("git", ["check-ignore", "-q", ".2119/reviews/pending.md"], { cwd: root })).not.toThrow();
    expect(() =>
      execFileSync("git", ["check-ignore", "-q", ".2119/verdicts/REQ-001.1.1--aaaaaaaaaaaa.json"], {
        cwd: root,
      }),
    ).toThrow();

    writeFileSync(join(root, ".gitignore"), `${readFileSync(join(root, ".gitignore"), "utf8")}.2119/\n`);
    run(root, ["init"]);
    expect(() =>
      execFileSync("git", ["check-ignore", "-q", ".2119/verdicts/REQ-001.1.1--aaaaaaaaaaaa.json"], {
        cwd: root,
      }),
    ).toThrow();

    const parentIgnored = mkdtempSync(join(tmpdir(), "2119-ign-parent-"));
    execFileSync("git", ["init"], { cwd: parentIgnored });
    writeFileSync(join(parentIgnored, ".gitignore"), ".2119/\n");
    mkdirSync(join(parentIgnored, ".2119"), { recursive: true });
    writeFileSync(join(parentIgnored, ".2119/.gitignore"), "verdicts/\n");
    run(parentIgnored, ["init"]);
    mkdirSync(join(parentIgnored, ".2119/verdicts"), { recursive: true });
    writeFileSync(join(parentIgnored, ".2119/verdicts/REQ-001.1.1--aaaaaaaaaaaa.json"), "{}\n");
    expect(() =>
      execFileSync("git", ["check-ignore", "-q", ".2119/verdicts/REQ-001.1.1--aaaaaaaaaaaa.json"], {
        cwd: parentIgnored,
      }),
    ).toThrow();

    const dispatchRoot = fixture();
    run(dispatchRoot, ["init"]);
    const pending = run(dispatchRoot, ["review"]);
    expect(pending.status).toBe(1);
    const reviewId = pending.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)?.[0];
    expect(reviewId).toBeTruthy();
    expect(readdirSync(join(dispatchRoot, ".2119/reviews"))).toEqual([`${reviewId}.md`]);

    for (const command of ["pass", "fail"]) {
      const verdictRoot = fixture();
      execFileSync("git", ["init"], { cwd: verdictRoot });
      run(verdictRoot, ["init"]);
      const verdictPending = run(verdictRoot, ["review"]);
      const verdictId = verdictPending.stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)?.[0];
      expect(verdictId).toBeTruthy();
      writeFileSync(
        join(verdictRoot, ".gitignore"),
        `${readFileSync(join(verdictRoot, ".gitignore"), "utf8")}.2119/\n`,
      );
      writeFileSync(join(verdictRoot, ".2119/.gitignore"), "verdicts/\n");
      mkdirSync(join(verdictRoot, ".2119/verdicts"), { recursive: true });
      writeFileSync(join(verdictRoot, ".2119/verdicts/.gitignore"), "*.json\n");
      expect(run(verdictRoot, [command, verdictId!, "--summary", `${command} remains trackable`]).status).toBe(0);
      expect(() =>
        execFileSync("git", ["check-ignore", "-q", `.2119/verdicts/${verdictId}.json`], { cwd: verdictRoot }),
      ).toThrow();
    }
  });

  // 2119: REQ-004.1.1, REQ-004.1.2
  it("hook subcommand supports all three events via stdin JSON and always exits 0 with JSON output", () => {
    const root = fixture();
    const ok = run(root, ["hook", "session-start", "--platform", "claude"], "{}");
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toHaveProperty("hookSpecificOutput");

    // after-edit through the CLI: lint-broken spec edit yields injected context.
    writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC.replace("MUST spin", "spins"));
    const edit = run(
      root,
      ["hook", "after-edit", "--platform", "claude"],
      JSON.stringify({ tool_input: { file_path: join(root, "specs/FIX-001-widgets.md") } }),
    );
    expect(edit.status).toBe(0);
    expect(JSON.parse(edit.stdout).hookSpecificOutput.additionalContext).toContain("REQ-001.2.2");

    // stop through the CLI: failing check yields a block decision.
    const stop = run(root, ["hook", "stop", "--platform", "claude"], "{}");
    expect(stop.status).toBe(0);
    expect(JSON.parse(stop.stdout).decision).toBe("block");

    const bad = run(root, ["hook", "bogus-event", "--platform", "claude"], "not json");
    expect(bad.status).toBe(0);
    expect(JSON.parse(bad.stdout)).toHaveProperty("systemMessage");
  });
});
