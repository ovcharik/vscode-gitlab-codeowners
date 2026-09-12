import * as vscode from "vscode";
import type { WorkspacePaths } from "./codeowners-lint";
import { getCompletionContext, suggestOwners, suggestPaths } from "./codeowners-completion";
import type { WorkspacePathsCache } from "./codeowners-workspace-paths";

const KINDS = {
  file: vscode.CompletionItemKind.File,
  directory: vscode.CompletionItemKind.Folder,
  owner: vscode.CompletionItemKind.User,
} as const;

/**
 * Completion provider for CODEOWNERS documents:
 *  - path suggestions from the repository file tree
 *  - owner suggestions from owners already used in the document
 */
export class CodeownersCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly workspacePaths: WorkspacePathsCache) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position.line).text;
    const contextType = getCompletionContext(lineText, position.character);
    if (!contextType) return undefined;

    // Token prefix: from the start of the current token to the cursor
    const wordStart = this.tokenStart(lineText, position.character);
    const typed = lineText.slice(wordStart, position.character);

    if (contextType === "owner") {
      return suggestOwners(typed, document.getText()).map((c) =>
        this.toItem(c, position, wordStart),
      );
    }

    // Cold-cache suggestion: nothing to suggest until the tree is walked.
    // Trigger a warm-up so the NEXT keystroke already has real paths;
    // owner suggestions above work regardless of the cache.
    const ws: WorkspacePaths | undefined = this.workspacePaths.getCached();
    if (!ws) {
      this.workspacePaths.warmUp();
      return undefined;
    }

    // Paths are completed segment by segment: only the text after the
    // last "/" is replaced, so an accepted item glues onto the typed prefix
    // and VS Code filters candidates by the current segment only.
    const segmentStart = wordStart + typed.lastIndexOf("/") + 1;
    return suggestPaths(typed, ws).map((c) => {
      const item = this.toItem(c, position, segmentStart);
      // After inserting a directory (with trailing "/") immediately offer
      // candidates for the next path segment
      if (c.kind === "directory") {
        item.command = { command: "editor.action.triggerSuggest", title: "Suggest" };
      }
      return item;
    });
  }

  /** Start index of the token being typed (first non-whitespace position). */
  private tokenStart(lineText: string, col: number): number {
    let i = col;
    while (i > 0 && !/\s/.test(lineText[i - 1]!)) i--;
    return i;
  }

  private toItem(
    candidate: { label: string; detail: string; kind: keyof typeof KINDS },
    position: vscode.Position,
    replaceFrom: number,
  ): vscode.CompletionItem {
    const item = new vscode.CompletionItem(candidate.label, KINDS[candidate.kind]);
    item.detail = candidate.detail;
    // Replace the typed fragment instead of appending to it;
    // replaceFrom is either the token start (owners) or the segment start (paths)
    item.range = new vscode.Range(position.with({ character: replaceFrom }), position);
    return item;
  }
}
