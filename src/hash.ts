import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One unit of evidence hashed into a review ID: a whole file or an annotation block. */
export interface HashPart {
  /** Stable identity for the part in the hash stream (file path, or path#block). */
  label: string;
  content: string;
}

/**
 * Review IDs are `<req-id>--<hash12>`: the hash covers the requirement's
 * statement text plus each evidence part in the caller's canonical order —
 * file path, then position within the file (REQ-003.1.2). Any edit to the
 * requirement or its evidence invalidates previously recorded verdicts.
 */
export function computeReviewId(reqId: string, reqText: string, parts: HashPart[]): string {
  const h = createHash("sha256");
  h.update(reqText);
  for (const p of parts) {
    h.update("\x00");
    h.update(p.label);
    h.update("\x00");
    h.update(p.content);
  }
  return `${reqId}--${h.digest("hex").slice(0, 12)}`;
}

/** Whole-file evidence, sorted by path — for [review]-tagged requirements (REQ-003.1.3). */
export function fileParts(root: string, files: string[]): HashPart[] {
  return [...files].sort().map((file) => ({ label: file, content: readOrMissing(root, file) }));
}

export function readOrMissing(root: string, file: string): string {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return "MISSING";
  }
}

export function splitReviewId(reviewId: string): { requirementId: string; hash: string } | null {
  const m = reviewId.match(/^(.+)--([0-9a-f]{12})$/);
  return m ? { requirementId: m[1], hash: m[2] } : null;
}
