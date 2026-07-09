import { isAbsolute, relative, sep } from "node:path";
import picomatch from "picomatch";
import { buildContext, buildReport } from "./check.js";
import type { Violation } from "./model.js";

export type HookEvent = "after-edit" | "stop" | "session-start";
export type HookPlatform = "claude" | "codex" | "gemini";

/**
 * Denormalization table: Claude Code's contract is canonical; Codex cloned it
 * outright and Gemini differs only in event names and the stop decision value.
 */
const PLATFORM = {
  claude: { afterEdit: "PostToolUse", sessionStart: "SessionStart", stopDecision: "block" },
  codex: { afterEdit: "PostToolUse", sessionStart: "SessionStart", stopDecision: "block" },
  gemini: { afterEdit: "AfterTool", sessionStart: "SessionStart", stopDecision: "deny" },
} as const;

export const SESSION_CONTEXT = `This repository enforces spec-driven testing with 2119.
Requirements live in specs/ as RFC 2119 documents; every MUST-level requirement
needs an annotated test (comment containing "2119: <REQ-ID>") plus a passing
fresh-context judgment review. Run \`npx rfc2119 check\` before finishing any task —
it must exit 0, and CI runs the same command.`;

/** Pull candidate edited file paths out of a platform payload (REQ-004.1.3). */
export function extractEditedPaths(payload: Record<string, unknown>): string[] {
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const paths: string[] = [];
  if (typeof toolInput.file_path === "string") paths.push(toolInput.file_path);
  // Codex apply_patch: file paths live inside patch text on any string field.
  for (const value of Object.values(toolInput)) {
    if (typeof value !== "string") continue;
    for (const m of value.matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)) {
      paths.push(m[1].trim());
    }
  }
  return [...new Set(paths)];
}

function toRepoRelative(root: string, p: string): string {
  const rel = isAbsolute(p) ? relative(root, p) : p;
  return rel.split(sep).join("/");
}

function formatViolations(violations: Violation[], limit = 20): string {
  const shown = violations.slice(0, limit).map((v) => `- ${v.file}:${v.line} [${v.rule}] ${v.message}`);
  const more = violations.length > limit ? `\n…and ${violations.length - limit} more.` : "";
  return shown.join("\n") + more;
}

/**
 * Handle one normalized hook event and return the platform JSON response.
 * Always returns an object; never throws (REQ-004.1.9) and callers always
 * exit 0 (REQ-004.1.2).
 */
export function handleHook(
  root: string,
  event: HookEvent,
  platform: HookPlatform,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return dispatch(root, event, platform, payload);
  } catch (err) {
    return { systemMessage: `2119 hook error (${event}): ${err instanceof Error ? err.message : String(err)}` };
  }
}

function dispatch(
  root: string,
  event: HookEvent,
  platform: HookPlatform,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const names = PLATFORM[platform];

  if (event === "session-start") {
    const ctx = buildContext(root);
    if (ctx.notInitialized) return {};
    return {
      hookSpecificOutput: { hookEventName: names.sessionStart, additionalContext: SESSION_CONTEXT },
    };
  }

  if (event === "after-edit") {
    const ctx = buildContext(root);
    if (ctx.notInitialized) return {};
    const edited = extractEditedPaths(payload).map((p) => toRepoRelative(root, p));
    if (edited.length === 0) return {};
    const relevant = picomatch([...ctx.config.specs, ...ctx.config.tests], { dot: true });
    const inScope = new Set(edited.filter((p) => relevant(p)));
    if (inScope.size === 0) return {};
    const violations = [...ctx.lintViolations, ...ctx.coverViolations].filter((v) =>
      inScope.has(toRepoRelative(root, v.file)),
    );
    if (violations.length === 0) return {};
    return {
      hookSpecificOutput: {
        hookEventName: names.afterEdit,
        additionalContext:
          `2119 found problems in the file you just edited — fix them now:\n` +
          `${formatViolations(violations)}\n` +
          `Re-check with \`npx rfc2119 check\`.`,
      },
    };
  }

  // event === "stop"
  if (payload.stop_hook_active === true) return {}; // loop guard (REQ-004.1.6)
  const ctx = buildContext(root, { runVerify: true });
  if (ctx.notInitialized) return {};
  const report = buildReport(ctx);
  if (report.ok) return {};
  return {
    decision: names.stopDecision,
    reason:
      `2119 check is failing — the task is not done until it passes.\n` +
      `${formatViolations(report.violations)}\n\n` +
      `Fix lint/coverage issues directly. For pending judgment reviews, run\n` +
      `\`npx rfc2119 review\` and dispatch each instruction file in .2119/reviews/\n` +
      `to a fresh-context subagent. Verify with \`npx rfc2119 check\`.`,
  };
}
