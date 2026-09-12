import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { findCodeownersFile } from "./codeowners-locator";
import { parseDocument } from "./codeowners-document";
import { ownersForFile } from "./codeowners-search";

export interface OwnerInfo {
  owner: string;
  section?: string;
  /** True when the granting section is optional (`^[Name]`) */
  optional?: boolean;
}

/** Description shown next to the owner label in Quick Picks and the status bar. */
export function formatOwnerDescription(o: OwnerInfo): string {
  if (!o.section || o.section === "codeowners") {
    return "";
  }
  const parts = [`section: ${o.section}`];
  if (o.optional) {
    parts.push("optional");
  }
  return `${parts.join(", ")}`;
}

/** Formats an owner as it would appear in a CODEOWNERS file rule. */
export function formatOwner(o: OwnerInfo): string {
  const description = formatOwnerDescription(o);
  if (!description) {
    return o.owner;
  }
  return `${o.owner} ${description}`;
}

/**
 * Computes code owners for a file using the extension's own parser.
 *
 * GitLab semantics: the nearest CODEOWNERS file up the tree wins
 * (nested files override root ones). Within one file, sections are
 * combined, and the last matching rule in a section wins.
 */
export class CodeownersManager implements vscode.Disposable {
  private cache = new Map<
    string,
    { version: number; parsed: ReturnType<typeof parseDocument> | undefined }
  >();

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
    const { owners, section } = ownersForFile(parsed, relativePath);
    if (owners.length === 0) {
      return undefined;
    }

    // Enrich with the metadata of the granting section (case-insensitive
    // name lookup — GitLab treats section names case-insensitively)
    const sectionMeta =
      section !== undefined
        ? parsed.find((s) => s.header?.name?.toLowerCase() === section.toLowerCase())?.header
        : undefined;
    return owners.map((owner) => ({
      owner,
      section,
      optional: sectionMeta?.optional,
    }));
  }

  private async parseFile(
    codeownersPath: string,
  ): Promise<ReturnType<typeof parseDocument> | undefined> {
    try {
      const stat = await fs.stat(codeownersPath);
      const version = stat.mtime.valueOf();

      const cached = this.cache.get(codeownersPath);
      if (cached && cached.version === version) {
        return cached.parsed;
      }

      const text = await fs.readFile(codeownersPath, "utf8");
      const parsed = parseDocument(text);
      this.cache.set(codeownersPath, { version, parsed });
      return parsed;
    } catch {
      // Deleted or unreadable CODEOWNERS: treat as "no owners available"
      return undefined;
    }
  }
}

// Helper to make a workspace-relative POSIX path regardless of platform.
function makeRelative(absoluteFilePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, absoluteFilePath);
  return rel.split(path.sep).join("/");
}
