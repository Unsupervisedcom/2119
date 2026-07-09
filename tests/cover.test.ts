import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec.js";
import { computeCoverage } from "../src/cover.js";
import { buildAnnotationRegex } from "../src/annotations.js";
import type { Annotation } from "../src/model.js";
import { DEFAULT_ENFORCE } from "../src/config.js";

const SPEC = `# REQ-001: Widgets

## Overview

Widgets.

## Requirements

### REQ-001.1: Basics

1. The widget MUST spin.
2. The widget MUST NOT explode.
3. The widget SHOULD hum.
4. Docs MUST stay accurate. [review: docs/**]
5. Support MUST answer the phone. [manual]
`;

const specs = [parseSpec("REQ-001-widgets.md", "REQ", SPEC)];
const ann = (ids: string[], file = "tests/widget.test.ts", line = 1): Annotation => ({ file, line, ids });

describe("coverage", () => {
  // 2119: REQ-002.2.1
  it("requires a covering annotation for every enforced test-coverage requirement", () => {
    const result = computeCoverage(specs, [ann(["REQ-001.1.1"])], DEFAULT_ENFORCE);
    // .1.2 (MUST NOT) is uncovered; .1.3 is SHOULD (not enforced by default).
    expect(result.uncovered.map((r) => r.id)).toEqual(["REQ-001.1.2"]);
    expect(result.violations.some((v) => v.rule === "REQ-002.2.4")).toBe(true);
  });

  // 2119: REQ-002.2.4
  it("lists every uncovered requirement with its statement text", () => {
    const result = computeCoverage(specs, [], DEFAULT_ENFORCE);
    const messages = result.violations.filter((v) => v.rule === "REQ-002.2.4").map((v) => v.message);
    expect(messages.some((m) => m.includes("REQ-001.1.1") && m.includes("spin"))).toBe(true);
    expect(messages.some((m) => m.includes("REQ-001.1.2"))).toBe(true);
  });

  // 2119: REQ-002.2.3
  it("fails annotations that reference unknown requirement IDs", () => {
    const result = computeCoverage(specs, [ann(["REQ-009.1.1"])], DEFAULT_ENFORCE);
    expect(result.violations.some((v) => v.rule === "REQ-002.2.3" && v.message.includes("REQ-009.1.1"))).toBe(true);
  });

  // 2119: REQ-002.2.3
  it("tolerates annotations referencing tombstoned requirements", () => {
    const tombSpec = parseSpec("REQ-001-w.md", "REQ", SPEC.replace("The widget MUST spin.", "REQUIREMENT REMOVED"));
    const result = computeCoverage([tombSpec], [ann(["REQ-001.1.1"])], DEFAULT_ENFORCE);
    expect(result.violations.filter((v) => v.rule === "REQ-002.2.3")).toEqual([]);
  });

  // 2119: REQ-002.2.5
  it("counts a section-level annotation as covering every item in the section", () => {
    const result = computeCoverage(specs, [ann(["REQ-001.1"])], DEFAULT_ENFORCE);
    expect(result.uncovered).toEqual([]);
    expect(result.covered.has("REQ-001.1.1")).toBe(true);
    expect(result.covered.has("REQ-001.1.2")).toBe(true);
  });

  // 2119: REQ-001.4.1
  it("does not demand test coverage for [review]-tagged requirements", () => {
    // Item-level annotations only, so the [review] exemption is load-bearing:
    // if review-kind requirements were not exempt, REQ-001.1.4 would be uncovered.
    const result = computeCoverage(specs, [ann(["REQ-001.1.1", "REQ-001.1.2"])], DEFAULT_ENFORCE);
    expect(result.uncovered.map((r) => r.id)).not.toContain("REQ-001.1.4");
    expect(result.uncovered).toEqual([]);
    const req = specs[0].sections[0].items[3];
    expect(req.coverage).toEqual({ kind: "review", globs: ["docs/**"] });
  });

  // 2119: REQ-001.4.2
  it("exempts [manual] requirements from coverage and surfaces them in results", () => {
    const result = computeCoverage(specs, [], DEFAULT_ENFORCE);
    expect(result.uncovered.map((r) => r.id)).not.toContain("REQ-001.1.5");
    expect(result.manual.map((r) => r.id)).toEqual(["REQ-001.1.5"]);
  });

  // 2119: REQ-001.4.3
  it("defaults untagged requirements to test coverage", () => {
    expect(specs[0].sections[0].items[0].coverage).toEqual({ kind: "test" });
  });

  // 2119: REQ-002.2.2
  it("recognizes the language-agnostic comment annotation format", () => {
    const re = buildAnnotationRegex("REQ");
    const marker = ["21", "19"].join(""); // avoid a literal self-annotation in this file
    const py = `# ${marker}: REQ-001.1.1`;
    const ts = `// ${marker}: REQ-001.1.1, REQ-001.1.2`;
    const go = `/* ${marker}:REQ-001.1 */`;
    expect(py.match(re)).toBeTruthy();
    expect(ts.match(re)).toBeTruthy();
    expect(go.match(re)).toBeTruthy();
    re.lastIndex = 0;
    const m = re.exec(ts);
    expect(m?.[1].split(/\s*,\s*/)).toEqual(["REQ-001.1.1", "REQ-001.1.2"]);
  });

  // 2119: REQ-002.2.6
  it("supports enforcing SHOULD-level coverage via the configured severity set", () => {
    const result = computeCoverage(specs, [ann(["REQ-001.1.1", "REQ-001.1.2"])], [...DEFAULT_ENFORCE, "SHOULD"]);
    expect(result.uncovered.map((r) => r.id)).toEqual(["REQ-001.1.3"]);
  });
});
