import { describe, expect, it } from "vitest";
import { AGENTS_MD_SECTION, SPEC_TEMPLATE } from "../src/init.js";

describe("requirement granularity guidance", () => {
  // 2119: REQ-010.1.1
  it("AGENTS.md section includes granularity guidance with 3–8 recommendation", () => {
    expect(AGENTS_MD_SECTION).toContain("3–8");
    expect(AGENTS_MD_SECTION).toContain("workflow-level");
  });

  // 2119: REQ-010.1.2
  it("AGENTS.md section includes spec sizing smells", () => {
    expect(AGENTS_MD_SECTION).toContain("sizing smells");
    expect(AGENTS_MD_SECTION).toContain("~10");
    expect(AGENTS_MD_SECTION).toContain("internal steps");
  });

  // 2119: REQ-010.2.1
  it("spec template includes core workflows and manual acceptance criteria sections", () => {
    expect(SPEC_TEMPLATE).toContain("Core workflows");
    expect(SPEC_TEMPLATE).toContain("Safety and compatibility invariants");
    expect(SPEC_TEMPLATE).toContain("[manual]");
  });

  // 2119: REQ-010.2.2
  it("spec template includes a notes and non-goals section outside Requirements", () => {
    expect(SPEC_TEMPLATE).toContain("## Notes and non-goals");
    // The notes section must come after the ## Requirements block.
    const reqIdx = SPEC_TEMPLATE.indexOf("## Requirements");
    const notesIdx = SPEC_TEMPLATE.indexOf("## Notes and non-goals");
    expect(reqIdx).toBeGreaterThan(-1);
    expect(notesIdx).toBeGreaterThan(reqIdx);
  });
});
