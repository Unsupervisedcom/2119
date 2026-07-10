import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");

// 2119: REQ-002.3.2
describe("check performance", () => {
  it("completes in under 5 seconds on 100 spec files and 2000 test files", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-perf-")));
    writeFileSync(join(root, ".2119.yml"), 'prefix: "FIX"\n');
    mkdirSync(join(root, "specs"));
    mkdirSync(join(root, "tests"));
    for (let d = 1; d <= 100; d++) {
      const id = `FIX-${String(d).padStart(3, "0")}`;
      writeFileSync(
        join(root, `specs/${id}-gen.md`),
        `# ${id}: Generated\n\n## Overview\n\nGenerated fixture.\n\n## Requirements\n\n### ${id}.1: Items\n\n1. The system MUST hold invariant ${d}.\n2. The system MUST hold invariant ${d} under load.\n`,
      );
    }
    for (let t = 0; t < 2000; t++) {
      const d = (t % 100) + 1;
      const id = `FIX-${String(d).padStart(3, "0")}`;
      const item = (t % 2) + 1;
      writeFileSync(
        join(root, `tests/gen-${t}.test.js`),
        `// 2119: ${id}.1.${item}\ntest('invariant ${t}', () => { expect(check(${t})).toBe(true) })\n`,
      );
    }
    const started = Date.now();
    // Exit code 1 is expected (no review verdicts exist); only time matters here.
    try {
      execFileSync("node", [CLI, "check"], { cwd: root, encoding: "utf8" });
    } catch {
      /* violations expected */
    }
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5000);
  });
});
