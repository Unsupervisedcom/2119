import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Review IDs are `<req-id>--<hash12>`: the hash covers the requirement's
 * statement text plus the full content of every input file, sorted by path
 * (REQ-003.1.2). Any edit to the requirement or its evidence invalidates
 * previously recorded verdicts.
 */
export function computeReviewId(root: string, reqId: string, reqText: string, files: string[]): string {
  const h = createHash("sha256");
  h.update(reqText);
  for (const file of [...files].sort()) {
    h.update("\x00");
    h.update(file);
    h.update("\x00");
    try {
      h.update(readFileSync(join(root, file)));
    } catch {
      h.update("MISSING");
    }
  }
  return `${reqId}--${h.digest("hex").slice(0, 12)}`;
}

export function splitReviewId(reviewId: string): { requirementId: string; hash: string } | null {
  const m = reviewId.match(/^(.+)--([0-9a-f]{12})$/);
  return m ? { requirementId: m[1], hash: m[2] } : null;
}
