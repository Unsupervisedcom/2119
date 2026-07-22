import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanAnnotations } from "../src/annotations.js";
import { parseSpec, findKeywords } from "../src/spec.js";
import { handleHook } from "../src/hook.js";
import { AGENTS_MD_SECTION } from "../src/init.js";
import { PKG_VERSION } from "../src/adapters.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

function run(cwd: string, args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
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

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "2119-rigor-")));

const SPEC = `# FIX-001: Widgets

## Overview

Widgets.

## Requirements

### FIX-001.1: Basics

1. The widget MUST spin.
`;

function fixture(spec = SPEC): string {
  const root = tmp();
  writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/FIX-001-widgets.md"), spec);
  writeFileSync(join(root, "tests/widget.test.js"), "// 2119: FIX-001.1.1\ntest('spins', () => {})\n");
  return root;
}

describe("deterministic rigor (0.6)", () => {
  // 2119: REQ-002.2.7
  it("counts annotation markers only on comment-leader lines", () => {
    const root = tmp();
    writeFileSync(
      join(root, "t.test.js"),
      [
        'const fake = "2119: FIX-001.1.1";', // string literal: the exploit
        'run("2119: FIX-001.1.2");', // call argument
        "// 2119: FIX-001.1.3", // genuine comment
        "  # 2119: FIX-001.1.4", // indented hash comment
        "REM 2119: FIX-001.1.5", // not a leader by default
      ].join("\n"),
    );
    const ids = scanAnnotations(root, ["t.test.js"], "FIX").flatMap((a) => a.ids);
    expect(ids).toEqual(["FIX-001.1.3", "FIX-001.1.4"]);
    // comment_leaders extends the set (config escape hatch).
    const extended = scanAnnotations(root, ["t.test.js"], "FIX", ["REM"]).flatMap((a) => a.ids);
    expect(extended).toContain("FIX-001.1.5");
    expect(extended).not.toContain("FIX-001.1.1");
  });

  // 2119: REQ-002.4.3
  it("treats an empty specs/ directory as not initialized", () => {
    const root = tmp();
    mkdirSync(join(root, "specs")); // exists but empty — the fail-open case
    const r = run(root, ["check"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not set up");
  });

  // 2119: REQ-001.1.7
  it("rejects two spec files declaring the same document ID", () => {
    const root = fixture();
    writeFileSync(join(root, "specs/FIX-001-duplicate.md"), SPEC);
    const r = run(root, ["lint"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[REQ-001.1.7]");
    expect(r.stderr).toContain("FIX-001");
  });

  // 2119: REQ-001.1.1
  it("rejects content before the H1 title", () => {
    const spec = parseSpec("FIX-001-widgets.md", "FIX", `stray prose first\n\n${SPEC}`);
    expect(spec.violations.some((v) => v.rule === "REQ-001.1.1" && v.message.includes("before"))).toBe(true);
    expect(parseSpec("FIX-001-widgets.md", "FIX", SPEC).violations).toEqual([]);
  });

  // 2119: REQ-002.1.2
  it("ignores keywords inside multi-backtick code spans", () => {
    expect(findKeywords("The tool MUST work and ignore ``quoted MUST`` text")).toEqual(["MUST"]);
    expect(findKeywords("Ignore ``a `MUST` inside`` but count MUST once")).toEqual(["MUST"]);
  });

  // 2119: REQ-003.1.9
  it("fails check when [review] globs match no files", () => {
    const root = fixture(`${SPEC}2. Docs MUST stay honest. [review: docs/autth/**]\n`);
    const r = run(root, ["check"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[REQ-003.1.9]");
    expect(r.stderr).toContain("docs/autth/**");
  });

  // 2119: REQ-003.1.10, REQ-003.1.11
  it("instruction files carry the counterexample obligation and bad-requirement clause", () => {
    const root = fixture();
    run(root, ["review"]);
    const dir = join(root, ".2119/reviews");
    const body = readFileSync(join(dir, readdirSync(dir)[0]), "utf8");
    expect(body).toContain("Counterexample obligation");
    expect(body).toMatch(/nearest violating\s+input/);
    expect(body).toContain("not a pass");
    expect(body).toMatch(/bad\s+requirement honestly tested is still a bad requirement/);
  });

  // 2119: REQ-003.5.6
  it("renders a review_model list as all-must-pass guidance", () => {
    const root = fixture();
    writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\nreview_model: ["opus", "gpt-5.6-sol"]\n');
    const r = run(root, ["review"]);
    expect(r.stdout).toContain("opus, gpt-5.6-sol");
    const dir = join(root, ".2119/reviews");
    const body = readFileSync(join(dir, readdirSync(dir)[0]), "utf8");
    expect(body).toContain("each of opus, gpt-5.6-sol");
    expect(body).toContain("record pass only when all of them pass");
  });

  // 2119: REQ-003.6.3
  it("--audit generates adversarial instructions for passing verdicts only, without touching them", () => {
    // Two requirements: one gets a passing verdict, one stays unreviewed.
    const root = fixture(`${SPEC}2. The widget MUST stop.\n`);
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins', () => {})\n// 2119: FIX-001.1.2\ntest('stops', () => {})\n",
    );
    const out = run(root, ["review"]).stdout;
    const id = out.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    const unpassedId = out.match(/FIX-001\.1\.2--[0-9a-f]{12}/)![0];
    run(root, ["pass", id, "--summary", "asserts spin"]);
    const verdictBefore = readFileSync(join(root, `.2119/verdicts/${id}.json`), "utf8");

    const r = run(root, ["review", "--audit"]);
    expect(r.stdout).toContain("adversarial audit(s)");
    const auditPath = join(root, `.2119/reviews/${id}.audit.md`);
    expect(existsSync(auditPath)).toBe(true);
    // Scoping: no audit for the requirement without a passing verdict.
    expect(existsSync(join(root, `.2119/reviews/${unpassedId}.audit.md`))).toBe(false);
    const body = readFileSync(auditPath, "utf8");
    expect(body).toContain("Adversarial Audit");
    expect(body).toMatch(/violated while every\s+covering test stays green/);
    // The pass-only-if-no-counterexample directive is present.
    expect(body).toMatch(/Only if you genuinely cannot construct one/);
    expect(readFileSync(join(root, `.2119/verdicts/${id}.json`), "utf8")).toBe(verdictBefore);
  });

  // 2119: REQ-003.6.4
  it("never generates audits uninvited; audit:always opts plain review in", () => {
    const root = fixture();
    const id = run(root, ["review"]).stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    run(root, ["pass", id, "--summary", "asserts spin"]);
    run(root, ["review"]);
    run(root, ["check"]);
    expect(existsSync(join(root, `.2119/reviews/${id}.audit.md`))).toBe(false);

    writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\naudit: "always"\n');
    run(root, ["review"]);
    expect(existsSync(join(root, `.2119/reviews/${id}.audit.md`))).toBe(true);
  });

  // 2119: REQ-009.1.1
  it("exits zero when an audit-only review run generates instructions", () => {
    const root = fixture();
    const id = run(root, ["review"]).stdout.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    expect(run(root, ["pass", id, "--summary", "asserts spin behavior"]).status).toBe(0);

    const result = run(root, ["review", "--audit"]);
    expect(existsSync(join(root, `.2119/reviews/${id}.audit.md`))).toBe(true);
    expect(result.stdout).toContain("adversarial audit(s) generated");
    expect(result.status).toBe(0);
  });

  // 2119: REQ-009.1.2
  it("retains a non-zero exit when audits and pending reviews coexist", () => {
    const root = fixture(`${SPEC}2. The widget MUST stop.\n`);
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: FIX-001.1.1\ntest('spins', () => {})\n// 2119: FIX-001.1.2\ntest('stops', () => {})\n",
    );
    const initial = run(root, ["review"]).stdout;
    const passingId = initial.match(/FIX-001\.1\.1--[0-9a-f]{12}/)![0];
    expect(run(root, ["pass", passingId, "--summary", "asserts spin behavior"]).status).toBe(0);

    const result = run(root, ["review", "--audit"]);
    expect(existsSync(join(root, `.2119/reviews/${passingId}.audit.md`))).toBe(true);
    expect(result.stdout).toContain("judgment review(s) pending");
    expect(result.status).toBe(1);
  });

  // 2119: REQ-004.1.10
  it("session-start injects an upgrade notice from a cached probe", async () => {
    const root = fixture();
    const cache = join(tmp(), "upgrade.json");
    writeFileSync(cache, JSON.stringify({ checkedAt: Date.now(), latest: "99.0.0" }));
    process.env.RFC2119_UPGRADE_CACHE = cache;
    try {
      const res = (await handleHook(root, "session-start", "claude", {})) as {
        hookSpecificOutput?: { additionalContext?: string };
      };
      const ctx = res.hookSpecificOutput?.additionalContext ?? "";
      expect(ctx).toContain("rfc2119 99.0.0 is available");
      expect(ctx).toContain(PKG_VERSION);
      expect(ctx).toContain("init --refresh");
    } finally {
      delete process.env.RFC2119_UPGRADE_CACHE;
    }
  });

  // 2119: REQ-004.1.11
  it("an unreachable registry neither delays nor breaks the hook", async () => {
    const root = fixture();
    const cache = join(tmp(), "upgrade.json"); // absent → probe attempts network
    process.env.RFC2119_UPGRADE_CACHE = cache;
    process.env.RFC2119_REGISTRY_URL = "http://127.0.0.1:1/latest"; // unroutable
    try {
      const start = Date.now();
      const res = (await handleHook(root, "session-start", "claude", {})) as {
        hookSpecificOutput?: { additionalContext?: string };
      };
      expect(Date.now() - start).toBeLessThan(1000);
      expect(res.hookSpecificOutput?.additionalContext).toContain("spec-driven testing");
      expect(res.hookSpecificOutput?.additionalContext).not.toContain("is available");
    } finally {
      delete process.env.RFC2119_UPGRADE_CACHE;
      delete process.env.RFC2119_REGISTRY_URL;
    }
  });

  // 2119: REQ-004.2.8
  it("init --agent claude maintains the same section in CLAUDE.md", () => {
    const root = tmp();
    run(root, ["init", "--agent", "claude"]);
    const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(claude).toContain("<!-- 2119:begin -->");
    expect(claude).toContain(AGENTS_MD_SECTION.trim());
    expect(agents).toContain(AGENTS_MD_SECTION.trim());
    // Idempotent: re-run adds nothing.
    run(root, ["init", "--agent", "claude"]);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8").match(/2119:begin/g)).toHaveLength(1);
  });

  // 2119: REQ-004.3.8
  it("init repairs a repository whose spec globs match nothing", () => {
    const root = tmp();
    mkdirSync(join(root, "specs")); // empty dir: old init skipped this
    run(root, ["init"]);
    expect(existsSync(join(root, "specs/REQ-001-example.md"))).toBe(true);
  });

  // 2119: REQ-004.3.9
  it("init --refresh re-pins generated artifacts and touches nothing foreign", () => {
    const root = tmp();
    run(root, ["init", "--agent", "claude", "--ci"]);
    // Simulate artifacts generated by an older version.
    const settingsPath = join(root, ".claude/settings.json");
    writeFileSync(settingsPath, readFileSync(settingsPath, "utf8").replaceAll(`rfc2119@${PKG_VERSION}`, "rfc2119@0.4.0"));
    const wfPath = join(root, ".github/workflows/2119.yml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8").replaceAll(`rfc2119@${PKG_VERSION}`, "rfc2119@0.4.0"));
    const foreign = join(root, ".github/workflows/other.yml");
    writeFileSync(foreign, "name: mine\n");

    run(root, ["init", "--refresh"]);
    expect(readFileSync(settingsPath, "utf8")).toContain(`rfc2119@${PKG_VERSION}`);
    expect(readFileSync(wfPath, "utf8")).toContain(`rfc2119@${PKG_VERSION}`);
    expect(readFileSync(foreign, "utf8")).toBe("name: mine\n");
  });

  // 2119: REQ-004.3.10
  it("an invalid init invocation writes nothing", () => {
    const root = tmp();
    const r = run(root, ["init", "--agent", "clade"]);
    expect(r.status).toBe(2);
    expect(readdirSync(root)).toEqual([]);
    const r2 = run(root, ["init", "--bogus-flag"]);
    expect(r2.status).toBe(2);
    expect(readdirSync(root)).toEqual([]);
  });

  // 2119: REQ-004.3.11
  it("the generated config documents every user-facing option", () => {
    const root = tmp();
    run(root, ["init"]);
    const cfg = readFileSync(join(root, ".2119.yml"), "utf8");
    for (const key of ["review_model", "shared_evidence", "comment_leaders", "audit", "enforce", "reviews"]) {
      expect(cfg).toContain(key);
    }
  });

  // 2119: REQ-004.3.12
  it("init prints npx-resolvable guidance, never bare global commands", () => {
    const root = tmp();
    const r = run(root, ["init"]);
    expect(r.stdout).toContain("npx rfc2119 check");
    expect(r.stdout).toContain("npx rfc2119 init --agent");
    expect(r.stdout).not.toMatch(/`2119 init/);
  });
});
