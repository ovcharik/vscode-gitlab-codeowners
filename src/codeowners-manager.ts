import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { findCodeownersFile } from "./codeowners-locator";

export interface OwnerInfo {
  owner: string;
  section?: string;
  optional?: boolean;
  approvalsNeeded?: number;
}

/**
 * Subset of the API surface of @gitlab/codeowners that we use.
 * The package is ESM-only, so we import it dynamically and type it locally.
 */
interface ParsedCodeowners {
  getOwners(filePath: string): string[];
  getOwnersDetailed(filePath: string): Array<{
    owner: string;
    type: string;
    section?: string;
    optional?: boolean;
    approvalsNeeded?: number;
  }>;
}

export class CodeownersManager implements vscode.Disposable {
  private cache = new Map<string, { version: number; parsed: ParsedCodeowners | undefined }>();

  dispose() {
    this.cache.clear();
  }

  /**
   * Get code owners for a file, searching for the nearest CODEOWNERS file
   * relative to it (GitLab semantics: nested files override root ones).
   */
  async getOwnersForFile(absoluteFilePath: string): Promise<OwnerInfo[] | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absoluteFilePath));
    if (!workspaceFolder) {
      return undefined;
    }

    const codeownersPath = findCodeownersFile(absoluteFilePath, workspaceFolder.uri.fsPath);
    if (!codeownersPath) {
      return undefined;
    }

    const parsed = await this.parseFile(codeownersPath);
    if (!parsed) {
      return undefined;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const relativePath = makeRelative(absoluteFilePath, workspaceRoot);
    const detailed = parsed.getOwnersDetailed(relativePath);
    return detailed.map((d) => ({
      owner: d.owner,
      section: d.section,
      optional: d.optional,
      approvalsNeeded: d.approvalsNeeded,
    }));
  }

  private async parseFile(codeownersPath: string): Promise<ParsedCodeowners | undefined> {
    const stat = await fs.stat(codeownersPath);
    const version = stat.mtime.valueOf();

    const cached = this.cache.get(codeownersPath);
    if (cached && cached.version === version) {
      return cached.parsed;
    }

    let parsed: ParsedCodeowners | undefined;
    try {
      // @gitlab/codeowners is an ESM package; use dynamic import from CJS.
      const { parse } = await import("@gitlab/codeowners");
      parsed = await parse(codeownersPath);
    } catch (e) {
      // Parsing errors are currently not surfaced by @gitlab/codeowners;
      // treat as "no owners available".
      void e;
      parsed = undefined;
    }

    this.cache.set(codeownersPath, { version, parsed });
    return parsed;
  }
}

// Helper to make a workspace-relative POSIX path regardless of platform.
function makeRelative(absoluteFilePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, absoluteFilePath);
  return rel.split(path.sep).join("/");
}
