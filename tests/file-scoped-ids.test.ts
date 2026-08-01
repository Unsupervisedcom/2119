import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../src/spec.js";
import { scanAnnotations, evidenceBlockParts } from "../src/annotations.js";
import { computeCoverage } from "../src/cover.js";
import { computeReviewTargets } from "../src/review.js";
import { buildContext } from "../src/check.js";
import { loadConfig, DEFAULT_ENFORCE } from "../src/config.js";
import { writeVerdict } from "../src/verdict.js";
import type { Annotation } from "../src/model.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");
const README = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" }), stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const tmp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));

// A valid file-scoped spec: filename is the namespace, headings are bare.
const SCROLLBACK_SPEC = `# Codex Session Scrollback

## Overview

Scrollback retention for codex sessions.

## Requirements

### 1: Retention

1. The pane MUST retain the last 10000 lines.
2. The pane SHOULD highlight error lines.
3. The pane MUST clear on session end.
`;

const OTHER_SPEC = `# Other Feature

## Overview

An unrelated feature, used to test cross-spec full-ID references.

## Requirements

### 1: Basics

1. It MUST work.
`;

const LEGACY_SPEC = `# REQ-900: Widgets

## Overview

Widgets.

## Requirements

### REQ-900.1: Basics

1. The widget MUST spin.
`;

function fsFixture(): string {
  const root = tmp("2119-fsid-");
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/codex-session-scrollback.md"), SCROLLBACK_SPEC);
  writeFileSync(join(root, "specs/other-spec.md"), OTHER_SPEC);
  // other-spec.md exists so tests can reference a foreign spec; pre-cover it so tests that don't
  // care about it don't trip over an unrelated uncovered-requirement violation.
  writeFileSync(join(root, "tests/other-spec-baseline.test.ts"), "// 2119: other-spec.1.1\ntest('baseline', () => {})\n");
  return root;
}

describe("file-scoped spec filenames (REQ-011.1)", () => {
  // 2119: REQ-011.1.1
  it("classifies by whether the filename matches <prefix>-NNN, not by superficial resemblance", () => {
    const valid = parseSpec("specs/codex-session-scrollback.md", "REQ", SCROLLBACK_SPEC);
    expect(valid.violations).toEqual([]);
    expect(valid.docId).toBe("codex-session-scrollback");

    // A real "REQ-NNN"-prefixed filename is legacy, never file-scoped, regardless of a trailing slug.
    const legacyLike = parseSpec(
      "specs/REQ-5-widgets.md",
      "REQ",
      "# REQ-5: Widgets\n\n## Overview\n\nX.\n\n## Requirements\n\n### REQ-5.1: Basics\n\n1. It MUST work.\n",
    );
    expect(legacyLike.docId).toBe("REQ-5");
    expect(legacyLike.violations).toEqual([]);

    // Case-sensitive match: a lowercase look-alike of the prefix is NOT the legacy grammar.
    const caseMismatch = parseSpec(
      "specs/req-5-widgets.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# req-5-widgets"),
    );
    expect(caseMismatch.docId).toBe("req-5-widgets");

    // The configured prefix, not the literal string "REQ", decides the boundary.
    const underCustomPrefix = parseSpec(
      "specs/widgets.md",
      "ACME-REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Widgets"),
    );
    expect(underCustomPrefix.docId).toBe("widgets");

    // The prefix alone, with no digits after it, does not match "<prefix>-NNN" either — the
    // classification stays file-scoped (its stem is the whole basename, not "REQ").
    const zeroDigits = parseSpec(
      "specs/REQ-widgets.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Widgets"),
    );
    expect(zeroDigits.docId).toBe("REQ-widgets");

    // "One or more digits": a multi-digit legacy number is legacy too, not just a single digit.
    const multiDigit = parseSpec(
      "specs/REQ-12-widgets.md",
      "REQ",
      "# REQ-12: Widgets\n\n## Overview\n\nX.\n\n## Requirements\n\n### REQ-12.1: Basics\n\n1. It MUST work.\n",
    );
    expect(multiDigit.docId).toBe("REQ-12");
    expect(multiDigit.violations).toEqual([]);
  });

  // 2119: REQ-011.1.2
  it("rejects a namespace stem with an uppercase letter or an underscore, independently", () => {
    const uppercase = parseSpec(
      "specs/Scrollback.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Scrollback"),
    );
    expect(uppercase.violations.some((v) => v.rule === "REQ-011.1.2")).toBe(true);

    const underscore = parseSpec(
      "specs/codex_scrollback.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Codex Scrollback"),
    );
    expect(underscore.violations.some((v) => v.rule === "REQ-011.1.2")).toBe(true);

    const dot = parseSpec(
      "specs/codex.scrollback.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Codex Scrollback"),
    );
    expect(dot.violations.some((v) => v.rule === "REQ-011.1.2")).toBe(true);

    const space = parseSpec(
      "specs/codex scrollback.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Codex Scrollback"),
    );
    expect(space.violations.some((v) => v.rule === "REQ-011.1.2")).toBe(true);

    const nonAscii = parseSpec(
      "specs/codex-scröllback.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Codex Scrollback"),
    );
    expect(nonAscii.violations.some((v) => v.rule === "REQ-011.1.2")).toBe(true);

    // The valid stem itself must never trip this rule.
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", SCROLLBACK_SPEC).violations.some(
        (v) => v.rule === "REQ-011.1.2",
      ),
    ).toBe(false);

    // Positive control: digits ARE part of the allowed charset — a stem must not be rejected just
    // for containing one, only for containing something outside [a-z0-9-].
    const digitBearing = parseSpec(
      "specs/codex-2fa-scrollback.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Codex 2FA Scrollback"),
    );
    expect(digitBearing.violations.some((v) => v.rule === "REQ-011.1.2")).toBe(false);
  });

  // 2119: REQ-011.1.3
  it("rejects a stem with no lowercase letter, whether pure digits or digits and hyphens", () => {
    const pureDigits = parseSpec("specs/12345.md", "REQ", SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Numeric"));
    expect(pureDigits.violations.some((v) => v.rule === "REQ-011.1.3")).toBe(true);

    const digitsAndHyphens = parseSpec(
      "specs/123-45.md",
      "REQ",
      SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# Numeric"),
    );
    expect(digitsAndHyphens.violations.some((v) => v.rule === "REQ-011.1.3")).toBe(true);
  });

  // 2119: REQ-011.1.4
  it("rejects a namespace stem with leading, trailing, or doubled hyphens", () => {
    const bodies = ["-scrollback.md", "scrollback-.md", "codex--scrollback.md"];
    for (const name of bodies) {
      const spec = parseSpec(`specs/${name}`, "REQ", SCROLLBACK_SPEC.replace("# Codex Session Scrollback", "# X"));
      expect(spec.violations.some((v) => v.rule === "REQ-011.1.4"), `expected ${name} to be flagged`).toBe(true);
    }
  });
});

