/**
 * Pure CODEOWNERS lint rules — no VS Code dependencies, fully testable.
 *
 * Semantics follow https://docs.gitlab.com/user/project/codeowners/reference/
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument, globToRegExp, type RuleEntry, type Section } from "./codeowners-document";

export interface LintMessage {
  /** 0-based line */
  line: number;
  /** 0-based column */
  column: number;
  length: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface WorkspacePaths {
  /** All repository-relative paths of files (POSIX-style, no trailing slash) */
  files: Set<string>;
  /** All repository-relative paths of directories (POSIX-style, no trailing slash) */
  directories: Set<string>;
}

/** Collect repo-relative files/directories from disk, skipping heavy dirs. */
export function collectWorkspacePaths(root: string): WorkspacePaths {
  const files = new Set<string>();
  const directories = new Set<string>();
  const SKIP = new Set([".git", "node_modules"]);

  const walk = (absDir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        directories.add(rel);
        walk(path.join(absDir, e.name), rel);
      } else {
        files.add(rel);
      }
    }
  };
  walk(root, "");
  return { files, directories };
}

/** Match a GitLab CODEOWNERS pattern against a repo-relative file path. */
export function matchesFile(pattern: string, filePath: string): boolean {
  const normFile = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const normPattern = pattern.startsWith("/") ? pattern : `/${pattern}`;
  if (normPattern.endsWith("/")) {
    // directory pattern: matches the dir itself and everything inside
    return normFile.startsWith(normPattern);
  }
  if (pattern.startsWith("/")) {
    // absolute pattern: match only from the repository root
    return globToRegExp(normPattern).test(normFile);
  }
  // relative patterns are globstar: match at any depth as if "**/" prefixed
  return globToRegExp(`**/${normPattern.slice(1)}`).test(normFile);
}

