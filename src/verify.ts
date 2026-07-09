import { execSync } from "node:child_process";
import type { Config } from "./config.js";
import type { Requirement, SpecFile, Violation } from "./model.js";

export const VERIFY_TIMEOUT_MS = 30_000;

function specPathFor(specs: SpecFile[], req: Requirement): string {
  for (const s of specs) {
    if (s.sections.some((sec) => sec.items.includes(req))) return s.path;
  }
  return "<unknown spec>";
}

/**
 * Run the verify command of every enforced [verify]-tagged requirement from
 * the repository root; a non-zero exit is a violation carrying the command's
 * output (REQ-005.2.1, REQ-005.2.2). Commands are killed at the timeout and
 * reported as failures (REQ-005.2.3).
 */
export function runVerifyCommands(
  config: Config,
  specs: SpecFile[],
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Violation[] {
  const out: Violation[] = [];
  for (const spec of specs) {
    for (const section of spec.sections) {
      for (const req of section.items) {
        if (req.removed || req.coverage.kind !== "verify" || !req.coverage.command) continue;
        if (req.keywords.length !== 1 || !config.enforce.includes(req.keywords[0])) continue;
        try {
          execSync(req.coverage.command, {
            cwd: config.root,
            timeout: timeoutMs,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (err) {
          const e = err as { stdout?: Buffer; stderr?: Buffer; signal?: string; status?: number | null };
          const timedOut = e.status == null && e.signal != null;
          const output = [e.stdout?.toString(), e.stderr?.toString()]
            .filter(Boolean)
            .join("\n")
            .trim()
            .slice(0, 500);
          out.push({
            file: specPathFor(specs, req),
            line: req.line,
            rule: timedOut ? "REQ-005.2.3" : "REQ-005.2.2",
            message: timedOut
              ? `${req.id} verify command exceeded the ${timeoutMs / 1000}s timeout: \`${req.coverage.command}\``
              : `${req.id} verify command failed (\`${req.coverage.command}\`)${output ? `:\n${output}` : ""}`,
          });
        }
      }
    }
  }
  return out;
}
