import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractEditedPaths, handleHook, SESSION_CONTEXT } from "../src/hook.js";

const GOOD_SPEC = `# REQ-001: Widgets

## Overview

Widgets.

## Requirements

### REQ-001.1: Basics

1. The widget MUST spin.
`;

const BAD_SPEC = GOOD_SPEC.replace("The widget MUST spin.", "The widget spins nicely.");

function fixture(spec = GOOD_SPEC, opts: { annotate?: boolean } = { annotate: true }): string {
  const root = mkdtempSync(join(tmpdir(), "2119-hook-"));
  mkdirSync(join(root, "specs"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "specs/REQ-001-widgets.md"), spec);
  const marker = ["21", "19"].join("");
  const body = opts.annotate ? `// ${marker}: REQ-001.1.1\ntest('spin', () => {})\n` : `test('x', () => {})\n`;
  writeFileSync(join(root, "tests/widget.test.js"), body);
  return root;
}

describe("normalized hook handling", () => {
  // 2119: REQ-004.1.3
  it("extracts edited paths from file_path fields and Codex apply_patch payloads", async () => {
    expect(extractEditedPaths({ tool_input: { file_path: "specs/REQ-001-w.md" } })).toEqual([
      "specs/REQ-001-w.md",
    ]);
    const patch = "*** Begin Patch\n*** Update File: specs/REQ-001-w.md\n@@\n*** Add File: tests/new.test.js\n*** End Patch";
    expect(extractEditedPaths({ tool_input: { input: patch } })).toEqual([
      "specs/REQ-001-w.md",
      "tests/new.test.js",
    ]);
  });

  // 2119: REQ-004.1.3
  it("ignores edits to files outside the spec and test globs", async () => {
    const root = fixture(BAD_SPEC);
    writeFileSync(join(root, "app.py"), "print('hi')\n");
    const out = await handleHook(root, "after-edit", "claude", { tool_input: { file_path: join(root, "app.py") } });
    expect(out).toEqual({});
  });

  // 2119: REQ-004.1.4
  it("injects lint violations for an edited spec file as additional context", async () => {
    const root = fixture(BAD_SPEC);
    const out = await handleHook(root, "after-edit", "claude", {
      tool_input: { file_path: join(root, "specs/REQ-001-widgets.md") },
    }) as { hookSpecificOutput?: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput?.additionalContext).toContain("REQ-001.2.2");
    // Gemini gets its own event name.
    const gem = await handleHook(root, "after-edit", "gemini", {
      tool_input: { file_path: join(root, "specs/REQ-001-widgets.md") },
    }) as { hookSpecificOutput?: { hookEventName: string } };
    expect(gem.hookSpecificOutput?.hookEventName).toBe("AfterTool");
  });

  // 2119: REQ-004.1.5
  it("blocks stop with a reason and fix commands while check is failing", async () => {
    const root = fixture(GOOD_SPEC, { annotate: false }); // uncovered MUST
    const out = await handleHook(root, "stop", "claude", {}) as { decision?: string; reason?: string };
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("REQ-001.1.1");
    expect(out.reason).toContain("npx rfc2119 check");
    const gem = await handleHook(root, "stop", "gemini", {}) as { decision?: string };
    expect(gem.decision).toBe("deny");
  });

  // 2119: REQ-004.1.6
  it("returns a non-blocking response when stop_hook_active is set", async () => {
    const root = fixture(GOOD_SPEC, { annotate: false });
    expect(await handleHook(root, "stop", "claude", { stop_hook_active: true })).toEqual({});
  });

  // 2119: REQ-004.1.7
  it("injects workflow context on session-start", async () => {
    const root = fixture();
    const out = await handleHook(root, "session-start", "claude", {}) as {
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput?.additionalContext).toBe(SESSION_CONTEXT);
    expect(SESSION_CONTEXT).toContain("npx rfc2119 check");
  });

  // 2119: REQ-004.1.8
  it("is a silent no-op in repositories where 2119 is not set up", async () => {
    const root = mkdtempSync(join(tmpdir(), "2119-empty-"));
    for (const event of ["after-edit", "stop", "session-start"] as const) {
      expect(await handleHook(root, event, "claude", {})).toEqual({});
    }
  });

  // 2119: REQ-004.1.9
  it("reports handler errors inside the JSON response instead of throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "2119-bad-"));
    writeFileSync(join(root, ".2119.yml"), "specs: {not: [valid, shape\n");
    const out = await handleHook(root, "stop", "claude", {}) as { systemMessage?: string };
    expect(out.systemMessage).toContain("2119 hook error");
  });
});
