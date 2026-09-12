import * as vscode from "vscode";
import { collectWorkspacePaths, type WorkspacePaths } from "./codeowners-lint";
import { getCompletionContext, suggestOwners, suggestPaths } from "./codeowners-completion";

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
  private workspacePaths: WorkspacePaths | undefined;

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

    const ws = this.getWorkspacePaths();
    if (!ws) return undefined;

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

  private getWorkspacePaths(): WorkspacePaths | undefined {
    if (this.workspacePaths) return this.workspacePaths;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return undefined;
    this.workspacePaths = collectWorkspacePaths(root);
    return this.workspacePaths;
  }
}
