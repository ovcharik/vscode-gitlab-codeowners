import * as vscode from "vscode";
import { CodeownersManager, formatOwner } from "./codeowners-manager";
import { SHOW_OWNERS_COMMAND_ID } from "./codeowners-commands";

const STATUS_BAR_PRIORITY = 100;

/**
 * Status bar item showing the owners of the currently active file.
 * Owns the update logic; activation wires the editor-change events.
 */
export class CodeownersStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly manager: CodeownersManager) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      STATUS_BAR_PRIORITY,
    );
    this.item.command = SHOW_OWNERS_COMMAND_ID;
    this.item.name = "CODEOWNERS for GitLab";

    this.disposables.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => void this.update()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        // Re-evaluate if the saved file is a CODEOWNERS file (its rules may change ownership)
        if (doc.fileName.endsWith("CODEOWNERS")) {
          void this.update();
        }
      }),
    );
    void this.update();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }

  private async update(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.item.hide();
      return;
    }

    const owners = await this.manager.getOwnersForFile(editor.document.fileName);
    if (owners === undefined) {
      // No CODEOWNERS file in the workspace
      this.item.hide();
      return;
    }

    if (owners.length === 0) {
      this.item.text = `$(person) Code Owners: none`;
    } else if (owners.length === 1) {
      this.item.text = `$(person) ${owners[0].owner}`;
    } else {
      this.item.text = `$(person) ${owners[0].owner} & ${owners.length - 1} more`;
    }

    const details = owners.map(formatOwner).filter(Boolean);
    this.item.tooltip = new vscode.MarkdownString(
      details.length > 0 ? details.join("\n\n") : "No code owners",
    );
    this.item.show();
  }
}
