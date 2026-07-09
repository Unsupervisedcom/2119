#!/usr/bin/env node
import { buildContext, buildReport } from "./check.js";
import { generateInstructions } from "./review.js";
import { writeVerdict } from "./verdict.js";
import { splitReviewId } from "./hash.js";
import { runInit } from "./init.js";
import { handleHook, type HookEvent, type HookPlatform } from "./hook.js";
import { CONFIG_FILENAME } from "./config.js";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Violation } from "./model.js";

const root = process.cwd();

function printViolations(violations: Violation[]): void {
  for (const v of violations) {
    console.error(`${v.file}:${v.line} [${v.rule}] ${v.message}`);
  }
}

function requireInitialized(ctx: ReturnType<typeof buildContext>): void {
  if (ctx.notInitialized) {
    console.error(
      "2119 is not set up in this repository: no .2119.yml and no spec files found.\n" +
        "Run `2119 init` to scaffold specs/, .2119.yml, and agent integration.",
    );
    process.exit(2);
  }
}

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "lint": {
    const ctx = buildContext(root);
    requireInitialized(ctx);
    printViolations(ctx.lintViolations);
    if (ctx.lintViolations.length > 0) process.exit(1);
    console.log(`lint: ${ctx.specs.length} spec file(s) clean`);
    break;
  }

  case "cover": {
    const ctx = buildContext(root);
    requireInitialized(ctx);
    printViolations(ctx.coverViolations);
    if (ctx.coverViolations.length > 0) process.exit(1);
    console.log(`cover: ${ctx.coverage.covered.size} requirement(s) covered, 0 uncovered`);
    break;
  }

  case "review": {
    let ctx = buildContext(root);
    requireInitialized(ctx);
    // First interactive run without a configured model: ask once and persist
    // (REQ-003.5.4). Agents and CI (no TTY) never block on input (REQ-003.5.5).
    if (!ctx.config.reviewModelExplicit && process.stdin.isTTY && process.stdout.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (
        await rl.question(
          `Reviewer model for test-quality judgment reviews (platform-specific, e.g. a\n` +
            `capable but cost-effective model on your agent platform; persisted to ${CONFIG_FILENAME}):\n> `,
        )
      ).trim();
      rl.close();
      if (answer) {
        appendFileSync(join(root, CONFIG_FILENAME), `review_model: ${JSON.stringify(answer)}\n`);
        ctx = buildContext(root);
      }
    }
    const tasks = generateInstructions(ctx.config, ctx.reviewTargets, ctx.verdicts);
    if (tasks.length === 0) {
      console.log("review: all judgment reviews have current passing verdicts");
      break;
    }
    console.log(
      `${tasks.length} judgment review(s) pending. Dispatch each to a FRESH-CONTEXT reviewer\n` +
        `(a subagent or separate session that did not write the code under review).\n` +
        `Recommended reviewer model: ${ctx.config.reviewModel} for test-quality reviews;\n` +
        `use your own (stronger) model for [review]-tagged judgment reviews.\n` +
        `Each instruction file is self-contained and tells the reviewer how to record a verdict:\n`,
    );
    for (const t of tasks) {
      console.log(`- ${t.requirement.id} (${t.kind}): ${t.instructionPath}`);
    }
    process.exit(1);
  }

  case "pass":
  case "fail": {
    const reviewId = args.find((a) => !a.startsWith("--"));
    const summary = flag(args, "--summary");
    if (!reviewId || !summary) {
      console.error(`usage: 2119 ${command} <review-id> --summary "<text>"`);
      process.exit(2);
    }
    const parsed = splitReviewId(reviewId);
    if (!parsed) {
      console.error(`Invalid review ID: "${reviewId}"`);
      process.exit(2);
    }
    const ctx = buildContext(root);
    requireInitialized(ctx);
    const target = ctx.reviewTargets.find((t) => t.requirement.id === parsed.requirementId);
    if (!target) {
      console.error(`No reviewable requirement "${parsed.requirementId}" exists`);
      process.exit(2);
    }
    // Refuse hash-mismatched verdicts: no pre-computed or replayed passes (REQ-003.2.3).
    if (target.reviewId !== reviewId) {
      console.error(
        `Stale review ID: content has changed since this review was generated.\n` +
          `  given:   ${reviewId}\n  current: ${target.reviewId}\n` +
          `Re-run \`2119 review\` and review the current content.`,
      );
      process.exit(1);
    }
    const v = writeVerdict(root, reviewId, parsed.requirementId, command, summary);
    console.log(`Recorded ${command} verdict for ${parsed.requirementId} (${reviewId})`);
    console.log(`  ${v.summary}`);
    break;
  }

  case "check": {
    const ctx = buildContext(root, { runVerify: true });
    requireInitialized(ctx);
    const report = buildReport(ctx);
    if (args.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printViolations(report.violations);
      if (report.manualRequirements.length > 0) {
        console.log(`\nManual requirements (not automatically checked):`);
        for (const m of report.manualRequirements) console.log(`  - ${m.id}: ${m.text}`);
      }
      console.log(
        `\ncheck: ${report.ok ? "PASS" : "FAIL"} — ${report.violations.length} violation(s), ` +
          `${report.uncoveredRequirements.length} uncovered, ${report.staleReviews.length} stale review(s)`,
      );
    }
    process.exit(report.ok ? 0 : 1);
  }

  case "init": {
    runInit(root, args);
    break;
  }

  case "hook": {
    const event = args.find((a) => !a.startsWith("--"));
    const platform = (flag(args, "--platform") ?? "claude") as HookPlatform;
    if (!event || !["after-edit", "stop", "session-start"].includes(event)) {
      // Even usage errors speak JSON and exit 0 (REQ-004.1.2).
      console.log(JSON.stringify({ systemMessage: `2119 hook: unknown event "${event ?? ""}"` }));
      break;
    }
    let payload: Record<string, unknown> = {};
    try {
      const stdin = readFileSync(0, "utf8").trim();
      if (stdin) payload = JSON.parse(stdin) as Record<string, unknown>;
    } catch {
      // Malformed/absent stdin: proceed with an empty payload.
    }
    console.log(JSON.stringify(handleHook(root, event as HookEvent, platform, payload)));
    break;
  }

  default: {
    console.log(`2119 — spec-driven test enforcement for coding agents

usage: 2119 <command>

  init      Scaffold specs/, .2119.yml, and agent integration for this repo
  lint      Validate spec files against the RFC 2119 document format
  cover     Verify every enforced requirement has a covering test annotation
  review    Generate judgment-review instruction files for stale/missing verdicts
  pass      Record a passing review verdict:  2119 pass <review-id> --summary "..."
  fail      Record a failing review verdict:  2119 fail <review-id> --summary "..."
  check     lint + cover + review-verdict freshness; non-zero exit on any failure
  hook      Agent hook entry point: 2119 hook <after-edit|stop|session-start> --platform <p>
`);
    process.exit(command ? 2 : 0);
  }
}
