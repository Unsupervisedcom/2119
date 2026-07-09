import { describe, expect, it } from "vitest";
import { parseSpec, findKeywords } from "../src/spec.js";

const parse = (name: string, content: string) => parseSpec(name, "REQ", content);

const VALID = `# REQ-001: Widgets

## Overview

Widgets.

## Requirements

### REQ-001.1: Basics

1. The widget MUST spin.
2. The widget SHOULD hum quietly.
`;

describe("spec parsing and lint", () => {
  // 2119: REQ-001.2.1
  it("assigns stable IDs REQ-NNN.M.K from section and list position", () => {
    const spec = parse("REQ-001-widgets.md", VALID);
    expect(spec.violations).toEqual([]);
    const ids = spec.sections[0].items.map((r) => r.id);
    expect(ids).toEqual(["REQ-001.1.1", "REQ-001.1.2"]);
    expect(spec.sections[0].items[0].sectionId).toBe("REQ-001.1");
  });

  // 2119: REQ-001.1.1
  it("flags a top-level heading that does not match the filename prefix", () => {
    const spec = parse("REQ-002-widgets.md", VALID);
    expect(spec.violations.some((v) => v.rule === "REQ-001.1.1")).toBe(true);
    const good = parse("REQ-001-widgets.md", VALID);
    expect(good.violations.filter((v) => v.rule === "REQ-001.1.1")).toEqual([]);
  });

  // 2119: REQ-001.1.2
  it("requires an Overview section before Requirements", () => {
    const noOverview = VALID.replace("## Overview\n\nWidgets.\n", "");
    expect(parse("REQ-001-w.md", noOverview).violations.some((v) => v.rule === "REQ-001.1.2")).toBe(true);
    const reversed = `# REQ-001: W\n\n## Requirements\n\n### REQ-001.1: A\n\n1. It MUST work.\n\n## Overview\n\nLate.\n`;
    expect(parse("REQ-001-w.md", reversed).violations.some((v) => v.rule === "REQ-001.1.2")).toBe(true);
  });

  // 2119: REQ-001.1.3
  it("requires a Requirements section containing at least one REQ-NNN.M subsection", () => {
    const noSections = `# REQ-001: W\n\n## Overview\n\nX.\n\n## Requirements\n\nProse only.\n`;
    expect(parse("REQ-001-w.md", noSections).violations.some((v) => v.rule === "REQ-001.1.3")).toBe(true);
    const noHeading = `# REQ-001: W\n\n## Overview\n\nX.\n`;
    expect(parse("REQ-001-w.md", noHeading).violations.some((v) => v.rule === "REQ-001.1.3")).toBe(true);
  });

  // 2119: REQ-001.1.4
  it("flags section IDs with the wrong file number or out-of-sequence M values", () => {
    const wrongDoc = VALID.replace("### REQ-001.1: Basics", "### REQ-002.1: Basics");
    expect(parse("REQ-001-w.md", wrongDoc).violations.some((v) => v.rule === "REQ-001.1.4")).toBe(true);
    const skipped = VALID.replace("### REQ-001.1: Basics", "### REQ-001.3: Basics");
    expect(parse("REQ-001-w.md", skipped).violations.some((v) => v.rule === "REQ-001.1.4")).toBe(true);
  });

  // 2119: REQ-001.2.2
  it("requires exactly one RFC 2119 keyword per requirement statement", () => {
    const none = VALID.replace("The widget MUST spin.", "The widget spins.");
    expect(parse("REQ-001-w.md", none).violations.some((v) => v.rule === "REQ-001.2.2")).toBe(true);
    const two = VALID.replace("The widget MUST spin.", "The widget MUST spin and SHOULD glow.");
    expect(parse("REQ-001-w.md", two).violations.some((v) => v.rule === "REQ-001.2.2")).toBe(true);
  });

  // 2119: REQ-002.1.2
  it("ignores RFC 2119 keywords inside inline code spans", () => {
    const quoted = VALID.replace(
      "The widget SHOULD hum quietly.",
      "The widget SHOULD reject phrases like `MUST be fast` and `SHALL NOT lag`.",
    );
    const spec = parse("REQ-001-w.md", quoted);
    expect(spec.violations.filter((v) => v.rule === "REQ-001.2.2")).toEqual([]);
    expect(spec.sections[0].items[1].keywords).toEqual(["SHOULD"]);
  });

  // 2119: REQ-001.2.6
  it("treats keywords as normative only in UPPERCASE, per RFC 8174", () => {
    expect(findKeywords("The widget must spin and should hum.")).toEqual([]);
    expect(findKeywords("It is required that this may work.")).toEqual([]);
    // A statement whose only imperative is lowercase lints as keyword-less.
    const lowercase = VALID.replace("The widget MUST spin.", "The widget must spin.");
    const spec = parse("REQ-001-w.md", lowercase);
    expect(spec.violations.some((v) => v.rule === "REQ-001.2.2" && v.message.includes("no RFC 2119 keyword"))).toBe(
      true,
    );
  });

  // 2119: REQ-002.1.4
  it("matches compound keywords longest-first as single units", () => {
    expect(findKeywords("It MUST NOT explode.")).toEqual(["MUST NOT"]);
    expect(findKeywords("Use is NOT RECOMMENDED here.")).toEqual(["NOT RECOMMENDED"]);
    expect(findKeywords("It SHALL NOT and it MUST.")).toEqual(["SHALL NOT", "MUST"]);
  });

  // 2119: REQ-001.2.3
  it("flags gaps and duplicates in requirement item numbering", () => {
    const gap = VALID.replace("2. The widget SHOULD hum quietly.", "3. The widget SHOULD hum quietly.");
    expect(parse("REQ-001-w.md", gap).violations.some((v) => v.rule === "REQ-001.2.3")).toBe(true);
  });

  // 2119: REQ-001.2.1
  it("joins multi-line statements into a single requirement", () => {
    const wrapped = VALID.replace(
      "1. The widget MUST spin.",
      "1. The widget MUST spin\n   continuously without stopping.",
    );
    const spec = parse("REQ-001-w.md", wrapped);
    expect(spec.sections[0].items[0].text).toBe("The widget MUST spin continuously without stopping.");
    expect(spec.violations).toEqual([]);
  });

  // 2119: REQ-002.1.1
  it("validates all structure rules together on a multi-violation document", () => {
    const messy = `# REQ-009: Wrong

## Requirements

### REQ-009.2: Out of order

1. This has no keyword.
3. This one MUST skip a number.
`;
    const spec = parse("REQ-001-messy.md", messy);
    const rules = spec.violations.map((v) => v.rule);
    expect(rules).toContain("REQ-001.1.1"); // heading mismatch
    expect(rules).toContain("REQ-001.1.2"); // missing Overview
    expect(rules).toContain("REQ-001.1.4"); // section numbering
    expect(rules).toContain("REQ-001.2.2"); // keyword count
    expect(rules).toContain("REQ-001.2.3"); // item numbering
  });

  // 2119: REQ-002.1.1
  it("ignores headings, list items, and keywords inside fenced code blocks", () => {
    const fenced = `${VALID}
Example of a malformed spec:

\`\`\`markdown
# REQ-999: Fake document
### REQ-001.7: Fake section
1. This fake item has no keyword.
2. This fake item MUST also SHOULD confuse the linter.
\`\`\`
`;
    const spec = parse("REQ-001-widgets.md", fenced);
    expect(spec.violations).toEqual([]);
    // The fenced section and items never become structure.
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0].items).toHaveLength(2);
  });

  it("treats REQUIREMENT REMOVED tombstones as removed with no keyword lint", () => {
    const tomb = VALID.replace("The widget MUST spin.", "REQUIREMENT REMOVED");
    const spec = parse("REQ-001-w.md", tomb);
    expect(spec.sections[0].items[0].removed).toBe(true);
    expect(spec.violations.filter((v) => v.rule === "REQ-001.2.2")).toEqual([]);
  });
});
