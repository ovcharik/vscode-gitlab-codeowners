/**
 * Pure "search files by owner" logic — no VS Code dependencies.
 *
 * Answers: given a CODEOWNERS document and the set of repo files,
 * which files is the given owner responsible for?
 *
 * GitLab semantics (docs.gitlab.com/user/project/codeowners/reference/):
 *  - a file gets owners from every section that has a matching rule
 *    (lists are combined across sections)
 *  - within a section the last matching rule wins
 *  - `!pattern` exclusions remove a previous match in the same section
 *  - section default owners apply to every subsequent rule without owners
 */

import { parseDocument, globToRegExp, type Section } from "./codeowners-document";
import type { WorkspacePaths } from "./codeowners-lint";

export interface OwnedFile {
  /** Repo-relative file path (POSIX) */
  file: string;
  /** Section name the ownership comes from; undefined for the default section */
  section: string | undefined;
}

/** A rule with its matcher precompiled once — safe to test millions of files. */
interface CompiledEntry {
  isExclusion: boolean;
  owners: string[];
  test: (filePath: string) => boolean;
}

/** Compile a pattern into a reusable matcher (same semantics as matchesFile). */
function compileMatcher(pattern: string): (filePath: string) => boolean {
  const normPattern = pattern.startsWith("/") ? pattern : `/${pattern}`;
  if (normPattern.endsWith("/")) {
    // Directory pattern: the dir itself and everything inside.
    // Relative directories keep globstar semantics (any depth), matching
    // matchesFile in codeowners-lint — e.g. `api/` matches `pkg/api/x.ts`.
    const dir = normPattern.slice(0, -1);
    if (pattern.startsWith("/")) {
      return (f) => `/${f}`.startsWith(normPattern);
    }
    return (f) => {
      const normFile = `/${f}`;
      return normFile === dir || normFile.includes(`${dir}/`);
    };
  }
  const re = pattern.startsWith("/")
    ? globToRegExp(normPattern)
    : // relative patterns are globstar: match at any depth
      globToRegExp(`**${normPattern}`);
  return (f) => re.test(`/${f}`);
}

function compileSections(sections: Section[]): Array<{
  name: string | undefined;
  defaultOwners: string[];
  entries: CompiledEntry[];
}> {
  return sections.map((s) => ({
    name: s.header?.name,
    defaultOwners: s.header?.defaultOwners ?? [],
    entries: s.entries.map((e) => ({
      isExclusion: e.isExclusion,
      owners: e.owners,
      test: compileMatcher(e.path),
    })),
  }));
}

/** Collect all owners mentioned in the document (entries and section defaults). */
export function collectOwners(docText: string): string[] {
  const sections = parseDocument(docText);
  const seen = new Set<string>();
  for (const s of sections) {
    for (const o of s.header?.defaultOwners ?? []) seen.add(o);
    for (const e of s.entries) {
      for (const o of e.owners) seen.add(o);
    }
  }
  return [...seen].sort();
}

/**
 * Compute owners for one file from a parsed document, combining sections
 * (last match wins within a section, exclusions respected).
 * Also reports the section the ownership came from (last granting section).
 */
export function ownersForFile(
  sections: Section[],
  filePath: string,
): { owners: string[]; section: string | undefined } {
  return evalFile(compileSections(sections), filePath);
}

/**
 * Evaluate the winning ownership for one file across all compiled sections.
 *
 * Single source of truth for the GitLab "last match wins" algorithm:
 * within a section the last matching rule wins (exclusions reset the
 * match, rules without owners fall back to section defaults), lists
 * are combined across sections.
 *
 * When `owner` is given, `section` names the last section granting THAT
 * owner; otherwise the last section granting anyone.
 */
function evalFile(
  compiled: ReturnType<typeof compileSections>,
  file: string,
  owner?: string,
): { owners: string[]; section: string | undefined } {
  const owners = new Set<string>();
  let section: string | undefined;

  for (const s of compiled) {
    let current: string[] | undefined;
    for (const entry of s.entries) {
      if (!entry.test(file)) continue;
      if (entry.isExclusion) {
        current = undefined;
        continue;
      }
      current = entry.owners.length > 0 ? entry.owners : s.defaultOwners;
    }
    if (current && current.length > 0) {
      for (const o of current) owners.add(o);
      if (owner === undefined || current.includes(owner)) section = s.name;
    }
  }
  return { owners: [...owners], section };
}

/**
 * Find all repo files the given owner is responsible for.
 * Patterns are compiled once, then every file is tested against them —
 * safe for large repositories (no per-file glob compilation).
 * Result is sorted, capped at `limit`, and reports whether it was truncated.
 */
export function filesOwnedBy(
  docText: string,
  owner: string,
  ws: Pick<WorkspacePaths, "files">,
  limit = 5000,
): { files: OwnedFile[]; truncated: boolean } {
  const compiled = compileSections(parseDocument(docText));
  const files: OwnedFile[] = [];
  let truncated = false;

  for (const file of ws.files) {
    const { owners, section } = evalFile(compiled, file, owner);
    if (owners.includes(owner)) {
      files.push({ file, section });
      if (files.length > limit) {
        truncated = true;
        break;
      }
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { files: files.slice(0, limit), truncated };
}

/**
 * Async variant of {@link filesOwnedBy} that never blocks the event loop:
 * files are processed in chunks with the loop yielded between chunks, so
 * spinner animations and Quick Pick filter input stay responsive.
 * Optional `onProgress` reports the share of files processed so far (0..1).
 */
export async function filesOwnedByAsync(
  docText: string,
  owner: string,
  ws: Pick<WorkspacePaths, "files">,
  options: {
    limit?: number;
    chunkSize?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ files: OwnedFile[]; truncated: boolean }> {
  const { limit = 5000, chunkSize = 500, onProgress } = options;
  const compiled = compileSections(parseDocument(docText));
  const all = [...ws.files];
  const files: OwnedFile[] = [];
  let truncated = false;

  const considerFile = (file: string, owners: string[], section: string | undefined) => {
    if (!owners.includes(owner)) return;
    files.push({ file, section });
    if (files.length > limit) truncated = true;
  };

  for (let start = 0; start < all.length; start += chunkSize) {
    const chunk = all.slice(start, start + chunkSize);
    for (const file of chunk) {
      const { owners, section } = evalFile(compiled, file, owner);
      considerFile(file, owners, section);
      if (truncated) break;
    }
    if (onProgress) onProgress(Math.min(start + chunkSize, all.length), all.length);
    if (truncated) break;
    // Yield to the event loop between chunks, keeping the UI thread alive
    await new Promise((resolve) => setImmediate(resolve));
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { files: files.slice(0, limit), truncated };
}
