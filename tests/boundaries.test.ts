import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installAgentHooks, installCi, installGitHook, PKG_VERSION } from "../src/adapters.js";
import { parseSpec } from "../src/spec.js";
import { computeCoverage } from "../src/cover.js";
import { computeReviewTargets } from "../src/review.js";
import { DEFAULT_ENFORCE, loadConfig } from "../src/config.js";
import type { Annotation } from "../src/model.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" }), stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "2119-bound-")));

describe("honest-boundary mechanics (0.5)", () => {
  // 2119: REQ-004.3.6
  it("generated CI carries a project-test step separate from the check step", () => {
    // With a package.json: executable on a clean runner — dependencies are
    // installed BEFORE the tests, which run before the check step.
    const withPkg = tmp();
    writeFileSync(join(withPkg, "package.json"), "{}");
    installCi(withPkg);
    const workflow = readFileSync(join(withPkg, ".github/workflows/2119.yml"), "utf8");
    expect(workflow).toContain("- run: npm ci");
    expect(workflow).toContain("- run: npm test");
    expect(workflow.indexOf("npm ci")).toBeLessThan(workflow.indexOf("npm test"));
    expect(workflow.indexOf("npm test")).toBeLessThan(workflow.indexOf("rfc2119"));

    // Without one: a loud placeholder, never a silent omission.
    const bare = tmp();
    installCi(bare);
    const placeholder = readFileSync(join(bare, ".github/workflows/2119.yml"), "utf8");
    expect(placeholder).toContain("2119 does not run tests");
    expect(placeholder).not.toContain("- run: npm test");
  });

  // 2119: REQ-004.3.7
  it("pins the generating package version in hook, pre-commit, and CI commands", () => {
    const root = tmp();
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    const pinned = `rfc2119@${PKG_VERSION}`;

    installAgentHooks(root, "claude");
    expect(readFileSync(join(root, ".claude/settings.json"), "utf8")).toContain(`npx ${pinned} hook`);

    mkdirSync(join(root, ".git"), { recursive: true });
    installGitHook(root);
    expect(readFileSync(join(root, ".git/hooks/pre-commit"), "utf8")).toContain(`npx ${pinned} check`);

    installCi(root);
    const workflow = readFileSync(join(root, ".github/workflows/2119.yml"), "utf8");
    expect(workflow).toContain(`${pinned} check`);
    expect(workflow).not.toMatch(/rfc2119 check/); // no unpinned invocation survives
  });

  // 2119: REQ-002.3.5
  it("check --no-verify skips [verify] shell and surfaces the requirement like [manual]", () => {
    const root = tmp();
    writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
    mkdirSync(join(root, "specs"));
    const marker = join(root, "ran.txt");
    writeFileSync(
      join(root, "specs/FIX-001-widgets.md"),
      `# FIX-001: Widgets\n\n## Overview\n\nWidgets.\n\n## Requirements\n\n### FIX-001.1: Basics\n\n` +
        `1. The marker MUST stay honest. [verify: node -e "require('fs').writeFileSync('ran.txt','1');process.exit(1)"]\n`,
    );

    // Plain check executes the command (which fails and leaves its marker).
    expect(run(root, ["check"]).status).toBe(1);
    expect(existsSync(marker)).toBe(true);

    // --no-verify: command not executed, gate passes, requirement surfaced.
    const clean = tmp();
    execFileSync("cp", ["-R", `${join(root, "specs")}`, clean]);
    writeFileSync(join(clean, ".2119.yml"), 'prefix: "FIX"\n');
    const r = run(clean, ["check", "--no-verify"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(clean, "ran.txt"))).toBe(false);
    expect(r.stdout).toContain("Manual requirements");
    expect(r.stdout).toContain("FIX-001.1.1");
    expect(r.stdout).toContain("[verify skipped: --no-verify]");
  });

  // 2119: REQ-003.1.8
  it("shared_evidence globs join every test-quality hash", () => {
    const root = tmp();
    mkdirSync(join(root, "tests/helpers"), { recursive: true });
    writeFileSync(join(root, "tests/widget.test.js"), "test('spins', () => {})\n");
    writeFileSync(join(root, "tests/helpers/fixtures.js"), "export const fixture = 1\n");

    const specs = [
      parseSpec("FIX-001-widgets.md", "FIX", `# FIX-001: Widgets\n\n## Overview\n\nWidgets.\n\n## Requirements\n\n### FIX-001.1: Basics\n\n1. The widget MUST spin.\n`),
    ];
    const anns: Annotation[] = [{ file: "tests/widget.test.js", line: 1, ids: ["FIX-001.1.1"] }];
    const files = ["tests/widget.test.js", "tests/helpers/fixtures.js"];
    const targets = (yml: string) => {
      writeFileSync(join(root, ".2119.yml"), yml);
      const coverage = computeCoverage(specs, anns, DEFAULT_ENFORCE);
      return computeReviewTargets(loadConfig(root), specs, coverage, files, anns)[0].reviewId;
    };

    const withShared = targets('prefix: "FIX"\nshared_evidence: ["tests/helpers/**"]\n');
    // Editing the shared helper invalidates the verdict...
    writeFileSync(join(root, "tests/helpers/fixtures.js"), "export const fixture = 2 // neutered\n");
    expect(targets('prefix: "FIX"\nshared_evidence: ["tests/helpers/**"]\n')).not.toBe(withShared);
    // ...but only when the config opts in.
    const without = targets('prefix: "FIX"\n');
    writeFileSync(join(root, "tests/helpers/fixtures.js"), "export const fixture = 3\n");
    expect(targets('prefix: "FIX"\n')).toBe(without);
  });
});
