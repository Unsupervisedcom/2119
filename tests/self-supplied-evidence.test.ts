import { execFileSync } from "node:child_process";
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
const EXPECTED_TASK = `**Would the covering tests fail if this requirement were violated?**

Read the requirement and each evidence file's tests annotated with \`2119: <REQ-ID>\` (or its section ID). Judge whether they genuinely verify the requirement. You MUST flag:

- **Tautological assertions** — tests that assert what they just set up, or that cannot fail.
- **Over-mocking** — mocks/stubs that bypass the very behavior the requirement constrains.
- **Unrelated assertions** — tests that reference the requirement ID but assert something other than its criterion.
- **Keyword theater** — string/keyword matching standing in for behavioral verification.

**Required production-provenance answers (a PASS is forbidden without them):**

${EXPECTED_PROVENANCE}

**Counterexample obligation:** enumerate the requirement's conjuncts and boundary terms (words
like "comment", "exactly", "only", "begins with"). For each, construct the nearest violating
input — the almost-conforming case the requirement forbids — and confirm a test rejects it.
Do not reason from the implementation's current behavior; reason from the requirement's text.
A review that cannot name a rejected counterexample for a boundary term is not a pass.

**Judge the requirement too:** if the requirement itself is ambiguous, untestable, or states an
implementation mechanism rather than an observable outcome, fail with that finding — a bad
requirement honestly tested is still a bad requirement.

## Recording your verdict

Keep the verdict summary's subject no broader than the cited evidence: preserve concrete member names and singular/plural scope; do not promote member-specific evidence into a category claim.

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
const RECORDING_GUIDANCE = "Keep the verdict summary's subject no broader than the cited evidence: preserve concrete member names and singular/plural scope; do not promote member-specific evidence into a category claim.";
const EXPECTED_DIRECT_TASK = `**Is this requirement genuinely satisfied by the current state of the evidence files?**

Read the requirement and the evidence files and judge compliance directly. This requirement was tagged \`[review]\` because it needs judgment rather than a test.

**Judge the requirement too:** if the requirement itself is ambiguous, untestable, or states an
implementation mechanism rather than an observable outcome, fail with that finding — a bad
requirement honestly tested is still a bad requirement.

## Recording your verdict

${RECORDING_GUIDANCE}

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
const EXPECTED_AUDIT_TASK = `**Construct a concrete mutant or input under which this requirement is violated while every
covering test stays green.** Enumerate the requirement's conjuncts and boundary terms; probe the
negative space (what must be refused, not what is accepted); consider shared fixtures, preludes,
and paths the tests never touch. Reason from the requirement's text, never from the
implementation's current behavior.

- If you find such a counterexample: record a FAIL with the mutant described concretely enough
  to reproduce.
- Only if you genuinely cannot construct one after honest effort: record a PASS stating the
  strongest candidate you tried and why it fails to survive.

## Recording your verdict

${RECORDING_GUIDANCE}

\`\`\`
npx rfc2119 pass <REVIEW-ID> --summary "audit: <strongest attempted counterexample and why it dies>"
npx rfc2119 fail <REVIEW-ID> --summary "audit: <the counterexample, reproducibly>"
\`\`\`

Do not edit any files; report, don't fix.`;

function normalizedTask(body: string): string {
  return body
    .replace(/[A-Za-z][A-Za-z0-9-]*\.\d+\.\d+--[0-9a-f]{12}/g, "<REVIEW-ID>")
    .replace(/[A-Za-z][A-Za-z0-9-]*\.\d+\.\d+/g, "<REQ-ID>")
    .trim();
}

// Bare annotations below resolve through the real file-scoped spec copied by dispatchFixture().
// 2119-spec: self-supplied-evidence

