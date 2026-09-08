import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "../src/check.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");
const REPO = resolve(import.meta.dirname, "..");
const EXPECTED_PROVENANCE = `1. Name the concrete production failure this test would catch.
   Cite file:line evidence that production can reach that failure without the test, fixtures, or prompts supplying the trigger or decisive observation.
2. Trace each applicable production boundary with file:line evidence.
   A producer/consumer boundary means consuming a value emitted by a separately invoked production component or production data source.
   If that boundary exists, cite file:line evidence that the test obtains its input from that producer.
   If that boundary exists, cite file:line evidence that the exercised value preserves the producer's production shape.
   If the decisive observation can equal an initial/default/placeholder/sentinel value, cite file:line evidence that the test distinguishes a newly produced observation from that pre-existing value.
   A gate/runtime-environment boundary means invoking a binary or service outside the gate's own process.
   If that boundary exists, cite file:line evidence for both its production provisioning declaration and the production path that fails when it is absent.

Record FAIL when applicable provenance evidence is absent or shows that production cannot produce the failure independently of the test setup.`;
const EXPECTED_DIRECT_QUESTION = `**Is this requirement genuinely satisfied by the current state of the evidence files?**

Read the requirement and the evidence files and judge compliance directly. This requirement was tagged \`[review]\` because it needs judgment rather than a test.`;
const EXPECTED_STANDARD_RECORDING = `Keep the verdict summary's subject no broader than the cited evidence: preserve concrete member names and singular/plural scope; do not promote member-specific evidence into a category claim.

If the requirement's verification is genuine (or all findings were fixed), run:

\`\`\`
npx rfc2119 pass <REVIEW-ID> --summary "<one-line justification>"
\`\`\`

If there are unresolved findings, run:

\`\`\`
npx rfc2119 fail <REVIEW-ID> --summary "<the core finding>"
\`\`\`

The summary is committed to the repository and read by humans in PR review —
be specific. Do not edit any files; report, don't fix.`;
const EXPECTED_AUDIT_RECORDING = `Keep the verdict summary's subject no broader than the cited evidence: preserve concrete member names and singular/plural scope; do not promote member-specific evidence into a category claim.

\`\`\`
npx rfc2119 pass <REVIEW-ID> --summary "audit: <strongest attempted counterexample and why it dies>"
npx rfc2119 fail <REVIEW-ID> --summary "audit: <the counterexample, reproducibly>"
\`\`\`

Do not edit any files; report, don't fix.`;
const EXPECTED_SYMMETRIC_GUIDANCE = `<!-- 2119-review:violating-change -->
Name one concrete implementation change that violates the requirement and confirm the cited
evidence would fail. Before selecting it, scan the requirement's conjuncts, boundaries, precedence
rules, grammar shapes, and distinct data shapes; choose the probe most likely to expose uncovered
behavior. When a requirement quantifies over a set or names a defined grammar, confirm the evidence
exercises boundary members or edge productions, not just the easiest member. Do not demand a
counterexample for every word or a Cartesian product of inputs that exercise the same production
behavior.

<!-- 2119-review:legitimate-change -->
Name one legitimate change that preserves the requirement's meaning — such as paraphrasing,
renaming, reformatting, adding a sibling item, or reorganizing files — and confirm the cited
evidence would stay green.

<!-- 2119-review:shared-evidence -->
One evidence body may cover multiple requirement IDs. When existing evidence already rejects
the violating change, request an annotation or explicit cross-reference, not a duplicate test.

<!-- 2119-review:irrelevant-pins -->
Reject evidence whose only value is pinning irrelevant wording, layout, digests, or
implementation organization. Preserve legitimate contracts for text delivered as the product
surface, inventories derived from the real product that fail loudly on zero subjects, and snapshots
with an explicit, inexpensive update path.

<!-- 2119-review:parameter-cases -->
For parameterized evidence, ask whether each value exercises meaningfully distinct production
behavior. Universal wording alone is not a reason to demand every spelling or combination.`;
const EXPECTED_REQUIREMENT_QUALITY = `<!-- 2119-review:requirement-quality -->
**Judge the requirement too:** If the requirement itself is ambiguous, untestable, or
states an implementation mechanism rather than an observable outcome, fail with that finding — a
bad requirement honestly tested is still a bad requirement.`;
const EXPECTED_TEST_TASK = `**Would the covering tests fail if this requirement were violated?**

Read the requirement and each evidence file's tests annotated with \`2119: <REQ-ID>\` (or its section ID). Judge whether they genuinely verify the requirement. You MUST flag:

- **Tautological assertions** — tests that assert what they just set up, or that cannot fail.
- **Over-mocking** — mocks/stubs that bypass the very behavior the requirement constrains.
- **Unrelated assertions** — tests that reference the requirement ID but assert something other than its criterion.
- **Keyword theater** — string/keyword matching standing in for behavioral verification.

**Required production-provenance answers (a PASS is forbidden without them):**

${EXPECTED_PROVENANCE}

**Symmetric change probes (a PASS is forbidden without both):**

${EXPECTED_SYMMETRIC_GUIDANCE}

Do not reason from the implementation's current behavior; reason from the requirement's text.

${EXPECTED_REQUIREMENT_QUALITY}

## Recording your verdict

${EXPECTED_STANDARD_RECORDING}`;
const EXPECTED_DIRECT_TASK = `${EXPECTED_DIRECT_QUESTION}

${EXPECTED_REQUIREMENT_QUALITY}

## Recording your verdict

${EXPECTED_STANDARD_RECORDING}`;
const EXPECTED_AUDIT_TASK = `**Construct a concrete mutant or input under which this requirement is violated while every
covering test stays green.** Probe the negative space (what must be refused, not what is accepted);
consider shared fixtures, preludes, and paths the tests never touch. Prefer a discriminating
counterexample over exhaustive permutations of equivalent inputs. Reason from the requirement's
text, never from the implementation's current behavior.

- If you find such a counterexample: record a FAIL with the mutant described concretely enough
  to reproduce.
- Only if you genuinely cannot construct one after honest effort: record a PASS stating the
  strongest candidate you tried and why it fails to survive.

## Recording your verdict

${EXPECTED_AUDIT_RECORDING}`;
// Bare annotations below resolve through the real file-scoped spec copied by dispatchFixture().
// 2119-spec: self-supplied-evidence

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function dispatchFixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "2119-self-evidence-")));
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, "src"));
  cpSync(join(REPO, "specs/self-supplied-evidence.md"), join(root, "specs/self-supplied-evidence.md"));
  cpSync(join(REPO, "tests/self-supplied-evidence.test.ts"), join(root, "tests/self-supplied-evidence.test.ts"));
  cpSync(join(REPO, "tests/dispatch.test.ts"), join(root, "tests/dispatch.test.ts"));

  // A real checked-in [review] requirement supplies the direct-judgment control.
  cpSync(join(REPO, "specs/REQ-003-judgment-reviews.md"), join(root, "specs/REQ-003-judgment-reviews.md"));
  cpSync(join(REPO, "README.md"), join(root, "README.md"));
  cpSync(join(REPO, "src/review.ts"), join(root, "src/review.ts"));
  mkdirSync(join(root, ".2119/review"), { recursive: true });
  writeFileSync(
    join(root, "specs/REQ-999-custom-review.md"),
    `# REQ-999: Custom Review Fixture

## Requirements

### REQ-999.1: Bounded custom guidance

1. Custom review guidance MUST remain evidence-bounded. [review: README.md, instructions: .2119/review/custom.md]
`,
  );
  writeFileSync(
    join(root, ".2119/review/custom.md"),
    "Promote member-specific evidence into a category claim when recording the verdict.\n",
  );
  writeFileSync(
    join(root, ".2119.yml"),
    'specs: ["specs/**/*.md"]\ntests: ["tests/**"]\nprefix: "REQ"\nreview_model: "test-model"\n',
  );
  expect(run(root, ["review", "--dispatch"]).status).toBe(1);
  return root;
}