describe("file-scoped document structure and canonical IDs (REQ-011.2)", () => {
  // 2119: REQ-011.2.1
  it("requires a top-level heading as the first content, with no document-ID prefix required", () => {
    const spec = parseSpec("specs/codex-session-scrollback.md", "REQ", SCROLLBACK_SPEC);
    expect(spec.title).toBe("Codex Session Scrollback");
    expect(spec.violations.filter((v) => v.rule === "REQ-011.2.1")).toEqual([]);

    const proseFirst = "Some intro prose.\n\n# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", proseFirst).violations.some((v) => v.rule === "REQ-011.2.1"),
    ).toBe(true);

    const noHeadingAtAll = "## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", noHeadingAtAll).violations.some((v) => v.rule === "REQ-011.2.1"),
    ).toBe(true);

    // A fenced code block is content too — it just isn't STRUCTURE (REQ-002.1.1 exempts headings,
    // list items, and keywords found INSIDE a fence from structural parsing; it does not exempt a
    // fence's mere presence before the title from being "content before it").
    const fenceFirst = "```\nsome fence\n```\n\n# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", fenceFirst).violations.some((v) => v.rule === "REQ-011.2.1"),
    ).toBe(true);
  });

  // 2119: REQ-011.2.2
  it("requires Overview before Requirements and at least one requirements subsection, as legacy specs do", () => {
    const noOverview = SCROLLBACK_SPEC.replace("## Overview\n\nScrollback retention for codex sessions.\n\n", "");
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", noOverview).violations.some((v) => v.rule === "REQ-001.1.2"),
    ).toBe(true);

    const noSections = "# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\nProse only.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", noSections).violations.some((v) => v.rule === "REQ-001.1.3"),
    ).toBe(true);

    // Overview present but the Requirements heading is entirely absent.
    const noRequirementsHeading = "# Codex Session Scrollback\n\n## Overview\n\nX.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", noRequirementsHeading).violations.some(
        (v) => v.rule === "REQ-001.1.3",
      ),
    ).toBe(true);

    // Explicit ordering violation: Requirements before Overview.
    const reversed = "# Codex Session Scrollback\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n\n## Overview\n\nLate.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", reversed).violations.some((v) => v.rule === "REQ-001.1.2"),
    ).toBe(true);

    // A well-formed bare heading OUTSIDE `## Requirements` is not a real requirements section —
    // it must not be smuggled into the document's sections (whether under `## Overview`, or after
    // a later `## Notes`), and `## Requirements` still correctly reports having none of its own.
    const outsideOverview =
      "# Codex Session Scrollback\n\n## Overview\n\n### 1: Outside\n\n1. It MUST work.\n\n## Requirements\n\nProse only.\n";
    const outsideSpec = parseSpec("specs/codex-session-scrollback.md", "REQ", outsideOverview);
    expect(outsideSpec.sections).toEqual([]);
    expect(outsideSpec.violations.some((v) => v.rule === "REQ-001.1.3")).toBe(true);

    const outsideAfterNotes =
      "# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n\n## Notes\n\n### 2: Also Outside\n\n1. It MUST also work.\n";
    const afterNotesSpec = parseSpec("specs/codex-session-scrollback.md", "REQ", outsideAfterNotes);
    expect(afterNotesSpec.sections.map((s) => s.id)).toEqual(["codex-session-scrollback.1"]);
  });

  // 2119: REQ-011.2.3
  it("requires the bare `### N: Title` heading grammar, rejecting near-miss variants", () => {
    const variants = [
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1 Retention"), // no colon
      SCROLLBACK_SPEC.replace("### 1: Retention", "### one: Retention"), // non-numeric
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1.5: Retention"), // non-integer
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1: "), // missing title
      SCROLLBACK_SPEC.replace("### 1: Retention", "### other-spec.1: Retention"), // qualified with a FOREIGN stem
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1 : Retention"), // space BEFORE the colon
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1:Retention"), // no space AFTER the colon
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1:  Retention"), // two spaces after the colon
      SCROLLBACK_SPEC.replace("### 1: Retention", "###  1: Retention"), // two spaces between ### and N
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1:\tRetention"), // tab (not space) after the colon
      SCROLLBACK_SPEC.replace("### 1: Retention", "###\t1: Retention"), // tab (not space) between ### and N
      SCROLLBACK_SPEC.replace("### 1: Retention", "### 1: Retention ###"), // trailing ATX closing marker
      SCROLLBACK_SPEC.replace("### 1: Retention", "###"), // bare "###", no separator or content at all
      SCROLLBACK_SPEC.replace("### 1: Retention", "### "), // "###" plus only a trailing space
      SCROLLBACK_SPEC.replace("### 1: Retention", "###\t"), // "###" plus only a trailing tab
    ];
    for (const [i, variant] of variants.entries()) {
      expect(
        parseSpec("specs/codex-session-scrollback.md", "REQ", variant).violations.some((v) => v.rule === "REQ-011.2.3"),
        `variant ${i} should be flagged`,
      ).toBe(true);
    }

    // Exactly one space after the colon is the only accepted form.
    const exactlyOneSpace = SCROLLBACK_SPEC; // "### 1: Retention" already has exactly one space
    const spec = parseSpec("specs/codex-session-scrollback.md", "REQ", exactlyOneSpace);
    expect(spec.violations.filter((v) => v.rule === "REQ-011.2.3")).toEqual([]);
    expect(spec.sections[0].title).toBe("Retention");

    // The nearest non-bare heading of all — the file's OWN stem qualifying its own heading — must
    // also never be silently accepted as a valid bare section, whichever specific rule names it
    // (REQ-011.2.4 covers this case by name; here we only require it is never treated as valid).
    const selfQualified = SCROLLBACK_SPEC.replace("### 1: Retention", "### codex-session-scrollback.1: Retention");
    const selfQualifiedSpec = parseSpec("specs/codex-session-scrollback.md", "REQ", selfQualified);
    expect(selfQualifiedSpec.violations.length).toBeGreaterThan(0);
    expect(selfQualifiedSpec.sections).toEqual([]);

    // "Each subsection" (REQ-011.2.3 applies per-heading, not just to the first): a SECOND section
    // with a malformed heading must be flagged even when the first section is perfectly bare.
    const secondSectionMalformed =
      SCROLLBACK_SPEC + "\n### two: Cleanup\n\n1. The pane MUST clear scrollback buffers on exit.\n";
    const multiSpec = parseSpec("specs/codex-session-scrollback.md", "REQ", secondSectionMalformed);
    expect(multiSpec.violations.some((v) => v.rule === "REQ-011.2.3")).toBe(true);
    // The first, well-formed section is unaffected — it does not become collateral damage.
    expect(multiSpec.sections[0].id).toBe("codex-session-scrollback.1");
    expect(multiSpec.sections[0].items).toHaveLength(3);

    // A bare, empty "###" heading must not silently fall through as ordinary body text: it must
    // both raise REQ-011.2.3 AND clear the current section, so the item that follows it is not
    // wrongly attached to the section above as a fourth item of section 1.
    const emptyHeadingThenItem = SCROLLBACK_SPEC + "\n###\n\n1. A stray item MUST NOT join section 1.\n";
    const emptyHeadingSpec = parseSpec("specs/codex-session-scrollback.md", "REQ", emptyHeadingThenItem);
    expect(emptyHeadingSpec.violations.some((v) => v.rule === "REQ-011.2.3")).toBe(true);
    expect(emptyHeadingSpec.sections[0].items).toHaveLength(3);
  });

  // 2119: REQ-011.2.4
  it("rejects a section heading that bakes in the file's own stem", () => {
    const selfPrefixed = SCROLLBACK_SPEC.replace("### 1: Retention", "### codex-session-scrollback.1: Retention");
    const spec = parseSpec("specs/codex-session-scrollback.md", "REQ", selfPrefixed);
    expect(spec.violations.some((v) => v.rule === "REQ-011.2.4")).toBe(true);
  });

  // 2119: REQ-011.2.5
  it("requires unique and sequential section and item numbering from 1", () => {
    const skippedSection = SCROLLBACK_SPEC.replace("### 1: Retention", "### 2: Retention");
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", skippedSection).violations.some((v) => v.rule === "REQ-001.1.4"),
    ).toBe(true);

    // A LATER gap: section 1 exists and is fine, but the second section jumps to 3.
    const laterSectionGap =
      SCROLLBACK_SPEC + "\n### 3: Cleanup\n\n1. The pane MUST clear scrollback buffers on exit.\n";
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", laterSectionGap).violations.some((v) => v.rule === "REQ-001.1.4"),
    ).toBe(true);

    const skippedItem = SCROLLBACK_SPEC.replace(
      "3. The pane MUST clear on session end.",
      "4. The pane MUST clear on session end.",
    );
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", skippedItem).violations.some((v) => v.rule === "REQ-001.2.3"),
    ).toBe(true);

    // Duplicate section numbers: two "### 1" sections in one file.
    const duplicateSection = `# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n\n### 1: B\n\n1. It also MUST work.\n`;
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", duplicateSection).violations.some((v) => v.rule === "REQ-001.1.4"),
    ).toBe(true);

    // Duplicate item numbers within one section.
    const duplicateItem = `# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n1. It MUST work twice.\n`;
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", duplicateItem).violations.some((v) => v.rule === "REQ-001.2.3"),
    ).toBe(true);

    // A section whose very first item is numbered 2 (not a later gap, but wrong from the start).
    const startsAtTwo = `# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n2. It MUST work.\n`;
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", startsAtTwo).violations.some((v) => v.rule === "REQ-001.2.3"),
    ).toBe(true);

    // Item numbering is validated per SECOND section too, not just the first: a well-formed
    // section 1 followed by a section 2 whose items skip a number must still be flagged.
    const secondSectionItemGap = `# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n\n### 2: B\n\n1. It MUST work.\n3. It MUST also work.\n`;
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", secondSectionItemGap).violations.some(
        (v) => v.rule === "REQ-001.2.3",
      ),
    ).toBe(true);

    // Duplicate item numbers in a SECOND section too.
    const secondSectionDuplicateItem = `# Codex Session Scrollback\n\n## Overview\n\nX.\n\n## Requirements\n\n### 1: A\n\n1. It MUST work.\n\n### 2: B\n\n1. It MUST work.\n1. It MUST work twice.\n`;
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", secondSectionDuplicateItem).violations.some(
        (v) => v.rule === "REQ-001.2.3",
      ),
    ).toBe(true);
  });

  // 2119: REQ-011.2.6, REQ-011.2.7
  it("derives canonical section and item IDs as <stem>.N and <stem>.N.M, where N is the real section number", () => {
    const spec = parseSpec("specs/codex-session-scrollback.md", "REQ", SCROLLBACK_SPEC);
    expect(spec.sections[0].id).toBe("codex-session-scrollback.1");
    expect(spec.sections[0].items.map((r) => r.id)).toEqual([
      "codex-session-scrollback.1.1",
      "codex-session-scrollback.1.2",
      "codex-session-scrollback.1.3",
    ]);

    // A second section proves N reflects the actual section number, not a hard-coded 1.
    const twoSections =
      SCROLLBACK_SPEC + "\n### 2: Cleanup\n\n1. The pane MUST clear scrollback buffers on exit.\n";
    const multi = parseSpec("specs/codex-session-scrollback.md", "REQ", twoSections);
    expect(multi.sections[1].id).toBe("codex-session-scrollback.2");
    expect(multi.sections[1].items.map((r) => r.id)).toEqual(["codex-session-scrollback.2.1"]);
  });

  // 2119: REQ-011.2.8
  it("applies coverage tags, the exactly-one-keyword rule, and the REQUIREMENT REMOVED tombstone identically to file-scoped requirements", () => {
    const tagged =
      SCROLLBACK_SPEC +
      "4. Docs MUST stay accurate. [review: docs/**]\n" +
      "5. Policy MUST be sensible. [review]\n" +
      "6. Support MUST answer. [manual]\n" +
      '7. The build MUST succeed. [verify: node -e "process.exit(0)"]\n';
    const spec = parseSpec("specs/codex-session-scrollback.md", "REQ", tagged);
    expect(spec.violations).toEqual([]);
    expect(spec.sections[0].items[3].coverage.kind).toBe("review");
    expect(spec.sections[0].items[3].coverage.globs).toEqual(["docs/**"]);
    expect(spec.sections[0].items[4].coverage.kind).toBe("review");
    expect(spec.sections[0].items[4].coverage.globs).toBeUndefined();
    expect(spec.sections[0].items[5].coverage.kind).toBe("manual");
    expect(spec.sections[0].items[6].coverage.kind).toBe("verify");
    expect(spec.sections[0].items[6].coverage.command).toContain("process.exit(0)");

    // Exactly one keyword: reject both zero and two.
    const zeroKeywords = SCROLLBACK_SPEC.replace("1. The pane MUST retain the last 10000 lines.", "1. The pane retains the last 10000 lines.");
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", zeroKeywords).violations.some((v) => v.rule === "REQ-001.2.2"),
    ).toBe(true);

    const twoKeywords = SCROLLBACK_SPEC.replace(
      "1. The pane MUST retain the last 10000 lines.",
      "1. The pane MUST retain and SHOULD compress the last 10000 lines.",
    );
    expect(
      parseSpec("specs/codex-session-scrollback.md", "REQ", twoKeywords).violations.some((v) => v.rule === "REQ-001.2.2"),
    ).toBe(true);

    const removed = SCROLLBACK_SPEC.replace("2. The pane SHOULD highlight error lines.", "2. REQUIREMENT REMOVED");
    const rspec = parseSpec("specs/codex-session-scrollback.md", "REQ", removed);
    expect(rspec.sections[0].items[1].removed).toBe(true);

    // The tombstone boundary is exact text: near-miss text is an ordinary (keyword-less) statement,
    // not treated as removed.
    const notQuiteTombstone = SCROLLBACK_SPEC.replace(
      "2. The pane SHOULD highlight error lines.",
      "2. REQUIREMENT REMOVED for now",
    );
    const nspec = parseSpec("specs/codex-session-scrollback.md", "REQ", notQuiteTombstone);
    expect(nspec.sections[0].items[1].removed).toBe(false);
    expect(nspec.violations.some((v) => v.rule === "REQ-001.2.2")).toBe(true);

    // Parity: the SAME mechanisms, applied to an equivalent LEGACY spec, produce the identical
    // outcome shape — proving file-scoped requirements aren't treated specially, either way.
    const legacyTagged =
      LEGACY_SPEC +
      "2. Docs MUST stay accurate. [review: docs/**]\n" +
      "3. Policy MUST be sensible. [review]\n" +
      "4. Support MUST answer. [manual]\n" +
      '5. The build MUST succeed. [verify: node -e "process.exit(0)"]\n';
    const legacySpec = parseSpec("specs/REQ-900-widgets.md", "REQ", legacyTagged);
    expect(legacySpec.violations).toEqual([]);
    expect(legacySpec.sections[0].items[1].coverage.kind).toBe("review");
    expect(legacySpec.sections[0].items[1].coverage.globs).toEqual(["docs/**"]);
    expect(legacySpec.sections[0].items[2].coverage.kind).toBe("review");
    expect(legacySpec.sections[0].items[2].coverage.globs).toBeUndefined();
    expect(legacySpec.sections[0].items[3].coverage.kind).toBe("manual");
    expect(legacySpec.sections[0].items[4].coverage.kind).toBe("verify");

    const legacyZeroKeywords = LEGACY_SPEC.replace("1. The widget MUST spin.", "1. The widget spins.");
    expect(
      parseSpec("specs/REQ-900-widgets.md", "REQ", legacyZeroKeywords).violations.some((v) => v.rule === "REQ-001.2.2"),
    ).toBe(true);

    const legacyTwoKeywords = LEGACY_SPEC.replace(
      "1. The widget MUST spin.",
      "1. The widget MUST spin and SHOULD glow.",
    );
    expect(
      parseSpec("specs/REQ-900-widgets.md", "REQ", legacyTwoKeywords).violations.some((v) => v.rule === "REQ-001.2.2"),
    ).toBe(true);

    const legacyRemoved = LEGACY_SPEC.replace("1. The widget MUST spin.", "1. REQUIREMENT REMOVED");
    expect(parseSpec("specs/REQ-900-widgets.md", "REQ", legacyRemoved).sections[0].items[0].removed).toBe(true);
    const legacyNotQuiteTombstone = LEGACY_SPEC.replace("1. The widget MUST spin.", "1. REQUIREMENT REMOVED for now");
    const legacyN = parseSpec("specs/REQ-900-widgets.md", "REQ", legacyNotQuiteTombstone);
    expect(legacyN.sections[0].items[0].removed).toBe(false);
    expect(legacyN.violations.some((v) => v.rule === "REQ-001.2.2")).toBe(true);
  });
});

