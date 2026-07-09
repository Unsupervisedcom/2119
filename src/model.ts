export type CoverageKind = "test" | "review" | "manual" | "verify";

export interface Coverage {
  kind: CoverageKind;
  /** Globs for [review: <globs>] tags, relative to repo root. */
  globs?: string[];
  /** Instruction file path from [review: ..., instructions: <path>] (REQ-005.1). */
  instructions?: string;
  /** Shell command from [verify: <command>] (REQ-005.2). */
  command?: string;
}

export interface Requirement {
  /** Full stable ID, e.g. "REQ-001.2.3". */
  id: string;
  /** Section this item belongs to, e.g. "REQ-001.2". */
  sectionId: string;
  /** 1-based ordinal within the section list. */
  listNum: number;
  /** 1-based line number of the item's first line. */
  line: number;
  /** Statement text with the list marker and any coverage tag stripped. */
  text: string;
  /** All RFC 2119 keywords found outside inline code spans, longest-first. */
  keywords: string[];
  coverage: Coverage;
  /** True when the body is exactly "REQUIREMENT REMOVED". */
  removed: boolean;
}

export interface Section {
  /** e.g. "REQ-001.2" */
  id: string;
  num: number;
  title: string;
  line: number;
  items: Requirement[];
}

export interface Violation {
  file: string;
  line: number;
  /** The 2119 spec rule this violates, e.g. "REQ-001.2.2". */
  rule: string;
  message: string;
}

export interface SpecFile {
  path: string;
  /** e.g. "REQ-001" (with configured prefix). */
  docId: string | null;
  title: string | null;
  sections: Section[];
  /** Structural problems found during parsing/linting. */
  violations: Violation[];
}

export interface Annotation {
  file: string;
  line: number;
  ids: string[];
}

export type VerdictKind = "pass" | "fail";

export interface Verdict {
  reviewId: string;
  requirementId: string;
  hash: string;
  verdict: VerdictKind;
  summary: string;
  timestamp: string;
}
