/**
 * Lightweight line-oriented CODEOWNERS document model with positions.
 *
 * Built for diagnostics: unlike @gitlab/codeowners, this parser keeps
 * line numbers, so we can place squiggles precisely.
 *
 * Follows https://docs.gitlab.com/user/project/codeowners/reference/
 */

export interface RuleEntry {
  /** 0-based line number */
  line: number;
  /** Column of the pattern start (after optional leading spaces) */
  column: number;
  /** Original pattern token as written (with leading ! if exclusion) */
  pattern: string;
  /** Pattern without the ! exclusion prefix */
  path: string;
  /** True when the pattern starts with `!` */
  isExclusion: boolean;
  /** Entry kind derived from the pattern shape */
  kind: "file" | "directory" | "wildcard";
  /** Owners as written (excluding approval-count-like tokens) */
  owners: string[];
}

export interface SectionHeader {
  /** 0-based line number */
  line: number;
  /** Section name; undefined for the unnamed default section */
  name: string | undefined;
  /** True when `^[name]` */
  optional: boolean;
  /** Approval count from `[name][n]`; 1 when absent */
  approvalsNeeded: number;
  /** Default owners defined on the header line */
  defaultOwners: string[];
}

export interface Section {
  header: SectionHeader | undefined;
  entries: RuleEntry[];
}

const SECTION_RE = /^\s*(\^?)\[([^\]]*)\](?:\[(\d+)\])?\s*(.*)$/;
/**
 * Token that looks like a valid owner: @user, @group/sub, @@role, email.
 * Uses Unicode property escapes so non-Latin usernames (e.g. Cyrillic)
 * are recognized as owners by the linter and completions.
 */
export const OWNER_RE =
  /^(?:@[\p{L}\p{N}./_-]+|@@[\p{L}\p{N}_-]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;

/** Split a line by non-escaped spaces (backslash-escaped spaces stay in token). */
export function splitByNonEscapedSpaces(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length) {
      current += line[i + 1];
      i++;
    } else if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseDocument(text: string): Section[] {
  const sections: Section[] = [{ header: undefined, entries: [] }];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = SECTION_RE.exec(raw);
    if (sectionMatch) {
      const [, optionalMark, name, count, ownersPart] = sectionMatch;
      const defaultOwners = ownersPart
        ? splitByNonEscapedSpaces(ownersPart).filter((t) => OWNER_RE.test(t))
        : [];
      sections.push({
        header: {
          line: i,
          name: name.trim() || undefined,
          optional: optionalMark === "^",
          approvalsNeeded: count ? parseInt(count, 10) : 1,
          defaultOwners,
        },
        entries: [],
      });
      continue;
    }

    const tokens = splitByNonEscapedSpaces(trimmed);
    const pattern = tokens.shift() ?? "";
    const owners = tokens.filter((t) => OWNER_RE.test(t));
    const isExclusion = pattern.startsWith("!");
    const path = pattern.replace(/^!/, "");
    const indent = raw.search(/\S/);
    sections[sections.length - 1].entries.push({
      line: i,
      // Column of the pattern itself; skip the `!` marker to point at the path
      column: indent + (isExclusion ? 1 : 0),
      pattern,
      path,
      isExclusion,
      kind: path.includes("*") ? "wildcard" : path.endsWith("/") ? "directory" : "file",
      owners,
    });
  }

  return sections;
}

/** Match a GitLab CODEOWNERS path pattern against a repository-relative file path. */
export function matchPattern(pattern: string, filePath: string): boolean {
  // Directory path: trailing slash matches everything inside
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern);
  }
  const regex = globToRegExp(pattern);
  return regex.test(filePath);
}

/** Convert a GitLab fnmatch-style glob (FNM_PATHNAME | FNM_DOTMATCH) to RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // globstar "**" matches across separators; when written as "**/",
        // it spans whole path segments: "a/**/b" matches "a/b", "a/x/b", ...
        let j = i + 1; // second '*'
        if (pattern[j + 1] === "/") {
          re += "(?:.*/)?";
          i = j + 1; // stop on '/', consumed by the loop increment
        } else {
          re += ".*";
          i = j; // stop on second '*', consumed by the loop increment
        }
      } else {
        // * does not match /
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if ("[](){}+^$.|\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}