describe("discovery and namespace-collision protection (REQ-011.3)", () => {
  // 2119: REQ-011.3.1
  it("discovers file-scoped specs under the default `specs` glob with no .2119.yml", () => {
    const root = fsFixture();
    const ctx = buildContext(root);
    expect(ctx.notInitialized).toBe(false);
    expect(ctx.specs.map((s) => s.docId).sort()).toEqual(["codex-session-scrollback", "other-spec"]);
  });

  // 2119: REQ-011.3.2
  it("flags two file-scoped specs sharing a basename in different directories, but not two with different basenames", () => {
    const root = fsFixture();
    mkdirSync(join(root, "specs/sub"), { recursive: true });
    writeFileSync(join(root, "specs/sub/other-spec.md"), OTHER_SPEC.replace("# Other Feature", "# Other Feature Again"));
    const collision = buildContext(root);
    expect(collision.lintViolations.some((v) => v.rule === "REQ-001.1.7" && v.message.includes("other-spec"))).toBe(true);

    // Control: a nested spec with a DIFFERENT basename is not a collision.
    const clean = fsFixture();
    mkdirSync(join(clean, "specs/sub"), { recursive: true });
    writeFileSync(
      join(clean, "specs/sub/unrelated-spec.md"),
      OTHER_SPEC.replace("# Other Feature", "# Unrelated Feature"),
    );
    const cleanCtx = buildContext(clean);
    expect(cleanCtx.lintViolations.some((v) => v.rule === "REQ-001.1.7")).toBe(false);
  });
});

