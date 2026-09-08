import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");
const REPO = resolve(import.meta.dirname, "..");

function lintSyntaxFixture(testSource: string): { status: number; stderr: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-self-evidence-lint-")));
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  cpSync(join(REPO, "specs/self-supplied-evidence.md"), join(root, "specs/self-supplied-evidence.md"));
  writeFileSync(join(root, "tests/syntax.test.ts"), testSource);
  writeFileSync(
    join(root, "tests/factory.ts"),
    "export function importedFactory(value: string): string { return String(value); }\n",
  );
  writeFileSync(
    join(root, ".2119.yml"),
    'specs: ["specs/**/*.md"]\ntests: ["tests/**"]\nprefix: "REQ"\nreviews: false\n',
  );
  const result = spawnSync("node", [CLI, "lint"], { cwd: root, encoding: "utf8" });
  return { status: result.status ?? 1, stderr: result.stderr ?? "" };
}

describe("self-supplied evidence lint compatibility", () => {
  // 2119-spec: self-supplied-evidence
  // 2119: 6.1
  it("accepts representative literal and factory input syntax", () => {
    const testBodies = [
      `it("uses scalar literal input", () => {
  const input = "literal input";
  expect(input).toBe("literal input");
});`,
      `it("uses object literal input", () => {
  const input = { source: "literal input" };
  expect(input.source).toBe("literal input");
});`,
      `it("uses array literal input", () => {
  const input = ["literal input"];
  expect(input[0]).toBe("literal input");
});`,
      `it("uses template literal input", () => {
  const input = \`template input\`;
  expect(input).toBe("template input");
});`,
      `it("uses regexp literal input", () => {
  const input = /literal input/;
  expect(input.test("literal input")).toBe(true);
});`,
      `it("uses primitive literal input", () => {
  expect([42, 42n, true, null]).toHaveLength(4);
});`,
      `function makeInput(value: string): string { return String(value); }
it("uses named factory input", () => {
  expect(makeInput("factory input")).toBe("factory input");
});`,
      `class StaticFactory { static create(value: string): string { return String(value); } }
it("uses static factory input", () => {
  expect(StaticFactory.create("factory input")).toBe("factory input");
});`,
      `class ConstructorFactory { constructor(readonly value: string) {} }
it("uses constructor factory input", () => {
  expect(new ConstructorFactory("factory input").value).toBe("factory input");
});`,
      `class MethodFactory { build(value: string): string { return String(value); } }
it("uses instance-method factory input", () => {
  expect(new MethodFactory().build("factory input")).toBe("factory input");
});`,
      `it("uses imported factory input", () => {
  expect(importedFactory("factory input")).toBe("factory input");
});`,
      `const arrowFactory = (value: string): string => String(value);
it("uses arrow factory input", () => {
  expect(arrowFactory("factory input")).toBe("factory input");
});`,
    ];
    const source = `// 2119-spec: self-supplied-evidence
import { importedFactory } from "./factory.js";

${testBodies.map((body) => `// 2119: 6.1\n${body}`).join("\n\n")}
`;
    const result = lintSyntaxFixture(source);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
