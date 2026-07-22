import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

type Result = { status: number; stdout: string; stderr: string };

function run(cwd: string, args: string[], env: Record<string, string> = {}): Result {
  try {
    return {
      status: 0,
      stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }),
      stderr: "",
    };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function write(root: string, path: string, body: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

function initRepo(files: Record<string, string>): { root: string; base: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-changed-")));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "2119 tests");
  git(root, "config", "user.email", "tests@2119.invalid");
  for (const [path, body] of Object.entries(files)) write(root, path, body);
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

function spec(items: string, doc = "FIX-001", title = "Widgets"): string {
  return `# ${doc}: ${title}

## Overview

Fixture requirements.

## Requirements

### ${doc}.1: Behavior

${items}`;
}

function json(result: Result): {
  violations: Array<{ file: string; message: string; rule: string }>;
  uncoveredRequirements: string[];
  staleReviews: string[];
  manualRequirements: Array<{ id: string; text: string }>;
  requirementCount: number;
  coveredCount: number;
} {
  return JSON.parse(result.stdout);
}

function passReviews(root: string, requirementIds: string[]): void {
  const pending = run(root, ["review"]);
  for (const requirementId of requirementIds) {
    const reviewId = pending.stdout.match(new RegExp(`${requirementId.replaceAll(".", "\\.")}--[0-9a-f]{12}`))?.[0];
    expect(reviewId, `pending review for ${requirementId}`).toBeTruthy();
    expect(run(root, ["pass", reviewId!, "--summary", `honest coverage for ${requirementId}`]).status).toBe(0);
  }
}

function commitCurrent(root: string, message = "record reviewed baseline"): string {
  git(root, "add", ".");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

const TWO_REQUIREMENTS = spec(`1. The widget MUST spin.
2. The widget MUST stop.
`);

describe("check --changed (REQ-009)", () => {
  // 2119: REQ-009.1.1
  it("requires one local base ref, uses its merge-base, and never invokes network Git commands", () => {
    const { root, base } = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": spec("1. The widget MUST spin.\n"),
    });

    for (const args of [
      ["check", "--changed"],
      ["check", "--changed", base, "extra-ref"],
      ["check", "--changed", "not-a-local-ref"],
    ]) {
      const result = run(root, args);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/changed|base.ref|commit|usage/i);
    }

    git(root, "branch", "ambiguous", base);
    git(root, "tag", "ambiguous", base);
    const ambiguous = run(root, ["check", "--changed", "ambiguous"]);
    expect(ambiguous.status).not.toBe(0);
    expect(`${ambiguous.stdout}\n${ambiguous.stderr}`).toMatch(/ambiguous|base.ref|commit/i);

    git(root, "checkout", "-b", "base-side", base);
    write(root, "specs/FIX-001-widgets.md", spec("1. The widget MUST spin. [manual]\n"));
    commitCurrent(root, "fix only on base side");
    git(root, "checkout", "main");
    write(root, "README.md", "main-side change\n");
    commitCurrent(root, "advance main independently");
    // The merge-base still contains the pre-existing uncovered requirement;
    // diffing directly against base-side would incorrectly make it affected.
    expect(run(root, ["check", "--changed", "base-side"]).status).toBe(0);

    git(root, "checkout", "--orphan", "unrelated");
    git(root, "rm", "-rf", ".");
    write(root, "orphan.txt", "no common history\n");
    commitCurrent(root, "unrelated root");
    const unrelated = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "main");
    const noMergeBase = run(root, ["check", "--changed", unrelated]);
    expect(noMergeBase.status).not.toBe(0);
    expect(`${noMergeBase.stdout}\n${noMergeBase.stderr}`).toMatch(/merge.base|history|ancestor/i);

    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const bin = join(root, "fake-bin");
    const log = join(root, "git-calls.log");
    write(
      root,
      "fake-bin/git",
      `#!/bin/sh\nprintf '%s\\n' "$1" >> "$GIT_CALL_LOG"\ncase "$1" in fetch|pull|ls-remote) exit 97;; esac\nexec ${realGit} "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    expect(
      run(root, ["check", "--changed", base], { PATH: `${bin}:${process.env.PATH}`, GIT_CALL_LOG: log }).status,
    ).toBe(0);
    expect(readFileSync(log, "utf8")).not.toMatch(/^(fetch|pull|ls-remote)$/m);
  });

  // 2119: REQ-009.1.2, REQ-009.3.1
  it("includes committed, staged, unstaged, untracked, and deleted paths since the merge-base", () => {
    for (const mode of ["committed", "staged", "unstaged", "untracked"] as const) {
      const { root, base } = initRepo({
        ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
        "specs/FIX-001-widgets.md": spec("1. The widget MUST spin. [manual]\n"),
        "tests/old.test.js": "// 2119: FIX-800.1.1\n",
        "tests/state.test.js": "// baseline placeholder\n",
      });
      const path = mode === "untracked" ? "tests/new.test.js" : "tests/state.test.js";
      write(root, path, `// 2119: FIX-90${mode.length}.1.1\n`);
      if (mode === "staged" || mode === "committed") git(root, "add", path);
      if (mode === "committed") git(root, "commit", "-m", "changed test");

      const report = json(run(root, ["check", "--changed", base, "--json"]));
      expect(report.violations.some((v) => v.message.includes(`FIX-90${mode.length}.1.1`))).toBe(true);
      expect(report.violations.some((v) => v.message.includes("FIX-800.1.1"))).toBe(false);
    }

    const { root, base } = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": TWO_REQUIREMENTS,
      "tests/widget.test.js": "// 2119: FIX-001.1.1\ntest('spin', () => {})\n",
    });
    unlinkSync(join(root, "tests/widget.test.js"));
    const report = json(run(root, ["check", "--changed", base, "--json"]));
    expect(report.uncoveredRequirements).toContain("FIX-001.1.1");
    expect(report.uncoveredRequirements).not.toContain("FIX-001.1.2");
  });

  // 2119: REQ-009.1.3
  it("fails closed when Git metadata or the baseline configuration cannot be read", () => {
    const noGit = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": spec("1. The widget MUST spin. [manual]\n"),
    });
    rmSync(join(noGit.root, ".git"), { recursive: true, force: true });
    const gitFailure = run(noGit.root, ["check", "--changed", noGit.base]);
    expect(gitFailure.status).not.toBe(0);
    expect(`${gitFailure.stdout}\n${gitFailure.stderr}`).toMatch(/git|metadata|repository/i);

    const brokenBase = initRepo({
      ".2119.yml": "prefix: [unterminated\n",
      "specs/FIX-001-widgets.md": spec("1. The widget MUST spin. [manual]\n"),
    });
    write(brokenBase.root, ".2119.yml", 'prefix: "FIX"\nreviews: false\n');
    const result = run(brokenBase.root, ["check", "--changed", brokenBase.base]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/baseline|config|yaml|parse/i);

    const corruptBlob = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": spec("1. The widget MUST spin. [manual]\n"),
    });
    const blob = git(corruptBlob.root, "rev-parse", `${corruptBlob.base}:specs/FIX-001-widgets.md`);
    const objectPath = join(corruptBlob.root, ".git/objects", blob.slice(0, 2), blob.slice(2));
    chmodSync(objectPath, 0o644);
    writeFileSync(objectPath, "corrupt object\n");
    const unreadable = run(corruptBlob.root, ["check", "--changed", corruptBlob.base]);
    expect(unreadable.status).not.toBe(0);
    expect(`${unreadable.stdout}\n${unreadable.stderr}`).toMatch(/baseline|object|content|read|git/i);
  });

  // 2119: REQ-009.2.1
  it("detects each requirement-contract field independently without affecting its sibling", () => {
    const variants = [
      ["1. The widget MUST spin.\n", "1. The widget MUST rotate.\n"],
      ["1. The widget MUST spin.\n", "1. The widget SHALL spin.\n"],
      ["1. The widget MUST spin. [manual]\n", "1. The widget MUST spin.\n"],
      ["1. The widget MUST spin. [verify: true]\n", "1. The widget MUST spin. [verify: false]\n"],
      ["1. The widget MUST spin. [review: docs/a.md]\n", "1. The widget MUST spin. [review: docs/b.md]\n"],
      [
        "1. The widget MUST spin. [review: instructions: docs/instructions-a.md]\n",
        "1. The widget MUST spin. [review: instructions: docs/instructions-b.md]\n",
      ],
    ];
    for (const [before, after] of variants) {
      const { root, base } = initRepo({
        ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
        "specs/FIX-001-widgets.md": spec(`${before}2. The widget MUST stop.\n`),
        "docs/a.md": "a\n",
        "docs/b.md": "b\n",
        "docs/instructions-a.md": "a instructions\n",
        "docs/instructions-b.md": "b instructions\n",
      });
      write(root, "specs/FIX-001-widgets.md", spec(`${after}2. The widget MUST stop.\n`));
      const report = json(run(root, ["check", "--changed", base, "--no-verify", "--json"]));
      expect(report.requirementCount).toBe(1);
      expect(report.uncoveredRequirements).not.toContain("FIX-001.1.2");
    }

    const added = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": spec("1. The widget MUST spin. [manual]\n"),
    });
    write(added.root, "specs/FIX-001-widgets.md", spec("1. The widget MUST spin. [manual]\n2. The widget MUST stop.\n"));
    const addedReport = json(run(added.root, ["check", "--changed", added.base, "--json"]));
    expect(addedReport.requirementCount).toBe(1);
    expect(addedReport.uncoveredRequirements).toEqual(["FIX-001.1.2"]);
  });

  // 2119: REQ-009.2.2, REQ-009.2.3, REQ-009.3.1
  it("uses annotation blocks and their shared prelude when selecting affected requirements", () => {
    const files = {
      ".2119.yml": 'prefix: "FIX"\n',
      "specs/FIX-001-widgets.md": spec(`1. The widget MUST spin.
2. The widget MUST stop.
3. The widget MUST reverse.
`),
      "tests/widget.test.js": `import { widget } from './widget.js'

// 2119: FIX-001.1.1
test('spin', () => expect(widget.spin()).toBe(true))
// 2119: FIX-001.1.2
test('stop', () => expect(widget.stop()).toBe(true))
`,
      "tests/reverse.test.js": "// 2119: FIX-001.1.3\ntest('reverse', () => {})\n",
    };

    const blockEdit = initRepo(files);
    passReviews(blockEdit.root, ["FIX-001.1.1", "FIX-001.1.2"]);
    const blockBase = commitCurrent(blockEdit.root);
    const body = readFileSync(join(blockEdit.root, "tests/widget.test.js"), "utf8");
    write(blockEdit.root, "tests/widget.test.js", body.replace("widget.stop()).toBe(true)", "widget.stop()).toBe('stopped')"));
    const blockReport = json(run(blockEdit.root, ["check", "--changed", blockBase, "--json"]));
    expect(blockReport.staleReviews.join("\n")).toContain("FIX-001.1.2");
    expect(blockReport.staleReviews.join("\n")).not.toContain("FIX-001.1.1");
    expect(blockReport.staleReviews.join("\n")).not.toContain("FIX-001.1.3");

    const preludeEdit = initRepo(files);
    passReviews(preludeEdit.root, ["FIX-001.1.1", "FIX-001.1.2"]);
    const preludeBase = commitCurrent(preludeEdit.root);
    write(
      preludeEdit.root,
      "tests/widget.test.js",
      readFileSync(join(preludeEdit.root, "tests/widget.test.js"), "utf8").replace("./widget.js", "./mock-widget.js"),
    );
    const preludeReport = json(run(preludeEdit.root, ["check", "--changed", preludeBase, "--json"]));
    expect(preludeReport.staleReviews.join("\n")).toContain("FIX-001.1.1");
    expect(preludeReport.staleReviews.join("\n")).toContain("FIX-001.1.2");
    expect(preludeReport.staleReviews.join("\n")).not.toContain("FIX-001.1.3");

    for (const mode of ["added", "removed"] as const) {
      const annotation = "// 2119: FIX-001.1.1\ntest('spin', () => {})\n";
      const annotations = initRepo({
        ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
        "specs/FIX-001-widgets.md": TWO_REQUIREMENTS,
        "tests/widget.test.js": mode === "removed" ? annotation : "// no annotation yet\n",
      });
      write(annotations.root, "tests/widget.test.js", mode === "added" ? annotation : "// annotation removed\n");
      const report = json(run(annotations.root, ["check", "--changed", annotations.base, "--json"]));
      expect(report.requirementCount).toBe(1);
      expect(report.coveredCount).toBe(mode === "added" ? 1 : 0);
      expect(report.uncoveredRequirements).toEqual(mode === "removed" ? ["FIX-001.1.1"] : []);
      expect(report.uncoveredRequirements).not.toContain("FIX-001.1.2");
    }
  });

  // 2119: REQ-009.2.4
  it("uses whole-file comparison for explicit review and shared evidence", () => {
    const files = {
      ".2119.yml": 'prefix: "FIX"\nshared_evidence: ["tests/shared/**"]\n',
      "specs/FIX-001-widgets.md": spec(`1. Policy MUST stay current. [review: docs/policy.md]
2. The widget MUST spin.
3. Other policy MUST stay current. [review: docs/other.md]
`),
      "docs/policy.md": "policy v1\n",
      "docs/other.md": "other v1\n",
      "tests/shared/helper.js": "export const expected = true\n",
      "tests/widget.test.js": "// 2119: FIX-001.1.2\ntest('spin', () => {})\n",
    };

    const explicit = initRepo(files);
    passReviews(explicit.root, ["FIX-001.1.1", "FIX-001.1.2"]);
    const explicitBase = commitCurrent(explicit.root);
    write(explicit.root, "docs/policy.md", "policy v2\n");
    const explicitReport = json(run(explicit.root, ["check", "--changed", explicitBase, "--json"]));
    expect(explicitReport.staleReviews.join("\n")).toContain("FIX-001.1.1");
    expect(explicitReport.staleReviews.join("\n")).not.toContain("FIX-001.1.2");
    expect(explicitReport.staleReviews.join("\n")).not.toContain("FIX-001.1.3");

    const shared = initRepo(files);
    passReviews(shared.root, ["FIX-001.1.1", "FIX-001.1.2"]);
    const sharedBase = commitCurrent(shared.root);
    write(shared.root, "tests/shared/helper.js", "export const expected = false\n");
    const sharedReport = json(run(shared.root, ["check", "--changed", sharedBase, "--json"]));
    expect(sharedReport.staleReviews.join("\n")).toContain("FIX-001.1.2");
    expect(sharedReport.staleReviews.join("\n")).not.toContain("FIX-001.1.1");
    expect(sharedReport.staleReviews.join("\n")).not.toContain("FIX-001.1.3");

    const instructionsFiles = {
      ".2119.yml": 'prefix: "FIX"\n',
      "specs/FIX-001-widgets.md": spec(`1. Policy MUST stay current. [review: instructions: docs/review.md]
2. Other policy MUST stay current. [review: docs/other.md]
`),
      "docs/review.md": "review policy v1\n",
      "docs/other.md": "other v1\n",
    };
    const instructions = initRepo(instructionsFiles);
    passReviews(instructions.root, ["FIX-001.1.1"]);
    const instructionsBase = commitCurrent(instructions.root);
    write(instructions.root, "docs/review.md", "review policy v2\n");
    const instructionsReport = json(run(instructions.root, ["check", "--changed", instructionsBase, "--json"]));
    expect(instructionsReport.staleReviews.join("\n")).toContain("FIX-001.1.1");
    expect(instructionsReport.staleReviews.join("\n")).not.toContain("FIX-001.1.2");
  });

  // 2119: REQ-009.2.5
  it("scopes changed and malformed verdict records without hiding unassigned corruption", () => {
    const files = {
      ".2119.yml": 'prefix: "FIX"\n',
      "specs/FIX-001-widgets.md": TWO_REQUIREMENTS,
      "tests/widget.test.js": "// 2119: FIX-001.1.1\ntest('spin', () => {})\n// 2119: FIX-001.1.2\ntest('stop', () => {})\n",
    };
    const removed = initRepo(files);
    passReviews(removed.root, ["FIX-001.1.1"]);
    const removedBase = commitCurrent(removed.root);
    const verdict = git(removed.root, "ls-files", ".2119/verdicts/FIX-001.1.1*.json");
    unlinkSync(join(removed.root, verdict));
    const removedReport = json(run(removed.root, ["check", "--changed", removedBase, "--json"]));
    expect(removedReport.staleReviews.join("\n")).toContain("FIX-001.1.1");
    expect(removedReport.staleReviews.join("\n")).not.toContain("FIX-001.1.2");

    const malformed = initRepo(files);
    const malformedBase = malformed.base;
    write(malformed.root, ".2119/verdicts/not-a-verdict.json", "{ broken json");
    const malformedReport = json(run(malformed.root, ["check", "--changed", malformedBase, "--json"]));
    expect(malformedReport.violations.some((v) => v.file.includes("not-a-verdict.json"))).toBe(true);

    const assignedMalformed = initRepo(files);
    passReviews(assignedMalformed.root, ["FIX-001.1.1"]);
    const assignedMalformedBase = commitCurrent(assignedMalformed.root);
    const assignedPath = git(assignedMalformed.root, "ls-files", ".2119/verdicts/FIX-001.1.1*.json");
    write(assignedMalformed.root, assignedPath, "{ broken json");
    const assignedReport = json(run(assignedMalformed.root, ["check", "--changed", assignedMalformedBase, "--json"]));
    expect(assignedReport.violations.some((v) => v.file.includes(assignedPath))).toBe(true);
    expect(assignedReport.staleReviews.join("\n")).not.toContain("FIX-001.1.2");

    const added = initRepo(files);
    const addedBase = added.base;
    passReviews(added.root, ["FIX-001.1.1"]);
    const addedReport = json(run(added.root, ["check", "--changed", addedBase, "--json"]));
    expect(addedReport.requirementCount).toBe(1);
    expect(addedReport.staleReviews.join("\n")).not.toContain("FIX-001.1.2");

    const replaced = initRepo(files);
    passReviews(replaced.root, ["FIX-001.1.1"]);
    const replacedBase = commitCurrent(replaced.root);
    const currentId = git(replaced.root, "ls-files", ".2119/verdicts/FIX-001.1.1*.json").match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    expect(run(replaced.root, ["fail", currentId, "--summary", "replacement rejection"]).status).toBe(0);
    const replacedReport = json(run(replaced.root, ["check", "--changed", replacedBase, "--json"]));
    expect(replacedReport.staleReviews.join("\n")).toContain("FIX-001.1.1");
    expect(replacedReport.staleReviews.join("\n")).not.toContain("FIX-001.1.2");
  });

  // 2119: REQ-009.2.6
  it("treats every current requirement as affected when configuration changes", () => {
    const { root, base } = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": TWO_REQUIREMENTS,
    });
    write(root, ".2119.yml", 'prefix: "FIX"\nreviews: false\n# policy changed\n');
    expect(json(run(root, ["check", "--changed", base, "--json"])).uncoveredRequirements).toEqual([
      "FIX-001.1.1",
      "FIX-001.1.2",
    ]);
  });

  // 2119: REQ-009.3.1
  it("reports only changed lint and affected verification failures", () => {
    const lintCase = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-old.md": spec("1. The old widget spins.\n"),
      "specs/FIX-002-new.md": spec("1. The new widget MUST stop. [manual]\n", "FIX-002", "New widgets"),
    });
    write(lintCase.root, "specs/FIX-002-new.md", spec("1. The new widget stops.\n", "FIX-002", "New widgets"));
    const lintReport = json(run(lintCase.root, ["check", "--changed", lintCase.base, "--json"]));
    expect(lintReport.violations.some((v) => v.file.includes("FIX-002-new.md"))).toBe(true);
    expect(lintReport.violations.some((v) => v.file.includes("FIX-001-old.md"))).toBe(false);

    const verifyCase = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": spec(`1. First check MUST pass. [verify: false]