describe("annotation import and bare-number sugar (REQ-011.4)", () => {
  // 2119: REQ-011.4.1
  it("recognizes a 2119-spec marker on any recognized comment leader — default or configured — but not on a non-comment line", () => {
    // Each case gets its OWN fresh root with only that one test file present, so passing
    // depends on that specific leader's marker being recognized — not on section-level
    // coverage already established by an earlier case in a shared root.
    const defaultRoot = fsFixture();
    writeFileSync(
      join(defaultRoot, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest('a', () => {})\n",
    );
    expect(buildContext(defaultRoot).coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);

    const pyRoot = fsFixture();
    writeFileSync(join(pyRoot, "tests/scrollback2.py"), "# 2119-spec: codex-session-scrollback\n# 2119: 1.2\n");
    expect(buildContext(pyRoot).coverage.covered.has("codex-session-scrollback.1.2")).toBe(true);

    const sqlRoot = fsFixture();
    writeFileSync(join(sqlRoot, "tests/scrollback3.sql"), "-- 2119-spec: codex-session-scrollback\n-- 2119: 1.3\n");
    expect(buildContext(sqlRoot).coverage.covered.has("codex-session-scrollback.1.3")).toBe(true);

    const erlRoot = fsFixture();
    writeFileSync(join(erlRoot, "tests/scrollback4.erl"), "% 2119-spec: codex-session-scrollback\n% 2119: 1\n");
    expect(buildContext(erlRoot).coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);

    // A configured, non-default comment leader is recognized the same way.
    const configuredRoot = fsFixture();
    writeFileSync(join(configuredRoot, ".2119.yml"), "comment_leaders: ['§']\n");
    writeFileSync(join(configuredRoot, "tests/scrollback5.txt"), "§ 2119-spec: codex-session-scrollback\n§ 2119: 1.2\n");
    expect(buildContext(configuredRoot).coverage.covered.has("codex-session-scrollback.1.2")).toBe(true);

    // Not a comment leader: this line must not be treated as an import, and with no marker in
    // scope the bare annotation on the next line must fail to resolve rather than silently
    // covering anything.
    const noImportRoot = fsFixture();
    writeFileSync(
      join(noImportRoot, "tests/scrollback6.test.ts"),
      "2119-spec: codex-session-scrollback\n// 2119: 1.3\n",
    );
    const noImportCtx = buildContext(noImportRoot);
    const inFile6 = [...noImportCtx.lintViolations, ...noImportCtx.coverViolations].filter(
      (v) => v.file === "tests/scrollback6.test.ts",
    );
    expect(inFile6.some((v) => /import|2119-spec/i.test(v.message))).toBe(true);
    expect(noImportCtx.coverage.covered.has("codex-session-scrollback.1.3")).toBe(false);

    // A marker's scope is that SAME file only — it must not leak to bare annotations in a
    // sibling file that declares no marker of its own.
    const crossFileRoot = fsFixture();
    writeFileSync(
      join(crossFileRoot, "tests/withMarker.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest('a', () => {})\n",
    );
    writeFileSync(join(crossFileRoot, "tests/withoutMarker.test.ts"), "// 2119: 1.2\ntest('b', () => {})\n");
    const crossFileCtx = buildContext(crossFileRoot);
    expect(crossFileCtx.coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);
    expect(crossFileCtx.coverage.covered.has("codex-session-scrollback.1.2")).toBe(false);
    expect(
      crossFileCtx.lintViolations.some(
        (v) => v.file === "tests/withoutMarker.test.ts" && v.rule === "REQ-011.4.4",
      ),
    ).toBe(true);
  });

  // 2119: REQ-011.4.2
  it("rejects, as a LINT violation specifically, a 2119-spec marker naming a spec that does not exist", () => {
    const root = fsFixture();
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: does-not-exist\n// 2119: 1\ntest('retains', () => {})\n",
    );
    const ctx = buildContext(root);
    expect(ctx.lintViolations.some((v) => v.message.includes("does-not-exist"))).toBe(true);

    // Two markers on one file, both unknown: EACH gets its own REQ-011.4.2 violation, not just
    // the REQ-011.4.3 "multiple markers" violation swallowing both.
    writeFileSync(
      join(root, "tests/two-unknown.test.ts"),
      "// 2119-spec: does-not-exist-1\n// 2119-spec: does-not-exist-2\n// 2119: 1\ntest('x', () => {})\n",
    );
    const twoUnknown = buildContext(root).lintViolations.filter((v) => v.file === "tests/two-unknown.test.ts");
    expect(twoUnknown.some((v) => v.rule === "REQ-011.4.2" && v.message.includes("does-not-exist-1"))).toBe(true);
    expect(twoUnknown.some((v) => v.rule === "REQ-011.4.2" && v.message.includes("does-not-exist-2"))).toBe(true);

    // A marker naming a DISCOVERED spec is still rejected if that spec is legacy-grammar, not
    // file-scoped: "exists" means "exists as a file-scoped namespace", not "exists at all".
    writeFileSync(join(root, "specs/REQ-900-widgets.md"), LEGACY_SPEC);
    writeFileSync(
      join(root, "tests/legacy-marker.test.ts"),
      "// 2119-spec: REQ-900\n// 2119: 1\ntest('y', () => {})\n",
    );
    const legacyMarkerCtx = buildContext(root);
    const inLegacyMarkerFile = legacyMarkerCtx.lintViolations.filter((v) => v.file === "tests/legacy-marker.test.ts");
    expect(inLegacyMarkerFile.some((v) => v.rule === "REQ-011.4.2" && v.message.includes("REQ-900"))).toBe(true);
    expect(legacyMarkerCtx.coverage.covered.has("REQ-900.1.1")).toBe(false);
  });

  // 2119: REQ-011.4.3
  it("rejects, as a LINT violation specifically, a test file declaring more than one 2119-spec marker, whether the stems differ or match", () => {
    const root = fsFixture();
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119-spec: other-spec\n// 2119: 1\ntest('x', () => {})\n",
    );
    const differentStems = buildContext(root).lintViolations;
    expect(
      differentStems.some(
        (v) => v.file === "tests/scrollback.test.ts" && /2119-spec/.test(v.message) && /one|multiple|single/i.test(v.message),
      ),
    ).toBe(true);

    // Two markers on the SAME physical line must also count as two, not one.
    writeFileSync(
      join(root, "tests/same-line.test.ts"),
      "// 2119-spec: codex-session-scrollback 2119-spec: other-spec\n// 2119: 1\ntest('x', () => {})\n",
    );
    const sameLine = buildContext(root).lintViolations.filter((v) => v.file === "tests/same-line.test.ts");
    expect(sameLine.some((v) => v.rule === "REQ-011.4.3")).toBe(true);

    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119-spec: codex-session-scrollback\n// 2119: 1\ntest('x', () => {})\n",
    );
    const sameStem = buildContext(root).lintViolations;
    expect(
      sameStem.some(
        (v) => v.file === "tests/scrollback.test.ts" && /2119-spec/.test(v.message) && /one|multiple|single/i.test(v.message),
      ),
    ).toBe(true);
  });

  // 2119: REQ-011.4.4
  it("rejects, as a LINT violation specifically, a bare-number annotation with no 2119-spec import earlier in the same file", () => {
    const root = fsFixture();

    // No marker at all; a dotted bare ID is bare too.
    writeFileSync(join(root, "tests/scrollback.test.ts"), "// 2119: 1.1\ntest('retains', () => {})\n");
    const noMarker = buildContext(root);
    expect(noMarker.lintViolations.some((v) => v.file === "tests/scrollback.test.ts" && /import|2119-spec/i.test(v.message))).toBe(
      true,
    );
    expect(noMarker.coverage.covered.has("codex-session-scrollback.1.1")).toBe(false);

    // A comma-separated bare-ID list with no marker: every bare ID in it is flagged, not just the first.
    writeFileSync(join(root, "tests/scrollback.test.ts"), "// 2119: 1, 3\ntest('retains', () => {})\n");
    const commaSeparated = buildContext(root);
    expect(
      commaSeparated.lintViolations.some((v) => v.file === "tests/scrollback.test.ts" && /import|2119-spec/i.test(v.message)),
    ).toBe(true);
    expect(commaSeparated.coverage.covered.has("codex-session-scrollback.1.1")).toBe(false);
    expect(commaSeparated.coverage.covered.has("codex-session-scrollback.1.3")).toBe(false);

    // A marker present LATER in the file does not retroactively cover an earlier bare annotation.
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119: 1.2\ntest('a', () => {})\n// 2119-spec: codex-session-scrollback\n// 2119: 1.2\ntest('b', () => {})\n",
    );
    const lateMarker = buildContext(root);
    expect(
      lateMarker.lintViolations.some((v) => v.file === "tests/scrollback.test.ts" && /import|2119-spec/i.test(v.message)),
    ).toBe(true);
    // The later, in-scope bare annotation still resolves fine.
    expect(lateMarker.coverage.covered.has("codex-session-scrollback.1.2")).toBe(true);

    // A token immediately followed by more ID-charset characters is not "digits and `.` only" —
    // it must not be silently truncated into a valid-looking bare ID that then resolves to
    // coverage the author never actually wrote. With a marker in scope, none of these malformed
    // near misses may cover their nearest-looking valid target.
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1x\n// 2119: 1.2.\n// 2119: 1.3junk\ntest('x', () => {})\n",
    );
    const malformedBoundary = buildContext(root);
    expect(malformedBoundary.coverage.covered.has("codex-session-scrollback.1.1")).toBe(false);
    expect(malformedBoundary.coverage.covered.has("codex-session-scrollback.1.2")).toBe(false);
    expect(malformedBoundary.coverage.covered.has("codex-session-scrollback.1.3")).toBe(false);
  });

  // 2119: REQ-011.4.5
  it("treats a bare annotation the same as the full canonical ID it resolves to, for coverage, the review target, and check", () => {
    const bareRoot = fsFixture();
    writeFileSync(
      join(bareRoot, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest('a', () => {})\n",
    );
    const bareCtx = buildContext(bareRoot);
    expect(bareCtx.coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);
    const bareTarget = bareCtx.reviewTargets.find((t) => t.requirement.id === "codex-session-scrollback.1.1");
    expect(bareTarget).toBeTruthy();
    const bareCheck = JSON.parse(run(bareRoot, ["check", "--json"]).stdout);
    expect(bareCheck.uncoveredRequirements).not.toContain("codex-session-scrollback.1.1");

    const fullRoot = fsFixture();
    writeFileSync(
      join(fullRoot, "tests/scrollback.test.ts"),
      "// 2119: codex-session-scrollback.1.1\ntest('a', () => {})\n",
    );
    const fullCtx = buildContext(fullRoot);
    expect(fullCtx.coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);
    const fullTarget = fullCtx.reviewTargets.find((t) => t.requirement.id === "codex-session-scrollback.1.1");
    expect(fullTarget).toBeTruthy();
    const fullCheck = JSON.parse(run(fullRoot, ["check", "--json"]).stdout);
    expect(fullCheck.uncoveredRequirements).not.toContain("codex-session-scrollback.1.1");

    expect(bareTarget!.reviewId).toBe(fullTarget!.reviewId);
  });

  // 2119: REQ-011.4.6
  it("resolves full canonical IDs — legacy or file-scoped, foreign or local — the same with or without an import in scope, and bare never reaches a foreign spec", () => {
    const root = fsFixture();
    writeFileSync(join(root, "specs/REQ-900-widgets.md"), LEGACY_SPEC);

    // Under an import for a DIFFERENT spec, full item-level IDs for other specs (file-scoped and
    // legacy) still resolve.
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1\n// 2119: other-spec.1.1\n// 2119: REQ-900.1.1\ntest('x', () => {})\n",
    );
    const withImport = buildContext(root);
    // fsFixture() pre-covers other-spec.1.1 via its own baseline file, so a bare `.has()` check
    // wouldn't prove THIS file's foreign full ID actually resolved — require the covering list to
    // specifically include tests/scrollback.test.ts.
    const coveringOtherFromImport = withImport.coverage.covered.get("other-spec.1.1") ?? [];
    expect(coveringOtherFromImport.some((a) => a.file === "tests/scrollback.test.ts")).toBe(true);
    expect(withImport.coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);
    expect(withImport.coverage.covered.has("REQ-900.1.1")).toBe(true);

    // A full canonical ID for the file's OWN marker's spec must resolve exactly, not get
    // double-prefixed (e.g. "codex-session-scrollback.codex-session-scrollback.1.3") or rejected.
    writeFileSync(
      join(root, "tests/own-marker-full.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: codex-session-scrollback.1.3\ntest('own', () => {})\n",
    );
    const ownMarkerFull = buildContext(root);
    expect(ownMarkerFull.coverage.covered.has("codex-session-scrollback.1.3")).toBe(true);
    expect(
      ownMarkerFull.lintViolations.some((v) => v.file === "tests/own-marker-full.test.ts"),
    ).toBe(false);

    // With NO marker at all, full IDs resolve identically (bare would not, per REQ-011.4.4).
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: other-spec.1.1\n// 2119: REQ-900.1.1\ntest('y', () => {})\n",
    );
    const noImport = buildContext(root);
    const coveringOtherFromNoImport = noImport.coverage.covered.get("other-spec.1.1") ?? [];
    expect(coveringOtherFromNoImport.some((a) => a.file === "tests/widget.test.js")).toBe(true);
    expect(noImport.coverage.covered.has("REQ-900.1.1")).toBe(true);
    // Bare, by contrast, is never resolved without a marker (REQ-011.4.4's rule holds here too,
    // in this test's own fixture — not just in a different test elsewhere).
    writeFileSync(join(root, "tests/no-marker-bare.test.ts"), "// 2119: 1\ntest('bare', () => {})\n");
    const noMarkerBare = buildContext(root);
    expect(
      noMarkerBare.lintViolations.some((v) => v.file === "tests/no-marker-bare.test.ts" && /import|2119-spec/i.test(v.message)),
    ).toBe(true);
    const coveringFromBareFile = noMarkerBare.coverage.covered.get("codex-session-scrollback.1.1") ?? [];
    expect(coveringFromBareFile.some((a) => a.file === "tests/no-marker-bare.test.ts")).toBe(false);

    // Exclusivity: a bare number under the scrollback marker resolves ONLY within that spec, even
    // though other-spec also happens to define an item "1.1" — bare is never a foreign reference.
    writeFileSync(
      join(root, "tests/exclusive.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1\ntest('z', () => {})\n",
    );
    const exclusive = buildContext(root);
    const coveringOther = exclusive.coverage.covered.get("other-spec.1.1") ?? [];
    expect(coveringOther.some((a) => a.file === "tests/exclusive.test.ts")).toBe(false);

    // A full canonical ID immediately followed by more ID-charset characters must not be
    // truncated into a valid-looking prefix of itself, the same boundary requirement as bare IDs.
    writeFileSync(
      join(root, "tests/full-boundary.test.ts"),
      "// 2119: codex-session-scrollback.1.1junk\n// 2119: REQ-900.1.1x\ntest('w', () => {})\n",
    );
    const fullBoundary = buildContext(root);
    const coveringScrollbackFromBoundary = fullBoundary.coverage.covered.get("codex-session-scrollback.1.1") ?? [];
    expect(coveringScrollbackFromBoundary.some((a) => a.file === "tests/full-boundary.test.ts")).toBe(false);
    const coveringWidgetFromBoundary = fullBoundary.coverage.covered.get("REQ-900.1.1") ?? [];
    expect(coveringWidgetFromBoundary.some((a) => a.file === "tests/full-boundary.test.ts")).toBe(false);
  });
});