function run(cwd: string, args: string[]): { status: number; stdout: string } {
  try {
    return { status: 0, stdout: execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" }) };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { status: e.status, stdout: e.stdout ?? "" };
  }
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
  writeFileSync(
    join(root, ".2119.yml"),
    'specs: ["specs/**/*.md"]\ntests: ["tests/**"]\nprefix: "REQ"\nreview_model: "test-model"\n',
  );
  expect(run(root, ["review", "--dispatch"]).status).toBe(1);
  return root;
}

function testQualityTaskBodies(root: string): string[] {
  // Production parsing and coverage—not generated wording—identify the complete target set.
  const targets = buildContext(root).reviewTargets.filter((target) => target.kind === "test-quality");
  const generated = readdirSync(join(root, ".2119/reviews")).filter((entry) => entry.endsWith(".md"));
  return targets.map((target) => {
    const matches = generated.filter((entry) => entry === `${target.reviewId}.md`);
    expect(matches).toHaveLength(1);
    return readFileSync(join(root, ".2119/reviews", matches[0]), "utf8").split("## Your task\n\n", 2)[1];
  });
}

function expectEveryTestQualityTask(root: string, assertion: (body: string) => void): void {
  const bodies = testQualityTaskBodies(root);
  expect(bodies.length).toBeGreaterThan(2);
  for (const body of bodies) {
    expect(normalizedTask(body)).toBe(EXPECTED_TASK);
    const provenance = body
      .split("**Required production-provenance answers (a PASS is forbidden without them):**", 2)[1]
      ?.split("**Counterexample obligation:**", 1)[0];
    expect(provenance?.trim()).toBe(EXPECTED_PROVENANCE);
    assertion(body);
  }
}

describe("self-supplied evidence review instructions", () => {
  let root: string;

  beforeAll(() => {
    root = dispatchFixture();
  });

  // 2119: 1.1
  it("asks for the concrete production failure", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toMatch(/^1\. Name the concrete production failure this test would catch\.$/m);
    });
  });

  // 2119: 1.2
  it("demands a file:line production reachability trace independent of test setup", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toMatch(
        /^   Cite file:line evidence that production can reach that failure without the test, fixtures, or prompts supplying the trigger or decisive observation\.$/m,
      );
    });
  });

  // 2119: 2.1
  it("defines the producer/consumer boundary narrowly", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toMatch(
        /^   A producer\/consumer boundary means consuming a value emitted by a separately invoked production component or production data source\.$/m,
      );
    });
  });

  // 2119: 2.2
  it("requires applicable tests to source input from the production producer", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toContain("cite file:line evidence that the test obtains its input from that producer");
    });
  });

  // 2119: 2.3
  it("requires applicable tests to preserve the producer's value shape", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toContain("cite file:line evidence that the exercised value preserves the producer's production shape");
    });
  });

  // 2119: 2.4
  it("requires a new observation to be distinguished from pre-existing sentinels", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toMatch(
        /^   If the decisive observation can equal an initial\/default\/placeholder\/sentinel value, cite file:line evidence that the test distinguishes a newly produced observation from that pre-existing value\.$/m,
      );
    });
  });

  // 2119: 3.1
  it("defines the runtime-environment boundary narrowly", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toMatch(
        /^   A gate\/runtime-environment boundary means invoking a binary or service outside the gate's own process\.$/m,
      );
    });
  });

  // 2119: 3.2
  it("requires provisioning and absence-path evidence for external dependencies", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toMatch(
        /^   If that boundary exists, cite file:line evidence for both its production provisioning declaration and the production path that fails when it is absent\.$/m,
      );
    });
  });

  // 2119: 4.1
  it("makes missing or self-supplied provenance a failing verdict", () => {
    expectEveryTestQualityTask(root, (body) => {
      expect(body).toContain("Record FAIL when applicable provenance evidence is absent or shows that production cannot produce the failure independently of the test setup.");
    });
  });

  // 2119: 5.1
  it("keeps the test-quality provenance questions out of direct judgments", () => {
    const targets = buildContext(root).reviewTargets.filter((target) => target.kind === "requirement");
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const direct = readFileSync(join(root, ".2119/reviews", `${target.reviewId}.md`), "utf8");
      expect(normalizedTask(direct.split("## Your task\n\n", 2)[1])).toBe(EXPECTED_DIRECT_TASK);
    }
  });

  // 2119: 6.1
  it("does not infer provenance lint failures from literal or factory syntax", () => {
    // The copied, annotated test contains both literal config text and a factory function;
    // lint consumes those real files and must remain syntax-agnostic.
    const result = run(root, ["lint"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 spec file(s) clean");
  });

  // 2119: 7.1
  it("bounds every standard fixture target and every audit generated from committed verdicts", () => {
    const expectBoundedGuidance = (body: string): void => {
      const recordingGuidance = body.split("## Recording your verdict\n\n", 2)[1];
      expect(recordingGuidance).toMatch(
        /^Keep the verdict summary's subject no broader than the cited evidence: preserve concrete member names and singular\/plural scope; do not promote member-specific evidence into a category claim\.$/m,
      );
      expect(recordingGuidance).not.toMatch(
        /ignore|disregard|optional|need not|not required|may (?:broaden|generalize|promote)|broader (?:scope|category) (?:is|remains) allowed/i,
      );
    };

    const targets = buildContext(root).reviewTargets;
    expect(targets.length).toBeGreaterThan(13);
    for (const target of targets) {
      const standard = readFileSync(join(root, ".2119/reviews", `${target.reviewId}.md`), "utf8");
      expectBoundedGuidance(standard);
      expect(normalizedTask(standard.split("## Your task\n\n", 2)[1])).toBe(
        target.kind === "test-quality" ? EXPECTED_TASK : EXPECTED_DIRECT_TASK,
      );
    }

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
      expectBoundedGuidance(audit);
      expect(normalizedTask(audit.split("## Your task\n\n", 2)[1])).toBe(EXPECTED_AUDIT_TASK);
    }
  });
});
