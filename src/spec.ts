import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Coverage, Requirement, Section, SpecFile, Violation } from "./model.js";

/** RFC 2119 keywords, longest-first so compound forms match as one unit (REQ-002.1.4). */
export const RFC2119_KEYWORDS = [
  "NOT RECOMMENDED",
  "MUST NOT",
  "SHALL NOT",
  "SHOULD NOT",
  "RECOMMENDED",
  "REQUIRED",
  "OPTIONAL",
  "SHOULD",
  "SHALL",
  "MUST",
  "MAY",
];

const KEYWORD_RE = new RegExp(`\\b(?:${RFC2119_KEYWORDS.join("|")})\\b`, "g");
const TOMBSTONE = "REQUIREMENT REMOVED";

/** Replace inline code spans so their contents are ignored (REQ-002.1.2). */
export function stripInlineCode(text: string): string {
  return text.replace(/`[^`]*`/g, "`…`");
}

export function findKeywords(text: string): string[] {
  const stripped = stripInlineCode(text);
  return stripped.match(KEYWORD_RE) ?? [];
}

function parseCoverageTag(text: string): { text: string; coverage: Coverage } {
  const match = text.match(/\s*\[(review|manual|verify)(?::\s*([^\]]*))?\]\s*$/);
  if (!match) return { text, coverage: { kind: "test" } };
  const body = text.slice(0, match.index).trimEnd();
  if (match[1] === "manual") return { text: body, coverage: { kind: "manual" } };
  if (match[1] === "verify") {
    // The whole tag body is the command — commas are part of the shell text.
    return { text: body, coverage: { kind: "verify", command: (match[2] ?? "").trim() } };
  }
  const entries = match[2]?.split(",").map((g) => g.trim()).filter(Boolean) ?? [];
  const globs: string[] = [];
  let instructions: string | undefined;
  for (const entry of entries) {
    if (entry.startsWith("instructions:")) {
      instructions = entry.slice("instructions:".length).trim();
    } else {
      globs.push(entry);
    }
  }
  return {
    text: body,
    coverage: {
      kind: "review",
      ...(globs.length ? { globs } : {}),
      ...(instructions ? { instructions } : {}),
    },
  };
}

/**
 * Parse one spec file into its requirement model, collecting structural
 * violations against REQ-001.1 and REQ-001.2 along the way.
 */
export function parseSpec(path: string, prefix: string, content?: string): SpecFile {
  const raw = content ?? readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/);
  const violations: Violation[] = [];
  const sections: Section[] = [];

  const fileBase = basename(path);
  const docIdMatch = fileBase.match(new RegExp(`^(${prefix}-\\d+)`));
  const expectedDocId = docIdMatch?.[1] ?? null;
  if (!expectedDocId) {
    violations.push({
      file: path,
      line: 1,
      rule: "REQ-001.1.1",
      message: `Spec filename must start with "${prefix}-NNN", got "${fileBase}"`,
    });
  }

  let title: string | null = null;
  let docId: string | null = null;
  let sawOverview = false;
  let sawRequirementsHeading = false;
  let overviewLine = 0;
  let requirementsLine = 0;
  let current: Section | null = null;
  // Pending list item accumulation (supports multi-line statements).
  let pending: { num: number; line: number; text: string } | null = null;

  const flushItem = () => {
    if (!pending || !current) {
      pending = null;
      return;
    }
    const { text: body, coverage } = parseCoverageTag(pending.text.trim());
    const removed = body.trim() === TOMBSTONE;
    const keywords = removed ? [] : findKeywords(body);
    const req: Requirement = {
      id: `${current.id}.${pending.num}`,
      sectionId: current.id,
      listNum: pending.num,
      line: pending.line,
      text: body,
      keywords,
      coverage,
      removed,
    };
    current.items.push(req);
    if (coverage.kind === "verify" && !coverage.command) {
      violations.push({
        file: path,
        line: pending.line,
        rule: "REQ-005.2.5",
        message: `${req.id} has a [verify] tag with no command`,
      });
    }
    if (!removed && keywords.length !== 1) {
      violations.push({
        file: path,
        line: pending.line,
        rule: "REQ-001.2.2",
        message:
          keywords.length === 0
            ? `${req.id} has no RFC 2119 keyword`
            : `${req.id} has ${keywords.length} RFC 2119 keywords (${keywords.join(", ")}); expected exactly one`,
      });
    }
    pending = null;
  };

  let inFence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // Fenced code blocks are content, not structure: headings, list items,
    // and keywords inside them are ignored entirely (REQ-002.1.1).
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      inFence = inFence === fence[1] ? null : (inFence ?? fence[1]);
      continue;
    }
    if (inFence) continue;

    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);

    if (h1 || h2 || h3) flushItem();

    if (h1 && title === null) {
      title = h1[1];
      const m = h1[1].match(new RegExp(`^(${prefix}-\\d+):\\s*\\S`));
      docId = m?.[1] ?? null;
      if (!docId || (expectedDocId && docId !== expectedDocId)) {
        violations.push({
          file: path,
          line: lineNo,
          rule: "REQ-001.1.1",
          message: `Top-level heading must be "# ${expectedDocId ?? `${prefix}-NNN`}: Title", got "# ${h1[1]}"`,
        });
      }
      continue;
    }

    if (h2) {
      current = null;
      if (h2[1].trim() === "Overview") {
        sawOverview = true;
        overviewLine = lineNo;
      } else if (h2[1].trim() === "Requirements") {
        sawRequirementsHeading = true;
        requirementsLine = lineNo;
      }
      continue;
    }

    if (h3) {
      const m = h3[1].match(new RegExp(`^(${prefix}-\\d+)\\.(\\d+):\\s*(.*)$`));
      if (!m) {
        if (sawRequirementsHeading) {
          violations.push({
            file: path,
            line: lineNo,
            rule: "REQ-001.1.3",
            message: `Section heading must be "### ${expectedDocId ?? `${prefix}-NNN`}.M: Title", got "### ${h3[1]}"`,
          });
        }
        current = null;
        continue;
      }
      const [, secDoc, secNumStr, secTitle] = m;
      const num = Number(secNumStr);
      if (expectedDocId && secDoc !== expectedDocId) {
        violations.push({
          file: path,
          line: lineNo,
          rule: "REQ-001.1.4",
          message: `Section "${secDoc}.${num}" does not match file ID "${expectedDocId}"`,
        });
      }
      current = { id: `${secDoc}.${num}`, num, title: secTitle, line: lineNo, items: [] };
      sections.push(current);
      continue;
    }

    const item = line.match(/^(\d+)\.\s+(.*)$/);
    if (item && current) {
      flushItem();
      pending = { num: Number(item[1]), line: lineNo, text: item[2] };
      continue;
    }

    if (pending) {
      if (line.trim() === "") {
        flushItem();
      } else {
        // Lazy or indented continuation of the current list item.
        pending.text += ` ${line.trim()}`;
      }
    }
  }
  flushItem();

  if (!sawOverview) {
    violations.push({ file: path, line: 1, rule: "REQ-001.1.2", message: "Missing `## Overview` section" });
  }
  if (!sawRequirementsHeading) {
    violations.push({ file: path, line: 1, rule: "REQ-001.1.3", message: "Missing `## Requirements` section" });
  } else if (sawOverview && overviewLine > requirementsLine) {
    violations.push({
      file: path,
      line: overviewLine,
      rule: "REQ-001.1.2",
      message: "`## Overview` must come before `## Requirements`",
    });
  }
  if (sawRequirementsHeading && sections.length === 0) {
    violations.push({
      file: path,
      line: requirementsLine,
      rule: "REQ-001.1.3",
      message: "`## Requirements` must contain at least one `### REQ-NNN.M` section",
    });
  }

  // Section numbering: unique and sequential from 1 (REQ-001.1.4).
  sections.forEach((sec, idx) => {
    if (sec.num !== idx + 1) {
      violations.push({
        file: path,
        line: sec.line,
        rule: "REQ-001.1.4",
        message: `Section ${sec.id} is out of sequence; expected .${idx + 1}`,
      });
    }
    // Item numbering: sequential from 1 (REQ-001.2.3).
    sec.items.forEach((req, itemIdx) => {
      if (req.listNum !== itemIdx + 1) {
        violations.push({
          file: path,
          line: req.line,
          rule: "REQ-001.2.3",
          message: `Requirement ${req.id} is out of sequence; expected item ${itemIdx + 1}`,
        });
      }
    });
  });

  return { path, docId: docId ?? expectedDocId, title, sections, violations };
}

export function allRequirements(specs: SpecFile[]): Requirement[] {
  return specs.flatMap((s) => s.sections.flatMap((sec) => sec.items));
}
