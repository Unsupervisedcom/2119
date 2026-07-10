import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
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

const emptyDir = () => realpathSync(mkdtempSync(join(tmpdir(), "2119-help-")));

describe("CLI help conventions (REQ-007)", () => {
  // 2119: REQ-007.1.1
  it("prints usage and exits 0 for help, --help, and -h invocations", () => {
    const dir = emptyDir();
    for (const invocation of [["help"], ["--help"], ["-h"], []]) {
      const r = run(dir, invocation);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("usage: 2119 <command>");
    }
  });

  // 2119: REQ-007.1.2
  it("answers --help on any command without executing it or writing files", () => {
    const dir = emptyDir();
    // The field incident: `init --help` must not scaffold.
    const init = run(dir, ["init", "--help"]);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain("usage: 2119 <command>");
    expect(readdirSync(dir)).toEqual([]); // nothing scaffolded

    // Commands that would otherwise fail (uninitialized repo / missing args)
    // also answer help with exit 0 instead of running.
    for (const cmd of [["check", "--help"], ["pass", "-h"], ["review", "--help"]]) {
      const r = run(dir, cmd);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("usage: 2119 <command>");
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  // 2119: REQ-007.1.3
  it("prints usage with a non-zero exit for unrecognized commands", () => {
    const r = run(emptyDir(), ["lnit"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("usage: 2119 <command>");
  });
});