describe("grammar coexistence (REQ-011.5)", () => {
  function coexistFixture(): string {
    const root = fsFixture();
    // fsFixture() also creates other-spec.md (plus its baseline annotation), unrelated to
    // grammar-coexistence itself; drop both so these tests aren't tripped up by a spec these
    // fixtures don't otherwise reference.
    unlinkSync(join(root, "specs/other-spec.md"));
    unlinkSync(join(root, "tests/other-spec-baseline.test.ts"));
    writeFileSync(join(root, "specs/REQ-900-widgets.md"), LEGACY_SPEC + "2. The widget MUST NOT jam.\n");
    writeFileSync(
      join(root, "tests/widget.test.js"),
      "// 2119: REQ-900.1.1\ntest('spin', () => {})\n// 2119: REQ-900.1.2\ntest('no jam', () => {})\n",
    );
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest('retains', () => {})\n// 2119: 1.3\ntest('clears', () => {})\n",
    );
    return root;
  }

  // 2119: REQ-011.5.1
  it("`2119 lint` and `2119 cover` discover and validate both grammars together, neither silently skipping malformed specs of the other", () => {
    const root = coexistFixture();
    expect(run(root, ["lint"]).status).toBe(0);
    expect(run(root, ["cover"]).status).toBe(0);
    // Positive proof of discovery, not just an absence of violations (which a parser that silently
    // skipped BOTH grammars would also produce): coverage.covered must actually contain an entry
    // from each grammar.
    const clean = buildContext(root);
    expect(clean.coverage.covered.has("REQ-900.1.1")).toBe(true);
    expect(clean.coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);

    // A malformed spec of EACH grammar must still surface — neither is silently skipped for the other.
    writeFileSync(join(root, "specs/REQ-900-widgets.md"), LEGACY_SPEC.replace("# REQ-900: Widgets", "# REQ-999: Widgets"));
    writeFileSync(
      join(root, "specs/codex-session-scrollback.md"),
      SCROLLBACK_SPEC.replace("### 1: Retention", "### codex-session-scrollback.1: Retention"),
    );
    expect(run(root, ["lint"]).status).toBe(1);
    const broken = buildContext(root);
    expect(broken.lintViolations.some((v) => v.file.endsWith("REQ-900-widgets.md"))).toBe(true);
    expect(broken.lintViolations.some((v) => v.file.endsWith("codex-session-scrollback.md"))).toBe(true);

    // A COVER-specific defect (a dropped annotation, not a lint defect) in each grammar must also
    // surface from `2119 cover` — proving cover itself validates both, not merely riding on lint.
    const uncoveredRoot = coexistFixture();
    writeFileSync(join(uncoveredRoot, "tests/widget.test.js"), "test('spin', () => {})\n// 2119: REQ-900.1.2\ntest('no jam', () => {})\n");
    writeFileSync(
      join(uncoveredRoot, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\ntest('retains', () => {})\n// 2119: 1.3\ntest('clears', () => {})\n",
    );
    expect(run(uncoveredRoot, ["cover"]).status).toBe(1);
    const uncoveredCtx = buildContext(uncoveredRoot);
    expect(uncoveredCtx.coverage.uncovered.map((r) => r.id)).toContain("REQ-900.1.1");
    expect(uncoveredCtx.coverage.uncovered.map((r) => r.id)).toContain("codex-session-scrollback.1.1");
  });

  // 2119: REQ-011.5.2
  it("review generates an instruction FILE for every pending target from either grammar, not just the first", () => {
    const root = coexistFixture();
    const review = run(root, ["review"]);
    expect(review.stdout).toContain("REQ-900.1.1");
    expect(review.stdout).toContain("codex-session-scrollback.1.1");

    const ctx = buildContext(root);
    // Every enforced requirement from both fixtures — two per grammar — must get its own instruction file.
    for (const id of ["REQ-900.1.1", "REQ-900.1.2", "codex-session-scrollback.1.1", "codex-session-scrollback.1.3"]) {
      const target = ctx.reviewTargets.find((t) => t.requirement.id === id)!;
      expect(target, `missing review target for ${id}`).toBeTruthy();
      expect(existsSync(join(root, `.2119/reviews/${target.reviewId}.md`)), `missing instruction file for ${id}`).toBe(
        true,
      );
    }
  });

  // 2119: REQ-011.5.3, REQ-011.5.4
  it("pass, fail, and check report the same violation kind — stale, failing, or uncovered — for either grammar", () => {
    const root = coexistFixture();

    // Stale: no verdict recorded yet for either grammar.
    const stale = JSON.parse(run(root, ["check", "--json"]).stdout);
    expect(stale.violations.some((v: { rule: string; message: string }) => v.rule === "REQ-003.3.1" && v.message.includes("REQ-900.1.1"))).toBe(true);
    expect(
      stale.violations.some(
        (v: { rule: string; message: string }) => v.rule === "REQ-003.3.1" && v.message.includes("codex-session-scrollback.1.1"),
      ),
    ).toBe(true);

    // Uncovered: drop one annotation from each grammar.
    writeFileSync(join(root, "tests/widget.test.js"), "test('spin', () => {})\n// 2119: REQ-900.1.2\ntest('no jam', () => {})\n");
    writeFileSync(join(root, "tests/scrollback.test.ts"), "// 2119-spec: codex-session-scrollback\ntest('retains', () => {})\n// 2119: 1.3\ntest('clears', () => {})\n");
    const uncovered = JSON.parse(run(root, ["check", "--json"]).stdout);
    expect(uncovered.uncoveredRequirements).toContain("REQ-900.1.1");
    expect(uncovered.uncoveredRequirements).toContain("codex-session-scrollback.1.1");

    // Failing: restore coverage, record fail verdicts for both.
    const root2 = coexistFixture();
    const review = run(root2, ["review"]);
    const legacyId1 = review.stdout.match(/REQ-900\.1\.1--[0-9a-f]{12}/)?.[0]!;
    const legacyId2 = review.stdout.match(/REQ-900\.1\.2--[0-9a-f]{12}/)?.[0]!;
    const fsId1 = review.stdout.match(/codex-session-scrollback\.1\.1--[0-9a-f]{12}/)?.[0]!;
    const fsId3 = review.stdout.match(/codex-session-scrollback\.1\.3--[0-9a-f]{12}/)?.[0]!;
    expect([legacyId1, legacyId2, fsId1, fsId3].every(Boolean)).toBe(true);

    expect(run(root2, ["fail", legacyId2, "--summary", "not genuine"]).status).toBe(0);
    expect(run(root2, ["fail", fsId3, "--summary", "not genuine"]).status).toBe(0);
    const afterFail = JSON.parse(run(root2, ["check", "--json"]).stdout);
    const failing2119 = afterFail.violations.filter((v: { rule: string }) => v.rule === "REQ-003.2.4");
    expect(failing2119).toHaveLength(2);
    // Tied to the SPECIFIC ids, not just a count: a misclassification (e.g. both violations
    // pointing at the same grammar) must not be able to pass this check.
    expect(failing2119.some((v: { message: string }) => v.message.includes("REQ-900.1.2"))).toBe(true);
    expect(failing2119.some((v: { message: string }) => v.message.includes("codex-session-scrollback.1.3"))).toBe(
      true,
    );

    // pass supersedes fail identically for either grammar.
    expect(run(root2, ["pass", legacyId1, "--summary", "genuine"]).status).toBe(0);
    expect(run(root2, ["pass", legacyId2, "--summary", "genuine, fixed"]).status).toBe(0);
    expect(run(root2, ["pass", fsId1, "--summary", "genuine"]).status).toBe(0);
    expect(run(root2, ["pass", fsId3, "--summary", "genuine, fixed"]).status).toBe(0);
    expect(run(root2, ["check"]).status).toBe(0);
  });

  // 2119: REQ-011.5.5
  it("prune deletes the actual verdict file on disk for an orphaned verdict of either grammar", () => {
    const root = coexistFixture();
    const legacyOrphan = "REQ-900.1.1--" + "a".repeat(12);
    const fsOrphan = "codex-session-scrollback.1.1--" + "b".repeat(12);
    writeVerdict(root, legacyOrphan, "REQ-900.1.1", "pass", "stale legacy");
    writeVerdict(root, fsOrphan, "codex-session-scrollback.1.1", "pass", "stale fs");
    expect(existsSync(join(root, `.2119/verdicts/${legacyOrphan}.json`))).toBe(true);
    expect(existsSync(join(root, `.2119/verdicts/${fsOrphan}.json`))).toBe(true);

    const prune = run(root, ["prune"]);
    expect(prune.status).toBe(0);
    expect(existsSync(join(root, `.2119/verdicts/${legacyOrphan}.json`))).toBe(false);
    expect(existsSync(join(root, `.2119/verdicts/${fsOrphan}.json`))).toBe(false);
  });

  // 2119: REQ-011.5.6
  it("the configured prefix governs legacy filename, heading, AND full-ID-annotation matching, leaving file-scoped grammar unaffected", () => {
    const root = fsFixture();
    writeFileSync(join(root, ".2119.yml"), 'prefix: "ACME-REQ"\n');
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1\ntest('retains', () => {})\n",
    );
    const ctx = buildContext(root);
    expect(ctx.specs.some((s) => s.docId === "codex-session-scrollback")).toBe(true);
    expect(ctx.coverage.covered.has("codex-session-scrollback.1.1")).toBe(true);

    // A full file-scoped canonical annotation (not just bare sugar) is also unaffected by the prefix.
    writeFileSync(join(root, "tests/scrollback-full.test.ts"), "// 2119: codex-session-scrollback.1.3\ntest('c', () => {})\n");
    expect(buildContext(root).coverage.covered.has("codex-session-scrollback.1.3")).toBe(true);

    // A stray "REQ-900-widgets.md" is legacy only under prefix "REQ"; under "ACME-REQ" it does not
    // match the legacy filename pattern at all, so it is parsed file-scoped instead.
    writeFileSync(join(root, "specs/REQ-900-widgets.md"), LEGACY_SPEC);
    const withPrefix = buildContext(root);
    const widgets = withPrefix.specs.find((s) => s.path.endsWith("REQ-900-widgets.md"))!;
    expect(widgets.docId).not.toBe("REQ-900");

    // Positive control: under the SAME custom prefix, a correctly-prefixed legacy filename AND
    // heading ARE recognized as legacy, and a full-ID annotation against it resolves.
    const acmeSpec = LEGACY_SPEC.replace(/REQ-900/g, "ACME-REQ-900");
    writeFileSync(join(root, "specs/ACME-REQ-900-widgets.md"), acmeSpec);
    writeFileSync(join(root, "tests/widget.test.js"), "// 2119: ACME-REQ-900.1.1\ntest('spin', () => {})\n");
    const acmeCtx = buildContext(root);
    const acmeWidgets = acmeCtx.specs.find((s) => s.path.endsWith("ACME-REQ-900-widgets.md"))!;
    expect(acmeWidgets.docId).toBe("ACME-REQ-900");
    expect(acmeCtx.coverage.covered.has("ACME-REQ-900.1.1")).toBe(true);
  });
});