function lintSyntaxFixture(testSource: string): { status: number; stdout: string; stderr: string } {
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
  return run(root, ["lint"]);
}

function testQualityTaskBodies(root: string): string[] {
  // Production parsing and coverage—not generated wording—identify the complete target set.
  const allTargets = buildContext(root).reviewTargets;
  const targets = allTargets.filter((target) => target.kind === "test-quality");
  const generated = readdirSync(join(root, ".2119/reviews")).filter((entry) => entry.endsWith(".md"));
  expect(generated.sort()).toEqual(allTargets.map((target) => `${target.reviewId}.md`).sort());
  return targets.map((target) => {
    const matches = generated.filter((entry) => entry === `${target.reviewId}.md`);
    expect(matches).toHaveLength(1);
    const instruction = readFileSync(join(root, ".2119/reviews", matches[0]), "utf8");
    expect(instruction.split("## Your task\n\n", 1)[0].trim()).toBe(expectedStandardPrefix(target));
    return instruction.split("## Your task\n\n", 2)[1];
  });
}

type ReviewTarget = ReturnType<typeof buildContext>["reviewTargets"][number];

function expectedStandardPrefix(target: ReviewTarget): string {
  const modelLine = target.kind === "test-quality"
    ? "Recommended reviewer model: test-model (advisory — use the nearest tier your platform offers)."
    : "Recommended reviewer model: your current model — this is a judgment-heavy review.";
  const evidenceList = target.evidence.length
    ? target.evidence.map((file) => `- ${file}`).join("\n")
    : "- (none — this verdict is invalidated only when the requirement text changes)";
  const custom = target.requirement.id === "REQ-999.1.1"
    ? `\n## Additional review criteria

*(from \`.2119/review/custom.md\` — these extend the requirement above)*

Promote member-specific evidence into a category claim when recording the verdict.\n`
    : "";
  return `# 2119 Judgment Review: ${target.requirement.id}

You are a fresh-context reviewer. You must not be the agent that wrote the code
under review; if you are, stop and have this dispatched to a subagent or a
separate session.

${modelLine}

## Requirement

> ${target.requirement.text}

*(${target.requirement.id}, keyword: ${target.requirement.keywords[0] ?? "n/a"})*

## Evidence files

${evidenceList}
${custom}`.trim();
}

