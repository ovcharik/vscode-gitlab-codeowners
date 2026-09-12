/**
 * Pure completion logic for CODEOWNERS files — no VS Code dependencies.
 *
 * Two completion contexts:
 *  - path token (first token on an entry line): repo files/directories
 *  - owner token (subsequent tokens): owners already used in the document
 */

import { OWNER_RE, splitByNonEscapedSpaces } from "./codeowners-document";
import type { WorkspacePaths } from "./codeowners-lint";

export interface CompletionCandidate {
  /** Text inserted into the document */
  label: string;
  /** Extra info shown on the right of the label */
  detail: string;
  kind: "file" | "directory" | "owner";
}

export type CompletionContextType = "path" | "owner" | null;

/** Detect what the cursor is completing on the given line (0-based col). */
export function getCompletionContext(lineText: string, col: number): CompletionContextType {
  const sliced = lineText.slice(0, col);
  // Comments — from the start of the line or inline after whitespace —
  // break the line into tokens too, so check them with the same rule.
  const commentStart = sliced.search(/(^|\s)#/);
  if (commentStart !== -1) return null;

  // Section header line: everything after `[Name]` (and optional [n])
  // consists of default owner tokens.
  if (/^\s*\^?\[[^\]]*\](?:\[\d+\])?/.test(sliced)) return "owner";

  const tokensBefore = splitByNonEscapedSpaces(sliced);
  // On a plain entry line: first token is the path, the rest are owners.
  // A trailing space means the user starts a NEW token — an owner — unless
  // the space is backslash-escaped (it is part of a path token then).
  if (tokensBefore.length === 0) return null;
  const endsWithSpace = sliced.endsWith(" ") && !sliced.endsWith("\\ ");
  return tokensBefore.length === 1 && !endsWithSpace ? "path" : "owner";
}

/**
 * Suggest repository paths matching the typed prefix.
 *
 * `prefix` is repo relative and typed (e.g. `docs`, `docs/`, `/docs/ap`).
 * Returns candidates whose label continues the typed prefix:
 *  - sibling files directly inside the typed directory
 *  - subdirectories as `dir/` (a trailing slash recommends "everything inside")
 */
export function suggestPaths(
  prefix: string,
  ws: WorkspacePaths,
  limit = 50,
): CompletionCandidate[] {
  const bare = prefix.replace(/^\//, "");
  // base = directory part the user already typed (including trailing slash)
  const base = bare.includes("/") ? bare.slice(0, bare.lastIndexOf("/") + 1) : "";
  const needle = bare.slice(base.length).toLowerCase();

  const out: CompletionCandidate[] = [];
  const seen = new Set<string>();

  for (const d of ws.directories) {
    if (!d.startsWith(base)) continue;
    const rel = d.slice(base.length);
    if (rel.includes("/")) continue; // deeper than one level — reachable in steps
    if (needle && !rel.toLowerCase().startsWith(needle)) continue;
    // Trailing slash marks "everything inside this directory"
    const label = `${rel}/`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, detail: "directory", kind: "directory" });
  }
  for (const f of ws.files) {
    if (!f.startsWith(base)) continue;
    const rel = f.slice(base.length);
    if (rel.includes("/")) continue;
    if (needle && !rel.toLowerCase().startsWith(needle)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push({ label: rel, detail: "file", kind: "file" });
  }
  return out.slice(0, limit);
}

/** Human-readable owner kind for the detail field. */
function ownerDetail(owner: string): string {
  if (owner.startsWith("@@")) return "role";
  if (owner.startsWith("@")) return "user, group or subgroup";
  return "email";
}

/** Suggest owners already used anywhere in the document (including section defaults). */
export function suggestOwners(prefix: string, docText: string, limit = 50): CompletionCandidate[] {
  const seen = new Set<string>();
  for (const token of splitByNonEscapedSpaces(docText)) {
    if (OWNER_RE.test(token)) seen.add(token);
  }
  const p = prefix.toLowerCase();
  return [...seen]
    .filter((o) => !p || o.toLowerCase().startsWith(p))
    .sort()
    .map((o) => ({ label: o, detail: ownerDetail(o), kind: "owner" as const }))
    .slice(0, limit);
}
