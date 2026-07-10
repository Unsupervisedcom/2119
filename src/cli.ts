#!/usr/bin/env node
import { buildContext, buildReport } from "./check.js";
import { generateInstructions, renderDispatchPrompt } from "./review.js";
import { pruneVerdicts, writeVerdict } from "./verdict.js";
import { splitReviewId } from "./hash.js";
import { runInit } from "./init.js";
import { handleHook, type HookEvent, type HookPlatform } from "./hook.js";
import { CONFIG_FILENAME } from "./config.js";
import { allRequirements } from "./spec.js";
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

const USAGE = `2119 — spec-driven test enforcement for coding agents

usage: 2119 <command>

  init      Scaffold specs/, .2119.yml, and agent integration for this repo
  lint      Validate spec files against the RFC 2119 document format
  cover     Verify every enforced requirement has a covering test annotation
  review    Generate judgment-review instruction files for stale/missing verdicts
            (--dispatch also emits a ready-to-paste parallel-subagent prompt)
  pass      Record a passing review verdict:  2119 pass <review-id> --summary "..."
  fail      Record a failing review verdict:  2119 fail <review-id> --summary "..."
  check     lint + cover + review-verdict freshness; non-zero exit on any failure
            (--json machine output; --no-verify skips [verify] shell commands)
  prune     Delete verdicts whose review ID matches no current requirement content
  hook      Agent hook entry point: 2119 hook <after-edit|stop|session-start> --platform <p>
`;

// A --help flag is a question, not a command: answer before dispatch so no
// command ever executes (or writes files) under a help request (REQ-007.1).
if (
  !command ||
  command === "help" ||
  command === "--help" ||
  command === "-h" ||
  args.includes("--help") ||
  args.includes("-h")
) {
  console.log(USAGE);
  process.exit(0);
}

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
    if (args.includes("--dispatch")) {
      console.log(`\n${renderDispatchPrompt(tasks)}`);
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
    // --no-verify: CI for untrusted contributions can refuse to execute
    // spec-supplied shell; the requirements surface like [manual] instead of
    // silently dropping (REQ-002.3.5).
    const noVerify = args.includes("--no-verify");
    const ctx = buildContext(root, { runVerify: !noVerify });
    requireInitialized(ctx);
    const report = buildReport(ctx);
    if (noVerify) {
      for (const req of allRequirements(ctx.specs)) {
        if (!req.removed && req.coverage.kind === "verify") {
          report.manualRequirements.push({ id: req.id, text: `${req.text} [verify skipped: --no-verify]` });
        }
      }
    }
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

  case "prune": {
    const ctx = buildContext(root);
    requireInitialized(ctx);
    const current = new Set(ctx.reviewTargets.map((t) => t.reviewId));
    const pruned = pruneVerdicts(root, current);
    for (const id of pruned) console.log(`pruned .2119/verdicts/${id}.json`);
    console.log(`prune: removed ${pruned.length} orphaned verdict(s), kept ${ctx.verdicts.size - pruned.length}`);
    break;
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
    // Unrecognized command: usage on a non-zero exit, so typos are
    // distinguishable from successful help requests (REQ-007.1.3).
    console.log(USAGE);
    process.exit(2);
  }
}
