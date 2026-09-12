import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Exact relative locations where GitLab looks for a CODEOWNERS file,
 * in order of precedence (most specific wins).
 * @see https://docs.gitlab.com/ee/user/project/codeowners/#codeowners-file-location
 */
export const CODEOWNERS_RELATIVE_PATHS = [
  path.join("CODEOWNERS"),
  path.join("docs", "CODEOWNERS"),
  path.join(".gitlab", "CODEOWNERS"),
];

/**
 * Find the nearest CODEOWNERS file for a given absolute file path,
 * walking up from the file's directory to the workspace root.
 */
export function findCodeownersFile(
  absoluteFilePath: string,
  workspaceRoot: string,
): string | undefined {
  let dir = path.dirname(absoluteFilePath);
  const root = path.resolve(workspaceRoot);

  for (;;) {
    for (const rel of CODEOWNERS_RELATIVE_PATHS) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    if (path.resolve(dir) === root) {
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}