/** Does the pattern match at least one existing file? Directories: anything inside counts. */
export function patternHasMatches(pattern: string, ws: WorkspacePaths): boolean {
  const bare = pattern.replace(/^\//, "");
  if (pattern.endsWith("/")) {
    const dir = bare.slice(0, -1);
    for (const f of ws.files) {
      if (f === dir || f.startsWith(`${dir}/`)) return true;
    }
    return false;
  }
  const isAbsolute = pattern.startsWith("/");
  for (const f of ws.files) {
    if (matchesFile(pattern, f)) return true;
    if (!isAbsolute) {
      // relative patterns are globstar: match at any depth
      const idx = f.lastIndexOf("/");
      if (idx !== -1 && matchesFile(`/${bare}`, f)) return true;
    }
  }
  return false;
}

/** A repo-relative (non-wildcard) path existing as dir or file on disk. */
function resolvePathExists(rel: string, ws: WorkspacePaths): "file" | "directory" | null {
  const bare = rel.replace(/^\//, "").replace(/\/$/, "");
  if (ws.files.has(bare)) return "file";
  if (ws.directories.has(bare)) return "directory";
  // For relative paths (globstar), any matching suffix counts
  if (!rel.startsWith("/")) {
    for (const f of ws.files) {
      if (f.endsWith(`/${bare}`)) return "file";
    }
    for (const d of ws.directories) {
      if (d.endsWith(`/${bare}`)) return "directory";
    }
  }
  return null;
}

export function lintDocument(text: string, ws: WorkspacePaths): LintMessage[] {
  const sections = parseDocument(text);
  const messages: LintMessage[] = [];

  const push = (
    line: number,
    column: number,
    length: number,
    severity: LintMessage["severity"],
    message: string,
  ) => messages.push({ line, column, length, severity, message });

  for (const section of sections) {
    if (section.header && section.header.name === undefined) {
      push(section.header.line, 0, 1, "error", "Section heading must have a name.");
    }

    for (const entry of section.entries) {
      lintEntry(entry, section, ws, push);
    }

    lintExclusions(section, push);
  }

  lintDuplicateSections(sections, push);
  return messages;
}

function lintEntry(
  entry: RuleEntry,
  section: Section,
  ws: WorkspacePaths,
  push: (l: number, c: number, len: number, s: LintMessage["severity"], m: string) => void,
): void {
  // Zero owners (exclusions legitimately have none)
  if (!entry.owners.length && !entry.isExclusion && !hasDefaultOwners(section)) {
    push(
      entry.line,
      entry.column,
      entry.pattern.length,
      "warning",
      "Entry has no owners (@user, @group or email). Such rules never require approval (auto-approved by GitLab).",
    );
  }

  if (entry.isExclusion) return;

  const rel = entry.path;
  const kind = entry.kind;

  if (kind === "wildcard") {
    if (!patternHasMatches(rel, ws)) {
      push(
        entry.line,
        entry.column,
        entry.pattern.length,
        "warning",
        "Pattern does not match any file in the workspace.",
      );
    }
    return;
  }

  const existing = resolvePathExists(rel, ws);
  if (existing === "directory" && !rel.endsWith("/")) {
    push(
      entry.line,
      entry.column,
      entry.pattern.length,
      "error",
      `"/${rel.replace(/^\//, "")}" is a directory. Append a trailing slash (/) or the rule matches nothing inside it.`,
    );
  } else if (existing === null) {
    // For file-kind entries: with a trailing slash it must be a directory
    if (rel.endsWith("/")) {
      push(
        entry.line,
        entry.column,
        entry.pattern.length,
        "error",
        "Directory does not exist in the workspace.",
      );
    } else {
      push(
        entry.line,
        entry.column,
        entry.pattern.length,
        "warning",
        "Path does not exist in the workspace.",
      );
    }
  }
}

function hasDefaultOwners(section: Section): boolean {
  return Boolean(section.header?.defaultOwners?.length);
}

/**
 * Docs: "After a pattern is excluded, it cannot be included again in the same section."
 * Also note: exclusions apply in their section only and to files matching them.
 */
function lintExclusions(
  section: Section,
  push: (l: number, c: number, len: number, s: LintMessage["severity"], m: string) => void,
): void {
  const entries = section.entries;
  for (let i = 0; i < entries.length; i++) {
    const excl = entries[i];
    if (!excl.isExclusion) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const later = entries[j];
      if (later.isExclusion) continue;
      if (patternsOverlap(excl.path, later.path)) {
        push(
          later.line,
          later.column,
          later.pattern.length,
          "warning",
          `This rule has no effect: excluded by "!${excl.path}" above. Excluded files cannot be re-included in the same section.`,
        );
      }
    }
  }
}

/** True when any file matching `candidate` also matches `cover`. */
function patternsOverlap(cover: string, candidate: string): boolean {
  const coverAbs = cover.startsWith("/") ? cover : `/${cover}`;
  const candAbs = candidate.startsWith("/") ? candidate : `/${candidate}`;
  // Directory prefix
  if (coverAbs.endsWith("/")) {
    return candAbs.startsWith(coverAbs) || candAbs === coverAbs.slice(0, -1);
  }
  if (candAbs.endsWith("/")) {
    return coverAbs.startsWith(candAbs) || coverAbs === candAbs.slice(0, -1);
  }
  // Exact or wildcard-cover: sample with regex against a synthetic path
  if (coverAbs === candAbs) return true;
  try {
    return globToRegExp(coverAbs).test(candAbs.replace(/\/$/, ""));
  } catch {
    return false;
  }
}

function lintDuplicateSections(
  sections: Section[],
  push: (l: number, c: number, len: number, s: LintMessage["severity"], m: string) => void,
): void {
  const seen = new Map<string, number>();
  for (const s of sections) {
    const name = s.header?.name;
    if (!s.header || !name) continue;
    const key = name.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      push(
        s.header.line,
        0,
        1,
        "info",
        `Section "${name}" combines with the section on line ${first + 1} (names are case-insensitive).`,
      );
    } else {
      seen.set(key, s.header.line);
    }
  }
}
