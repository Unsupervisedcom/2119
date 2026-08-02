import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "../src/check.js";

const CLI = resolve(import.meta.dirname, "../dist/cli.js");
const REPO = resolve(import.meta.dirname, "..");

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

function instruction(root: string, requirementId: string): string {
  const name = readdirSync(join(root, ".2119/reviews")).find(
    (entry) => entry.startsWith(`${requirementId}--`) && entry.endsWith(".md"),
  );
  expect(name, `instruction for ${requirementId}`).toBeDefined();
  return readFileSync(join(root, ".2119/reviews", name!), "utf8");
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
    expect(body).toContain("**Required production-provenance answers (a PASS is forbidden without them):**");
    expect(body).not.toMatch(
      /ignore|disregard|omit|skip|refrain from|need not|not required|no need|do not (?:need|have to|name|cite|record|answer|provide|trace|distinguish)|optional(?:ly)?|if you want|may decline|when (?:available|convenient|possible)|if (?:available|convenient|possible)|where possible|as time permits/i,
    );
    expect(body).not.toMatch(
      /(?:but|however|except|alternatively|also (?:means|includes|allows)|may (?:also|instead)|fixture-produced|test-produced).*(?:boundary|producer|provenance|evidence|value|input|observation)/i,
    );
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
    const direct = instruction(root, "REQ-003.4.2");
    expect(direct).toContain("Is this requirement genuinely satisfied");
    expect(direct).not.toMatch(
      /Required production-provenance answers|production failure|file:line|producer\/consumer boundary|sentinel value|runtime-environment boundary|provenance evidence/i,
    );
  });

  // 2119: 6.1
  it("does not infer provenance lint failures from literal or factory syntax", () => {
    // The copied, annotated test contains both literal config text and a factory function;
    // lint consumes those real files and must remain syntax-agnostic.
    const result = run(root, ["lint"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 spec file(s) clean");
    expect(basename(root)).toMatch(/^2119-self-evidence-/);
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
      expectBoundedGuidance(instruction(root, target.requirement.id));
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
      expectBoundedGuidance(readFileSync(join(root, ".2119/reviews", auditName), "utf8"));
    }
  });
});
