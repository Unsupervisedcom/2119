import { describe, expect, it } from "vitest";
import { AGENTS_MD_SECTION, SPEC_TEMPLATE } from "../src/init.js";

describe("requirement granularity guidance", () => {
  // 2119: REQ-010.1.1
  it("AGENTS.md section includes granularity guidance with 3–8 recommendation and implementation-step contrast", () => {
    expect(AGENTS_MD_SECTION).toContain("3–8");
    expect(AGENTS_MD_SECTION).toContain("workflow-level");
    // The rationale must name implementation-step requirements as what to avoid.
    expect(AGENTS_MD_SECTION).toContain("implementation-step");
  });

  // 2119: REQ-010.1.2
  it("AGENTS.md section includes all required spec sizing smells", () => {
    expect(AGENTS_MD_SECTION).toContain("sizing smells");
    expect(AGENTS_MD_SECTION).toContain("~10");
    expect(AGENTS_MD_SECTION).toContain("internal steps");
    // The third smell: requirements that say "MUST cover" or "MUST test".
    expect(AGENTS_MD_SECTION).toContain('"MUST cover"');
    expect(AGENTS_MD_SECTION).toContain('"MUST test"');
  });

  // 2119: REQ-010.2.1
  it("spec template includes core workflows section with MUST requirement and manual acceptance criteria", () => {
    // The "Core workflows" section heading must be present.
    expect(SPEC_TEMPLATE).toContain("Core workflows");
    // The section must contain at least one MUST requirement (not just the heading).
    const coreIdx = SPEC_TEMPLATE.indexOf("Core workflows");
    const nextSectionIdx = SPEC_TEMPLATE.indexOf("###", coreIdx + 1);
    const coreSection = SPEC_TEMPLATE.slice(coreIdx, nextSectionIdx > -1 ? nextSectionIdx : undefined);
    expect(coreSection).toContain("MUST");
    // Manual acceptance criteria section must also be present.
    expect(SPEC_TEMPLATE).toContain("Manual acceptance criteria");
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
