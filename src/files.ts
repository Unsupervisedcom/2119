import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import picomatch from "picomatch";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".2119", ".deepwork", "coverage", ".venv", "__pycache__"]);

/** Recursively list repo-relative file paths (posix separators), skipping vendor/state dirs. */
export function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".git")) visit(join(dir, entry.name));
      } else if (entry.isFile()) {
        out.push(relative(root, join(dir, entry.name)).split(sep).join("/"));
      }
    }
  };
  visit(root);
  return out.sort();
}

export function matchGlobs(paths: string[], globs: string[]): string[] {
  if (globs.length === 0) return [];
  const isMatch = picomatch(globs, { dot: true });
  return paths.filter((p) => isMatch(p));
}