2. Second check MUST pass. [verify: false]
`),
    });
    write(
      verifyCase.root,
      "specs/FIX-001-widgets.md",
      spec(`1. First changed check MUST pass. [verify: false]
2. Second check MUST pass. [verify: false]
`),
    );
    const verifyReport = json(run(verifyCase.root, ["check", "--changed", verifyCase.base, "--json"]));
    expect(verifyReport.violations.some((v) => v.message.includes("FIX-001.1.1"))).toBe(true);
    expect(verifyReport.violations.some((v) => v.message.includes("FIX-001.1.2"))).toBe(false);
  });

  // 2119: REQ-009.3.2
  it("reports an unchanged annotation when its requirement is removed from a retained spec file", () => {
    const { root, base } = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": TWO_REQUIREMENTS,
      "tests/widget.test.js": "// 2119: FIX-001.1.1\ntest('spin', () => {})\n",
      "tests/old.test.js": "// 2119: FIX-999.1.1\n",
    });
    write(root, "specs/FIX-001-widgets.md", spec("2. The widget MUST stop. [manual]\n"));
    const report = json(run(root, ["check", "--changed", base, "--json"]));
    expect(report.violations.some((v) => v.message.includes("FIX-001.1.1"))).toBe(true);
    expect(report.violations.some((v) => v.message.includes("FIX-999.1.1"))).toBe(false);
  });

  // 2119: REQ-009.3.3
  it("composes with JSON and no-verify using incremental counts and manual output", () => {
    const counts = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": TWO_REQUIREMENTS,
      "tests/widget.test.js": "// 2119: FIX-001.1.1\ntest('spin', () => {})\n",
    });
    write(counts.root, "specs/FIX-001-widgets.md", TWO_REQUIREMENTS.replace("MUST spin", "MUST rotate"));
    const countReport = json(run(counts.root, ["check", "--changed", counts.base, "--json"]));
    expect(countReport.requirementCount).toBe(1);
    expect(countReport.coveredCount).toBe(1);
    expect(countReport.uncoveredRequirements).toEqual([]);

    const skipped = initRepo({
      ".2119.yml": 'prefix: "FIX"\nreviews: false\n',
      "specs/FIX-001-widgets.md": spec(`1. The changed command MUST pass. [verify: false]
2. An unchanged command MUST pass. [verify: false]
3. An unrelated widget MUST stop.
`),
    });
    write(
      skipped.root,
      "specs/FIX-001-widgets.md",
      spec(`1. The newly changed command MUST pass. [verify: false]
2. An unchanged command MUST pass. [verify: false]
3. An unrelated widget MUST stop.
`),
    );
    const result = run(skipped.root, ["check", "--changed", skipped.base, "--no-verify", "--json"]);
    expect(result.status).toBe(0);
    const skippedReport = json(result);
    expect(skippedReport.manualRequirements.map((r) => r.id)).toEqual(["FIX-001.1.1"]);
    expect(skippedReport.uncoveredRequirements).toEqual([]);
  });
});