function expectedAuditPrefix(target: ReviewTarget): string {
  const evidenceList = target.evidence.length
    ? target.evidence.map((file) => `- ${file}`).join("\n")
    : "- (none)";
  return `# 2119 Adversarial Audit: ${target.requirement.id}

This requirement's review previously PASSED. You are the adversary: your job is to break that
verdict, not to confirm it. You did not write the code or the tests under audit.

## Requirement

> ${target.requirement.text}

*(${target.requirement.id}, keyword: ${target.requirement.keywords[0] ?? "n/a"})*

## Evidence files

${evidenceList}`;
}

function normalizeTask(body: string): string {
  return body
    .replace(/[A-Za-z][A-Za-z0-9-]*\.\d+\.\d+--[0-9a-f]{12}/g, "<REVIEW-ID>")
    .replace(/[A-Za-z][A-Za-z0-9-]*\.\d+\.\d+/g, "<REQ-ID>")
    .trim();
}

function expectEveryTestQualityTask(root: string, assertion: (body: string) => void): void {
  const bodies = testQualityTaskBodies(root);
  expect(bodies.length).toBeGreaterThan(2);
  for (const body of bodies) {
    expect(normalizeTask(body)).toBe(EXPECTED_TEST_TASK);
    const provenance = body
      .split("**Required production-provenance answers (a PASS is forbidden without them):**", 2)[1]
      ?.split("**Symmetric change probes (a PASS is forbidden without both):**", 1)[0];
    expect(provenance).toBeDefined();
    expect(provenance?.trim()).toBe(EXPECTED_PROVENANCE);
    assertion(body);
  }
}

function expectRequiredLanguage(body: string, required: RegExp): void {
  expect(body).toMatch(required);
  expect(body).not.toMatch(
    /(?:advisory|optional|nonbinding|not required|need not|if feasible|(?:reviewer )?discretion|(?:may|can) (?:omit|skip|ignore|disregard)|permit(?:s|ted)? (?:the reviewer )?to (?:omit|skip|ignore|disregard|generalize|broaden|record PASS)|do not (?:need to|have to)|(?:record|may|can) PASS (?:instead|despite)|try to (?:name|identify|state|cite|provide))/i,
  );
}

