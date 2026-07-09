import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

function run(cwd: string, args: string[]): { status: number; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" }) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { status: e.status, stdout: e.stdout ?? "" };
  }
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-dispatch-")));
  writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/FIX-001-widgets.md"), SPEC);
  writeFileSync(
    join(root, "tests/widget.test.js"),
    "// 2119: FIX-001.1.1\ntest('spins', () => {})\n// 2119: FIX-001.1.2\ntest('stops', () => {})\n",
  );
  return root;
}

describe("review --dispatch (REQ-003.6)", () => {
  // 2119: REQ-003.6.1
  it("emits a ready-to-paste prompt assigning each pending instruction file to one reviewer", () => {
    const root = fixture();
    const plain = run(root, ["review"]);
    expect(plain.stdout).not.toContain("dispatch prompt");

    const dispatch = run(root, ["review", "--dispatch"]);
    expect(dispatch.status).toBe(1); // still signals pending reviews
    expect(dispatch.stdout).toContain("dispatch prompt (paste to your orchestrating agent)");
    expect(dispatch.stdout).toContain("Dispatch 2 fresh-context reviewer subagent(s)");
    // One numbered assignment per pending review, naming its instruction file.
    expect(dispatch.stdout).toMatch(/1\. Read \.2119\/reviews\/FIX-001\.1\.1--[0-9a-f]{12}\.md/);
    expect(dispatch.stdout).toMatch(/2\. Read \.2119\/reviews\/FIX-001\.1\.2--[0-9a-f]{12}\.md/);
  });

  // 2119: REQ-003.6.2
  it("directs parallel execution and per-reviewer verdict recording", () => {
    const root = fixture();
    const { stdout } = run(root, ["review", "--dispatch"]);
    expect(stdout).toContain("in parallel where your\nplatform supports it");
    expect(stdout).toContain("record your own verdict with the `pass`/`fail` command it names");
  });
});
