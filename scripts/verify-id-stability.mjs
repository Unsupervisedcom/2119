#!/usr/bin/env node
// [verify] backing for REQ-001.3: requirement IDs are stable across history.
// Compares the current spec tree against a git baseline: every requirement ID
// present at the baseline must still exist (same ID, possibly reworded or
// tombstoned as REQUIREMENT REMOVED). An ID that disappears is renumbering or
// deletion-without-tombstone — the exact failure the append-only rule forbids.
//
// Baseline resolution: $RFC2119_ID_BASELINE, else merge-base with origin's
// default branch, else HEAD. Exits 0 with a note when no baseline is
// determinable (fresh repo, no git) — the honest limit of a temporal check.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpec } from "../dist/spec.js";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function baselineRef() {
  if (process.env.RFC2119_ID_BASELINE) return process.env.RFC2119_ID_BASELINE;
  try {
    const head = git("symbolic-ref", "refs/remotes/origin/HEAD");
    return git("merge-base", "HEAD", head);
  } catch {
    try {
      return git("rev-parse", "HEAD");
    } catch {
      return null;
    }
  }
}

function idsFromContent(path, content) {
  const spec = parseSpec(path, "REQ", content);
  const ids = new Map(); // id -> {removed}
  for (const sec of spec.sections) {
    for (const item of sec.items) ids.set(item.id, { removed: item.removed });
  }
  return ids;
}

const ref = baselineRef();
if (!ref) {
  console.log("id-stability: skipped (no git baseline available)");
  process.exit(0);
}

let baselineFiles;
try {
  baselineFiles = git("ls-tree", "-r", "--name-only", ref, "specs/").split("\n").filter((f) => f.endsWith(".md"));
} catch {
  console.log("id-stability: skipped (baseline has no specs/)");
  process.exit(0);
}

const problems = [];
for (const file of baselineFiles) {
  let baselineContent;
  try {
    baselineContent = git("show", `${ref}:${file}`);
  } catch {
    continue;
  }
  const baselineIds = idsFromContent(file, baselineContent);
  let currentIds = new Map();
  try {
    currentIds = idsFromContent(file, readFileSync(file, "utf8"));
  } catch {
    problems.push(`${file}: spec file deleted — its requirement IDs must be tombstoned, not removed`);
    continue;
  }
  for (const [id] of baselineIds) {
    if (!currentIds.has(id)) {
      problems.push(`${id} (${file}): existed at baseline ${ref.slice(0, 10)} but is gone — renumbering or deletion without a REQUIREMENT REMOVED tombstone`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
const count = baselineFiles.length;
console.log(`id-stability: OK — all baseline requirement IDs from ${count} spec file(s) present (baseline ${ref.slice(0, 10)})`);