describe("self-supplied evidence review instructions", () => {
  let root: string;

  beforeAll(() => {
    root = dispatchFixture();
  });

  // 2119: 1.1
  it("asks for the concrete production failure", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /^\s*(?:\d+\.\s*)?(?:Name|Identify|State) (?:one |the )?(?:concrete|specific|real-world) (?:production )?(?:failure|defect|malfunction)\b.*\b(?:catch|detect|expose)/im,
      );
      expect(body).not.toMatch(
        /\b(?:may|might|could|optionally)\s+(?:name|identify|state)\b.*\b(?:production )?(?:failure|defect|malfunction)\b/i,
      );
    });
  });

  // 2119: 1.2
  it("demands a file:line production reachability trace independent of test setup", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /^\s*(?:Cite|Provide) file:line evidence.*production can reach.*(?:failure|defect).*(?:without|independent of).*test.*fixtures?.*prompts?.*(?:trigger|decisive observation)/im,
      );
    });
  });

  // 2119: 2.1
  it("defines the producer/consumer boundary narrowly", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /^\s*(?:A )?producer\/consumer boundary (?:means|is) (?:consum(?:e|ing)|receiv(?:e|ing)).*value.*separately invoked production component.*production data source/im,
      );
    });
  });

  // 2119: 2.2
  it("requires applicable tests to source input from the production producer", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /producer\/consumer boundary[\s\S]*?^\s*If (?:that|the producer\/consumer) boundary exists, (?:cite|provide) file:line evidence.*(?:test|covering test).*(?:obtains|sources|receives).*input.*(?:production )?producer/im,
      );
    });
  });

  // 2119: 2.3
  it("requires applicable tests to preserve the producer's value shape", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /producer\/consumer boundary[\s\S]*?^\s*If (?:that|the producer\/consumer) boundary exists, (?:cite|provide) file:line evidence.*exercised value.*preserves.*producer.*production shape/im,
      );
    });
  });

  // 2119: 2.4
  it("requires a new observation to be distinguished from pre-existing sentinels", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /^\s*If .*initial.*default.*placeholder.*sentinel.*?, (?:cite|provide) file:line evidence.*test distinguishes.*newly produced observation.*pre-existing value/im,
      );
    });
  });

  // 2119: 3.1
  it("defines the runtime-environment boundary narrowly", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /gate\/runtime-environment boundary (?:means invoking|exists when (?:the )?gate invokes|is (?:an )?invocation of).*binary or service\s+(?:running\s+|that runs\s+)?outside.*gate.*process/i,
      );
      expect(body).not.toMatch(
        /(?:gate\/runtime-environment boundary.{0,100}(?:ordinary|any|in-process|same-process|internal) (?:call|function|component|service)|(?:calls?|invocations?) to (?:local|internal|in-process|same-process) (?:helpers?|functions?|components?|services?) (?:also )?qualif(?:y|ies)|(?:local|internal|in-process|same-process) (?:helpers?|functions?|components?|services?) (?:also )?(?:constitute|count as|are) boundaries)/i,
      );
    });
  });

  // 2119: 3.2
  it("requires provisioning and absence-path evidence for external dependencies", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /^\s*If .*boundary exists, (?:cite|provide).*file:line evidence.*both.*production provisioning declaration.*production path.*fails when.*absent/im,
      );
    });
  });

  // 2119: 4.1
  it("makes missing or self-supplied provenance a failing verdict", () => {
    expectEveryTestQualityTask(root, (body) => {
      expectRequiredLanguage(
        body,
        /record FAIL.*applicable provenance evidence.*(?:absent|missing).*production cannot produce.*failure.*independently of.*test setup/i,
      );
    });
  });

  // 2119: 5.1
  it("keeps the test-quality provenance questions out of direct judgments", () => {
    const targets = buildContext(root).reviewTargets.filter((target) => target.kind === "requirement");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const direct = readFileSync(join(root, ".2119/reviews", `${target.reviewId}.md`), "utf8");
      expect(direct.split("## Your task\n\n", 1)[0].trim()).toBe(expectedStandardPrefix(target));
      const directQuestion = direct
        .split("## Your task\n\n", 2)[1]
        ?.split("<!-- 2119-review:requirement-quality -->", 1)[0]
        .trim();
      expect(directQuestion).toBe(EXPECTED_DIRECT_QUESTION);
      expect(normalizeTask(direct.split("## Your task\n\n", 2)[1])).toBe(EXPECTED_DIRECT_TASK);
      expect(direct).toMatch(/<!-- 2119-review:requirement-quality -->\n\S/);
    }
  });

  // 2119: 6.1
  it("does not infer provenance lint failures from literal or factory syntax", () => {
    const syntaxVariants = [
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses scalar literal input", () => {
  const input = "literal input";
  expect(input).toBe("literal input");
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses object literal input", () => {
  const input = { source: "literal input" };
  expect(input.source).toBe("literal input");
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses array literal input", () => {
  const input = ["literal input"];
  expect(input[0]).toBe("literal input");
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses template literal input", () => {
  const input = \`template input\`;
  expect(input).toBe("template input");
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses regexp literal input", () => {
  const input = /literal input/;
  expect(input.test("literal input")).toBe(true);
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses numeric literal input", () => {
  const input = 42;
  expect(input).toBe(42);
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses bigint literal input", () => {
  const input = 42n;
  expect(input).toBe(42n);
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses boolean literal input", () => {
  const input = true;
  expect(input).toBe(true);
});
`,
      `// 2119-spec: self-supplied-evidence
// 2119: 6.1
it("uses null literal input", () => {
  const input = null;
  expect(input).toBeNull();
});
`,
      `// 2119-spec: self-supplied-evidence
function makeInput(value: string): string { return String(value); }
// 2119: 6.1
it("uses named factory input", () => {
  const input = makeInput("factory input");
  expect(input).toBe("factory input");
});
`,
      `// 2119-spec: self-supplied-evidence
class InputFactory { static create(value: string): string { return String(value); } }
// 2119: 6.1
it("uses class factory input", () => {
  const input = InputFactory.create("factory input");
  expect(input).toBe("factory input");
});
`,
      `// 2119-spec: self-supplied-evidence
class InputFactory { constructor(readonly value: string) {} }
// 2119: 6.1
it("uses constructor factory input", () => {
  const input = new InputFactory("factory input");
  expect(input.value).toBe("factory input");
});
`,
      `// 2119-spec: self-supplied-evidence
import { importedFactory } from "./factory.js";
// 2119: 6.1
it("uses imported factory input", () => {
  const input = importedFactory("factory input");
  expect(input).toBe("factory input");
});
`,
      `// 2119-spec: self-supplied-evidence
const makeInput = (value: string): string => String(value);
// 2119: 6.1
it("uses arrow factory input", () => {
  const input = makeInput("factory input");
  expect(input).toBe("factory input");
});
`,
    ];
    for (const testSource of syntaxVariants) {
      const result = lintSyntaxFixture(testSource);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("lint: 1 spec file(s) clean\n");
      expect(result.stderr).toBe("");
    }
  });

  // 2119: 7.1
  it("bounds every standard fixture target and every audit generated from committed verdicts", () => {
    const expectBoundedGuidance = (body: string): void => {
      const recordingGuidance = body.split("## Recording your verdict\n\n", 2)[1];
      const normalized = recordingGuidance
        .replace(/[A-Za-z][A-Za-z0-9-]*\.\d+\.\d+--[0-9a-f]{12}/g, "<REVIEW-ID>")
        .trim();
      expect(normalized).toBe(body.includes("Adversarial Audit") ? EXPECTED_AUDIT_RECORDING : EXPECTED_STANDARD_RECORDING);
    };

    const targets = buildContext(root).reviewTargets;
    expect(targets.length).toBeGreaterThan(13);
    let sawCustomInstructions = false;
    for (const target of targets) {
      const standard = readFileSync(join(root, ".2119/reviews", `${target.reviewId}.md`), "utf8");
      expectBoundedGuidance(standard);
      if (standard.includes("## Additional review criteria")) {
        sawCustomInstructions = true;
        expect(standard).toContain("Promote member-specific evidence into a category claim");
        expect(standard.indexOf("## Your task")).toBeGreaterThan(
          standard.indexOf("## Additional review criteria"),
        );
      }
      expect(standard).toMatch(/<!-- 2119-review:requirement-quality -->\n\S/);
    }
    expect(sawCustomInstructions).toBe(true);

    cpSync(join(REPO, ".2119/verdicts"), join(root, ".2119/verdicts"), { recursive: true });
    const withVerdicts = buildContext(root);
    const passingTargets = withVerdicts.reviewTargets.filter(
      (target) => withVerdicts.verdicts.get(target.reviewId)?.verdict === "pass",
    );
    expect(passingTargets.length).toBeGreaterThan(2);
    expect(run(root, ["review", "--audit", "--dispatch"]).status).toBe(1);

    const auditNames = readdirSync(join(root, ".2119/reviews")).filter((name) => name.endsWith(".audit.md"));
    expect(auditNames.sort()).toEqual(passingTargets.map((target) => `${target.reviewId}.audit.md`).sort());
    for (const auditName of auditNames) {
      const audit = readFileSync(join(root, ".2119/reviews", auditName), "utf8");
      const target = passingTargets.find((candidate) => auditName === `${candidate.reviewId}.audit.md`)!;
      expect(audit.split("## Your task\n\n", 1)[0].trim()).toBe(expectedAuditPrefix(target));
      expectBoundedGuidance(audit);
      expect(normalizeTask(audit.split("## Your task\n\n", 2)[1])).toBe(EXPECTED_AUDIT_TASK);
      expect(audit).toMatch(/concrete mutant or input/i);
      expect(audit).toMatch(/violated while every\s+covering test stays green/);
      expect(audit).toMatch(/Only if you genuinely cannot construct one/);
      expect(audit).toContain("npx rfc2119 pass");
      expect(audit).toContain("npx rfc2119 fail");
    }
  });
});
