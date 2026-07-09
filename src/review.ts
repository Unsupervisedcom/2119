import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { CoverageResult } from "./cover.js";
import type { Requirement, SpecFile, Verdict, Violation } from "./model.js";
import { computeReviewId } from "./hash.js";
import { matchGlobs } from "./files.js";
import { allRequirements } from "./spec.js";

export const REVIEWS_DIR = ".2119/reviews";

export interface ReviewTask {
  reviewId: string;
  requirement: Requirement;
  /** Repo-relative evidence files hashed into the review ID. */
  evidence: string[];
  /** Why this review exists: test-quality judgment or [review]-tag judgment. */
  kind: "test-quality" | "requirement";
  instructionPath: string;
}

/**
 * Determine every requirement that needs a judgment review and its current
 * review ID. Test-covered enforced requirements get a test-quality review;
 * `[review]`-tagged requirements get a direct judgment review over their
 * declared globs (REQ-003.1.3).
 */
export function computeReviewTargets(
  config: Config,
  specs: SpecFile[],
  coverage: CoverageResult,
  repoFiles: string[],
): Omit<ReviewTask, "instructionPath">[] {
  const out: Omit<ReviewTask, "instructionPath">[] = [];
  for (const req of allRequirements(specs)) {
    if (req.removed) continue;
    if (req.keywords.length !== 1 || !config.enforce.includes(req.keywords[0])) continue;

    if (req.coverage.kind === "test") {
      const anns = coverage.covered.get(req.id);
      if (!anns || anns.length === 0) continue; // cover already fails this
      const evidence = [...new Set(anns.map((a) => a.file))].sort();
      out.push({
        reviewId: computeReviewId(config.root, req.id, req.text, evidence),
        requirement: req,
        evidence,
        kind: "test-quality",
      });
    } else if (req.coverage.kind === "review") {
      // Bare [review] hashes the statement text only: the verdict stands
      // until the requirement itself changes.
      const evidence = req.coverage.globs ? matchGlobs(repoFiles, req.coverage.globs) : [];
      // Custom criteria are part of what a verdict vouches for, so the
      // instruction file participates in the hash (REQ-005.1.2).
      const hashed = req.coverage.instructions ? [req.coverage.instructions, ...evidence] : evidence;
      out.push({
        reviewId: computeReviewId(config.root, req.id, req.text, hashed),
        requirement: req,
        evidence,
        kind: "requirement",
      });
    }
  }
  return out;
}

/** Requirements whose current review ID has no passing verdict (REQ-003.3.1, REQ-003.2.4). */
export function verdictViolations(
  targets: Omit<ReviewTask, "instructionPath">[],
  verdicts: Map<string, Verdict>,
): Violation[] {
  const out: Violation[] = [];
  for (const t of targets) {
    const v = verdicts.get(t.reviewId);
    if (!v) {
      out.push({
        file: `${VERDICTS_DIR_HINT}/${t.reviewId}.json`,
        line: 1,
        rule: "REQ-003.3.1",
        message: `${t.requirement.id} has no current review verdict (review ID ${t.reviewId}); run \`2119 review\``,
      });
    } else if (v.verdict === "fail") {
      out.push({
        file: `${VERDICTS_DIR_HINT}/${t.reviewId}.json`,
        line: 1,
        rule: "REQ-003.2.4",
        message: `${t.requirement.id} has a failing review verdict: ${v.summary}`,
      });
    }
  }
  return out;
}

const VERDICTS_DIR_HINT = ".2119/verdicts";

/** Write instruction files for reviews that are missing or stale (REQ-003.1.4). */
export function generateInstructions(
  config: Config,
  targets: Omit<ReviewTask, "instructionPath">[],
  verdicts: Map<string, Verdict>,
): ReviewTask[] {
  const pending = targets.filter((t) => verdicts.get(t.reviewId)?.verdict !== "pass");
  // Keep the directory exactly in sync with the pending set — stale
  // instruction files from prior rounds are misleading (REQ-006.1).
  const dir = join(config.root, REVIEWS_DIR);
  mkdirSync(dir, { recursive: true });
  const pendingIds = new Set(pending.map((t) => t.reviewId));
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".md") && !pendingIds.has(file.replace(/\.md$/, ""))) {
      unlinkSync(join(dir, file));
    }
  }
  if (pending.length === 0) return [];
  return pending.map((t) => {
    const instructionPath = `${REVIEWS_DIR}/${t.reviewId}.md`;
    // Inline custom criteria so the reviewer needs no extra fetches (REQ-005.1.3).
    let custom: { path: string; content: string } | undefined;
    const customPath = t.requirement.coverage.instructions;
    if (customPath) {
      try {
        custom = { path: customPath, content: readFileSync(join(config.root, customPath), "utf8").trim() };
      } catch {
        custom = { path: customPath, content: "(file missing — see the check violation for this requirement)" };
      }
    }
    writeFileSync(join(config.root, instructionPath), renderInstructions(t, config.reviewModel, custom));
    return { ...t, instructionPath };
  });
}

function renderInstructions(
  t: Omit<ReviewTask, "instructionPath">,
  reviewModel: string,
  custom?: { path: string; content: string },
): string {
  const evidenceList = t.evidence.length
    ? t.evidence.map((f) => `- ${f}`).join("\n")
    : "- (none — this verdict is invalidated only when the requirement text changes)";
  const question =
    t.kind === "test-quality"
      ? `**Would the covering tests fail if this requirement were violated?**

Read the requirement and each evidence file's tests annotated with \`2119: ${t.requirement.id}\` (or its section ID). Judge whether they genuinely verify the requirement. You MUST flag:

- **Tautological assertions** — tests that assert what they just set up, or that cannot fail.
- **Over-mocking** — mocks/stubs that bypass the very behavior the requirement constrains.
- **Unrelated assertions** — tests that reference the requirement ID but assert something other than its criterion.
- **Keyword theater** — string/keyword matching standing in for behavioral verification.`
      : `**Is this requirement genuinely satisfied by the current state of the evidence files?**

Read the requirement and the evidence files and judge compliance directly. This requirement was tagged \`[review]\` because it needs judgment rather than a test.`;

  // Judgment-heavy [review]-tagged requirements warrant the dispatcher's own
  // (typically stronger) model; routine test-quality reviews suit the pinned
  // cheaper tier (REQ-003.5.2, REQ-003.5.3).
  const modelLine =
    t.kind === "test-quality"
      ? `Recommended reviewer model: ${reviewModel} (advisory — use the nearest tier your platform offers).`
      : `Recommended reviewer model: your current model — this is a judgment-heavy review.`;

  return `# 2119 Judgment Review: ${t.requirement.id}

You are a fresh-context reviewer. You must not be the agent that wrote the code
under review; if you are, stop and have this dispatched to a subagent or a
separate session.

${modelLine}

## Requirement

> ${t.requirement.text}

*(${t.requirement.id}, keyword: ${t.requirement.keywords[0] ?? "n/a"})*

## Evidence files

${evidenceList}

## Your task

${question}
${custom ? `\n## Additional review criteria\n\n*(from \`${custom.path}\` — these extend the requirement above)*\n\n${custom.content}\n` : ""}
## Recording your verdict

If the requirement's verification is genuine (or all findings were fixed), run:

\`\`\`
npx rfc2119 pass ${t.reviewId} --summary "<one-line justification>"
\`\`\`

If there are unresolved findings, run:

\`\`\`
npx rfc2119 fail ${t.reviewId} --summary "<the core finding>"
\`\`\`

The summary is committed to the repository and read by humans in PR review —
be specific. Do not edit any files; report, don't fix.
`;
}