function targetsWithFile(
  root: string,
  specs: ReturnType<typeof parseSpec>[],
  anns: Annotation[],
  markerLineByFile: Map<string, number> = new Map(),
) {
  const coverage = computeCoverage(specs, anns, DEFAULT_ENFORCE);
  return computeReviewTargets(loadConfig(root), specs, coverage, [], anns, markerLineByFile);
}

describe("verdict-hash binding to canonical spelling (REQ-011.6)", () => {
  // 2119: REQ-011.6.1
  it("hashes a file-scoped covering annotation from its resolved canonical ID list, not its literal spelling", () => {
    const specs = [parseSpec("specs/codex-session-scrollback.md", "REQ", SCROLLBACK_SPEC)];
    const otherSpecs = [...specs, parseSpec("specs/other-spec.md", "REQ", OTHER_SPEC)];

    const rootFull = tmp("2119-hash-full-");
    mkdirSync(join(rootFull, "tests"));
    writeFileSync(join(rootFull, "tests/s.test.ts"), "x();\n// 2119: codex-session-scrollback.1.1\ntest(() => {});\n");
    const fullTargets = targetsWithFile(rootFull, specs, [
      { file: "tests/s.test.ts", line: 2, ids: ["codex-session-scrollback.1.1"] },
    ]);

    const rootBare = tmp("2119-hash-bare-");
    mkdirSync(join(rootBare, "tests"));
    writeFileSync(join(rootBare, "tests/s.test.ts"), "x();\n// 2119: 1\ntest(() => {});\n");
    const bareTargets = targetsWithFile(rootBare, specs, [
      { file: "tests/s.test.ts", line: 2, ids: ["codex-session-scrollback.1.1"] },
    ]);

    expect(fullTargets[0].reviewId).toBe(bareTargets[0].reviewId);

    // Reordering a multi-ID list that includes a file-scoped ID is also spelling, not substance.
    // Built through the REAL scanner (not hand-supplied `ids`) so the two fixtures' annotations
    // actually differ in source order — hand-crafting both with the same order would hide a
    // broken (or missing) sort in evidenceBlockParts entirely.
    const rootAB = tmp("2119-hash-ab-");
    mkdirSync(join(rootAB, "tests"));
    writeFileSync(join(rootAB, "tests/s.test.ts"), "// 2119: codex-session-scrollback.1.1, other-spec.1.1\ntest(() => {});\n");
    const abScan = scanAnnotations(rootAB, ["tests/s.test.ts"], "REQ");
    expect(abScan.annotations[0].ids).toEqual(["codex-session-scrollback.1.1", "other-spec.1.1"]);
    const abTargets = targetsWithFile(rootAB, otherSpecs, abScan.annotations, abScan.markerLineByFile);

    const rootBA = tmp("2119-hash-ba-");
    mkdirSync(join(rootBA, "tests"));
    writeFileSync(join(rootBA, "tests/s.test.ts"), "// 2119: other-spec.1.1, codex-session-scrollback.1.1\ntest(() => {});\n");
    const baScan = scanAnnotations(rootBA, ["tests/s.test.ts"], "REQ");
    expect(baScan.annotations[0].ids).toEqual(["other-spec.1.1", "codex-session-scrollback.1.1"]);
    const baTargets = targetsWithFile(rootBA, otherSpecs, baScan.annotations, baScan.markerLineByFile);

    const abForScrollback = abTargets.find((t) => t.requirement.id === "codex-session-scrollback.1.1")!;
    const baForScrollback = baTargets.find((t) => t.requirement.id === "codex-session-scrollback.1.1")!;
    expect(abForScrollback.reviewId).toBe(baForScrollback.reviewId);

    // The "at least one file-scoped ID" trigger applies even when the SAME line also carries a
    // legacy ID: reordering a legacy+file-scoped mix must still hash identically. Same real-scanner
    // requirement as above.
    const mixedSpecs = [...otherSpecs, parseSpec("specs/REQ-900-widgets.md", "REQ", LEGACY_SPEC)];
    const rootMixAB = tmp("2119-hash-mixed-ab-");
    mkdirSync(join(rootMixAB, "tests"));
    writeFileSync(join(rootMixAB, "tests/s.test.ts"), "// 2119: REQ-900.1.1, codex-session-scrollback.1.1\ntest(() => {});\n");
    const mixABScan = scanAnnotations(rootMixAB, ["tests/s.test.ts"], "REQ");
    expect(mixABScan.annotations[0].ids).toEqual(["REQ-900.1.1", "codex-session-scrollback.1.1"]);
    const mixAB = targetsWithFile(rootMixAB, mixedSpecs, mixABScan.annotations, mixABScan.markerLineByFile);
    const rootMixBA = tmp("2119-hash-mixed-ba-");
    mkdirSync(join(rootMixBA, "tests"));
    writeFileSync(join(rootMixBA, "tests/s.test.ts"), "// 2119: codex-session-scrollback.1.1, REQ-900.1.1\ntest(() => {});\n");
    const mixBAScan = scanAnnotations(rootMixBA, ["tests/s.test.ts"], "REQ");
    expect(mixBAScan.annotations[0].ids).toEqual(["codex-session-scrollback.1.1", "REQ-900.1.1"]);
    const mixBA = targetsWithFile(rootMixBA, mixedSpecs, mixBAScan.annotations, mixBAScan.markerLineByFile);
    expect(mixAB.find((t) => t.requirement.id === "REQ-900.1.1")!.reviewId).toBe(
      mixBA.find((t) => t.requirement.id === "REQ-900.1.1")!.reviewId,
    );
    expect(mixAB.find((t) => t.requirement.id === "codex-session-scrollback.1.1")!.reviewId).toBe(
      mixBA.find((t) => t.requirement.id === "codex-session-scrollback.1.1")!.reviewId,
    );

    // Switching which spelling mechanism supplies a given ID under the SAME in-scope marker: all-bare,
    // mixed bare+full, and all-full for the same two-ID resolved set must hash identically.
    const mkTargets = (line1: string) => {
      const root = tmp("2119-hash-mix-");
      mkdirSync(join(root, "tests"));
      writeFileSync(join(root, "tests/s.test.ts"), `// 2119-spec: codex-session-scrollback\n${line1}\ntest(() => {});\n`);
      return targetsWithFile(root, specs, [{ file: "tests/s.test.ts", line: 2, ids: ["codex-session-scrollback.1.1", "codex-session-scrollback.1.3"] }]);
    };
    const allBare = mkTargets("// 2119: 1, 3");
    const mixed = mkTargets("// 2119: codex-session-scrollback.1.1, 3");
    const allFull = mkTargets("// 2119: codex-session-scrollback.1.1, codex-session-scrollback.1.3");
    const idOf = (targets: ReturnType<typeof targetsWithFile>, id: string) => targets.find((t) => t.requirement.id === id)!.reviewId;
    expect(idOf(allBare, "codex-session-scrollback.1.1")).toBe(idOf(mixed, "codex-session-scrollback.1.1"));
    expect(idOf(mixed, "codex-session-scrollback.1.1")).toBe(idOf(allFull, "codex-session-scrollback.1.1"));

    // Switching which marker is in scope, while the resolved target stays the same, is also
    // spelling: file A's marker directly supplies the target via bare; file B has a DIFFERENT
    // marker in scope and reaches the same target only via its full form. Both must hash the same.
    const rootMarkerA = tmp("2119-hash-marker-a-");
    mkdirSync(join(rootMarkerA, "tests"));
    writeFileSync(join(rootMarkerA, "tests/s.test.ts"), "// 2119-spec: other-spec\n// 2119: 1\ntest(() => {});\n");
    const markerATargets = targetsWithFile(
      rootMarkerA,
      otherSpecs,
      [{ file: "tests/s.test.ts", line: 2, ids: ["other-spec.1.1"] }],
      new Map([["tests/s.test.ts", 1]]),
    );

    const rootMarkerB = tmp("2119-hash-marker-b-");
    mkdirSync(join(rootMarkerB, "tests"));
    writeFileSync(
      join(rootMarkerB, "tests/s.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: other-spec.1.1\ntest(() => {});\n",
    );
    const markerBTargets = targetsWithFile(
      rootMarkerB,
      otherSpecs,
      [{ file: "tests/s.test.ts", line: 2, ids: ["other-spec.1.1"] }],
      new Map([["tests/s.test.ts", 1]]),
    );

    expect(markerATargets[0].reviewId).toBe(markerBTargets[0].reviewId);

    // Negative control: normalization must be scoped to the file's OWN confirmed marker line, by
    // exact line number — never to any prelude line that merely contains the marker text (e.g.
    // inside an unrelated comment on a shared mock). Changing such a line's real content MUST
    // still move the hash; it is genuine evidence, not spelling.
    const rootMockA = tmp("2119-hash-mock-a-");
    mkdirSync(join(rootMockA, "tests"));
    writeFileSync(
      join(rootMockA, "tests/s.test.ts"),
      "function mockPane() { return { lines: 10000 }; } // note: 2119-spec: unused-marker-text\n// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest(() => {});\n",
    );
    const mockATargets = targetsWithFile(
      rootMockA,
      specs,
      [{ file: "tests/s.test.ts", line: 3, ids: ["codex-session-scrollback.1.1"] }],
      new Map([["tests/s.test.ts", 2]]),
    );

    const rootMockB = tmp("2119-hash-mock-b-");
    mkdirSync(join(rootMockB, "tests"));
    writeFileSync(
      join(rootMockB, "tests/s.test.ts"),
      "function mockPane() { return { lines: 1 }; }     // ALWAYS BROKEN, but keep 2119-spec: unused-marker-text\n// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest(() => {});\n",
    );
    const mockBTargets = targetsWithFile(
      rootMockB,
      specs,
      [{ file: "tests/s.test.ts", line: 3, ids: ["codex-session-scrollback.1.1"] }],
      new Map([["tests/s.test.ts", 2]]),
    );

    expect(mockATargets[0].reviewId).not.toBe(mockBTargets[0].reviewId);

    // A repeated spelling of the SAME resolved ID on one line, via the real scanner, must not
    // change the line's resolved canonical ID SET — and therefore not the hash — even though the
    // literal comma-separated list is longer.
    const rootSingle = tmp("2119-hash-dupspell-single-");
    mkdirSync(join(rootSingle, "tests"));
    writeFileSync(join(rootSingle, "tests/s.test.ts"), "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest(() => {});\n");
    const singleScan = scanAnnotations(rootSingle, ["tests/s.test.ts"], "REQ", [], new Set(["codex-session-scrollback"]));
    expect(singleScan.annotations[0].ids).toEqual(["codex-session-scrollback.1.1"]);
    const singleParts = evidenceBlockParts(
      rootSingle,
      singleScan.annotations,
      singleScan.annotations,
      "REQ",
      singleScan.markerLineByFile,
    );

    const rootDupSpelling = tmp("2119-hash-dupspell-dup-");
    mkdirSync(join(rootDupSpelling, "tests"));
    writeFileSync(
      join(rootDupSpelling, "tests/s.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1, codex-session-scrollback.1.1\ntest(() => {});\n",
    );
    const dupSpellingScan = scanAnnotations(
      rootDupSpelling,
      ["tests/s.test.ts"],
      "REQ",
      [],
      new Set(["codex-session-scrollback"]),
    );
    // Deduplicated: two spellings of the same resolved ID collapse to one entry, not two.
    expect(dupSpellingScan.annotations[0].ids).toEqual(["codex-session-scrollback.1.1"]);
    const dupSpellingParts = evidenceBlockParts(
      rootDupSpelling,
      dupSpellingScan.annotations,
      dupSpellingScan.annotations,
      "REQ",
      dupSpellingScan.markerLineByFile,
    );
    expect(dupSpellingParts).toEqual(singleParts);
  });

  // 2119: REQ-011.6.2
  it("does not normalize a purely-legacy annotation line: its hash matches today's algorithm exactly, byte for byte", () => {
    const specs = [parseSpec("specs/REQ-900-widgets.md", "REQ", LEGACY_SPEC + "2. The widget MUST NOT explode.\n")];

    const rootAB = tmp("2119-legacy-ab-");
    mkdirSync(join(rootAB, "tests"));
    writeFileSync(join(rootAB, "tests/s.test.ts"), "// 2119: REQ-900.1.1, REQ-900.1.2\ntest(() => {});\n");
    const abTargets = targetsWithFile(rootAB, specs, [
      { file: "tests/s.test.ts", line: 1, ids: ["REQ-900.1.1", "REQ-900.1.2"] },
    ]);

    // Golden value computed with the pre-existing (raw-text) hashing algorithm, before this feature
    // existed. If a future implementation still produces this exact hash for pure-legacy content,
    // every verdict recorded before this feature shipped remains valid — not merely "still order
    // sensitive under some new algorithm," but bit-for-bit the same computation.
    expect(abTargets.find((t) => t.requirement.id === "REQ-900.1.1")!.reviewId).toBe("REQ-900.1.1--aa6c379e9961");

    const rootBA = tmp("2119-legacy-ba-");
    mkdirSync(join(rootBA, "tests"));
    writeFileSync(join(rootBA, "tests/s.test.ts"), "// 2119: REQ-900.1.2, REQ-900.1.1\ntest(() => {});\n");
    const baTargets = targetsWithFile(rootBA, specs, [
      { file: "tests/s.test.ts", line: 1, ids: ["REQ-900.1.1", "REQ-900.1.2"] },
    ]);
    const ab = abTargets.find((t) => t.requirement.id === "REQ-900.1.1")!;
    const ba = baTargets.find((t) => t.requirement.id === "REQ-900.1.1")!;
    expect(ab.reviewId).not.toBe(ba.reviewId);

    // Two SEPARATE "2119:" occurrences on one physical line must still hash as ONE evidence block
    // for that line, not two — otherwise the block would be double-counted, moving the hash for no
    // real content reason. Scanned through the real annotation scanner (not manually constructed),
    // since the bug this pins is specifically in how the scanner groups same-line matches.
    const rootDup = tmp("2119-legacy-dup-");
    mkdirSync(join(rootDup, "tests"));
    writeFileSync(join(rootDup, "tests/s.test.ts"), "// 2119: REQ-900.1.1 2119: REQ-900.1.1\ntest(() => {});\n");
    const dupScan = scanAnnotations(rootDup, ["tests/s.test.ts"], "REQ");
    expect(dupScan.annotations).toHaveLength(1); // one Annotation for the line, not two
    const dupParts = evidenceBlockParts(rootDup, dupScan.annotations, dupScan.annotations, "REQ");
    // prelude + exactly one block for the line (not one per "2119:" occurrence on it).
    expect(dupParts).toHaveLength(2);
  });

  // 2119: REQ-011.6.1
  it("end to end: rewriting an annotation's spelling after a passing review leaves `check` green with no pending reviews", () => {
    const root = fsFixture();
    // Scope this fixture to just the scrollback spec — other-spec.md is irrelevant here and would
    // otherwise show up as its own stale review, unrelated to what this test is about.
    unlinkSync(join(root, "specs/other-spec.md"));
    unlinkSync(join(root, "tests/other-spec-baseline.test.ts"));
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest('retains', () => {})\n// 2119: 1.3\ntest('clears', () => {})\n",
    );
    const review = run(root, ["review"]);
    const reviewId = review.stdout.match(/codex-session-scrollback\.1\.1--[0-9a-f]{12}/)?.[0];
    const reviewId3 = review.stdout.match(/codex-session-scrollback\.1\.3--[0-9a-f]{12}/)?.[0];
    expect(reviewId).toBeTruthy();
    expect(reviewId3).toBeTruthy();
    expect(run(root, ["pass", reviewId!, "--summary", "genuine"]).status).toBe(0);
    expect(run(root, ["pass", reviewId3!, "--summary", "genuine"]).status).toBe(0);
    expect(run(root, ["check"]).status).toBe(0);

    // Same resolved ID, different spelling: full canonical form instead of bare+import.
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119: codex-session-scrollback.1.1\ntest('retains', () => {})\n// 2119: codex-session-scrollback.1.3\ntest('clears', () => {})\n",
    );
    const after = run(root, ["check", "--json"]);
    expect(after.status).toBe(0);
    const report = JSON.parse(after.stdout);
    expect(report.staleReviews).toEqual([]);
  });
});

