import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installAgentHooks, installCi, installGitHook } from "../src/adapters.js";

const fixture = () => mkdtempSync(join(tmpdir(), "2119-adapt-"));

describe("agent adapters", () => {
  // 2119: REQ-004.2.1
  it("registers PostToolUse/Stop/SessionStart hooks in .claude/settings.json", () => {
    const root = fixture();
    const result = installAgentHooks(root, "claude");
    expect(result.changed).toBe(true);
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Edit|Write");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain("2119 hook after-edit --platform claude");
    expect(settings.hooks.Stop[0].hooks[0].command).toContain("2119 hook stop");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("2119 hook session-start");
  });

  // 2119: REQ-004.2.2
  it("writes all three equivalent hooks to .codex/hooks.json and surfaces the /hooks trust note", () => {
    const root = fixture();
    const result = installAgentHooks(root, "codex");
    const settings = JSON.parse(readFileSync(join(root, ".codex/hooks.json"), "utf8"));
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Edit|Write");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain("2119 hook after-edit --platform codex");
    expect(settings.hooks.Stop[0].hooks[0].command).toContain("2119 hook stop --platform codex");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("2119 hook session-start --platform codex");
    expect(result.note).toContain("/hooks");
  });

  // 2119: REQ-004.2.3
  it("writes Gemini events with millisecond timeouts to .gemini/settings.json", () => {
    const root = fixture();
    installAgentHooks(root, "gemini");
    const settings = JSON.parse(readFileSync(join(root, ".gemini/settings.json"), "utf8"));
    expect(settings.hooks.AfterTool[0].matcher).toBe("write_file|replace");
    expect(settings.hooks.AfterAgent[0].hooks[0].command).toContain("2119 hook stop --platform gemini");
    expect(settings.hooks.AfterTool[0].hooks[0].timeout).toBeGreaterThanOrEqual(1000); // ms, not seconds
    expect(settings.hooks.SessionStart).toBeDefined();
  });

  // 2119: REQ-004.2.4
  it("merges into existing settings without touching unrelated keys", () => {
    const root = fixture();
    mkdirSync(join(root, ".claude"));
    writeFileSync(
      join(root, ".claude/settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(npm test)"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
      }),
    );
    installAgentHooks(root, "claude");
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    expect(settings.permissions.allow).toEqual(["Bash(npm test)"]);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("echo hi");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain("2119 hook");
  });

  // 2119: REQ-004.2.5
  it("is idempotent across repeated installs", () => {
    const root = fixture();
    installAgentHooks(root, "claude");
    const second = installAgentHooks(root, "claude");
    expect(second.changed).toBe(false);
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  // 2119: REQ-004.3.3
  it("installs a git pre-commit hook but refuses to overwrite a foreign one", () => {
    const root = fixture();
    mkdirSync(join(root, ".git/hooks"), { recursive: true });
    const first = installGitHook(root);
    expect(first.changed).toBe(true);
    const body = readFileSync(join(root, ".git/hooks/pre-commit"), "utf8");
    expect(body).toContain("npx rfc2119 check");

    const again = installGitHook(root);
    expect(again.changed).toBe(false);
    expect(again.refused).toBeUndefined();

    const root2 = fixture();
    mkdirSync(join(root2, ".git/hooks"), { recursive: true });
    writeFileSync(join(root2, ".git/hooks/pre-commit"), "#!/bin/sh\nmy-linter\n");
    const refused = installGitHook(root2);
    expect(refused.changed).toBe(false);
    expect(refused.refused).toContain("manually");
    expect(readFileSync(join(root2, ".git/hooks/pre-commit"), "utf8")).toContain("my-linter");
  });

  // 2119: REQ-004.3.4
  it("writes a GitHub Actions workflow that runs 2119 check on pull requests", () => {
    const root = fixture();
    const result = installCi(root);
    expect(result.changed).toBe(true);
    const body = readFileSync(join(root, ".github/workflows/2119.yml"), "utf8");
    expect(body).toContain("pull_request");
    expect(body).toContain("2119 check");
    expect(existsSync(join(root, ".github/workflows/2119.yml"))).toBe(true);
  });
});