describe("rename invalidation (REQ-011.7)", () => {
  // 2119: REQ-011.7.1
  it("invalidates every enforced requirement's verdict in a file-scoped spec when its file is renamed, exactly like an unreviewed new requirement", () => {
    const root = fsFixture();
    // Scope this fixture to just the scrollback spec — other-spec.md is irrelevant here and would
    // otherwise show up as its own stale review, unrelated to what this test is about.
    unlinkSync(join(root, "specs/other-spec.md"));
    unlinkSync(join(root, "tests/other-spec-baseline.test.ts"));
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: codex-session-scrollback\n// 2119: 1.1\ntest('retains', () => {})\n// 2119: 1.3\ntest('clears', () => {})\n",
    );
    const before = buildContext(root);
    // SCROLLBACK_SPEC has exactly two enforced (MUST) requirements — item 2 is SHOULD and is
    // never reviewed — so these two review targets are the COMPLETE set this rename must invalidate.
    expect(before.reviewTargets.map((t) => t.requirement.id).sort()).toEqual(
      ["codex-session-scrollback.1.1", "codex-session-scrollback.1.3"].sort(),
    );
    const id1 = before.reviewTargets.find((t) => t.requirement.id === "codex-session-scrollback.1.1")!.reviewId;
    const id3 = before.reviewTargets.find((t) => t.requirement.id === "codex-session-scrollback.1.3")!.reviewId;
    writeVerdict(root, id1, "codex-session-scrollback.1.1", "pass", "genuine");
    writeVerdict(root, id3, "codex-session-scrollback.1.3", "pass", "genuine");
    expect(run(root, ["check"]).status).toBe(0);

    renameSync(join(root, "specs/codex-session-scrollback.md"), join(root, "specs/scrollback-v2.md"));
    writeFileSync(
      join(root, "tests/scrollback.test.ts"),
      "// 2119-spec: scrollback-v2\n// 2119: 1.1\ntest('retains', () => {})\n// 2119: 1.3\ntest('clears', () => {})\n",
    );
    const after = buildContext(root);
    // The old namespace is gone entirely — this is a rename, not a duplicate.
    expect(after.specs.some((s) => s.docId === "codex-session-scrollback")).toBe(false);
    // Every enforced requirement under the new stem is unverdicted, same shape as a brand-new,
    // never-reviewed requirement — REQ-003.3.1, not some rename-specific violation code.
    expect(after.reviewTargets.map((t) => t.requirement.id).sort()).toEqual(
      ["scrollback-v2.1.1", "scrollback-v2.1.3"].sort(),
    );
    const staleForRenamed = after.reviewViolations.filter(
      (v) => v.rule === "REQ-003.3.1" && (v.message.includes("scrollback-v2.1.1") || v.message.includes("scrollback-v2.1.3")),
    );
    expect(staleForRenamed).toHaveLength(2);

    // The requirement itself is that `2119 check` — the actual CLI, not just internals — reports
    // this: a build that computes the right internal state but never wires it into the real command
    // must not pass.
    const cliAfter = run(root, ["check", "--json"]);
    expect(cliAfter.status).toBe(1);
    const cliReport = JSON.parse(cliAfter.stdout);
    const cliStaleForRenamed = cliReport.violations.filter(
      (v: { rule: string; message: string }) =>
        v.rule === "REQ-003.3.1" && (v.message.includes("scrollback-v2.1.1") || v.message.includes("scrollback-v2.1.3")),
    );
    expect(cliStaleForRenamed).toHaveLength(2);
  });
});

describe("documentation (REQ-011.8)", () => {
  // 2119: REQ-011.8.1
  it("documents both grammars with a concrete example: legacy REQ-NNN.M.K alongside bare ### N: Title, canonical <stem>.N.M, and the import/bare sugar relationship", () => {
    // A worked example must show the bare heading grammar AND its canonical-ID consequence, with the
    // word "canonical" tying them together — not just the two substrings appearing anywhere in a
    // 180-line document.
    expect(README).toMatch(/### N: Title[\s\S]{0,400}canonical[\s\S]{0,100}<stem>\.N\.M|<stem>\.N\.M[\s\S]{0,100}canonical[\s\S]{0,400}### N: Title/i);
    // The legacy shape must be named for comparison, near the file-scoped one — as the CONFIGURABLE
    // <prefix>-NNN.M.K form, not just the "REQ" default, since REQ-011.5.6 pins that the prefix is
    // what actually governs the legacy grammar.
    expect(README).toContain("<prefix>-NNN.M.K");
    expect(README).toMatch(/<prefix>-NNN\.M\.K[\s\S]{0,600}<stem>\.N\.M|<stem>\.N\.M[\s\S]{0,600}<prefix>-NNN\.M\.K/);
    // The import marker, a bare annotation example, and a word describing the sugar relationship
    // (resolve/sugar/shorthand) must appear together — not just adjacency of the two syntax forms.
    expect(README).toMatch(/2119-spec:[\s\S]{0,600}(?:resolves?|sugar|shorthand)[\s\S]{0,600}\/\/ 2119: \d/i);
  });

  // 2119: REQ-011.8.2
  it("states that renaming a SPEC FILE invalidates its recorded VERDICTS and requires re-review — bounded to one coherent paragraph, not keyword proximity anywhere in the doc", () => {
    // Bound the claim to the SAME PARAGRAPH that mentions renaming — a much tighter scope than a
    // blind character window, which an unrelated sentence elsewhere in a 180-line document could
    // satisfy by accident. Every part of the causal claim (it's a spec FILE being renamed, that
    // VERDICTS are invalidated, and that re-review follows) must co-occur in that one paragraph,
    // with no "not"/"n't" negation between "renam-" and "invalidat-".
    const paragraphs = README.split(/\n{2,}/);
    const renameParagraph = paragraphs.find((p) => /renam(?:e|ing|ed)/i.test(p));
    expect(renameParagraph, "README has no paragraph mentioning renaming a spec file").toBeTruthy();
    const clause = renameParagraph!.slice(renameParagraph!.search(/renam(?:e|ing|ed)/i));
    // Neither half of the consequence may be negated or hedged into optionality — "invalidates NO
    // verdicts", "does not invalidate", "re-review is not required", and "re-review is optional" must
    // all fail this check, in both word orders around each keyword.
    const NEG = "(?:not|n't|no|never|isn't|aren't|doesn't|optional\\w*|unnecessary|need\\s*not)";
    expect(clause).not.toMatch(new RegExp(`\\b${NEG}\\b[\\s\\S]{0,80}invalidat`, "i"));
    expect(clause).not.toMatch(new RegExp(`invalidat\\w*[\\s\\S]{0,20}\\b${NEG}\\b`, "i"));
    expect(clause).not.toMatch(new RegExp(`\\b${NEG}\\b[\\s\\S]{0,80}re-review`, "i"));
    expect(clause).not.toMatch(new RegExp(`re-review[\\s\\S]{0,40}\\b${NEG}\\b`, "i"));
    expect(clause).toMatch(/spec/i);
    expect(clause).toMatch(/file/i);
    expect(clause).toMatch(/verdict/i);
    expect(clause).toMatch(/invalidat/i);
    expect(clause).toMatch(/re-review/i);
  });
});
