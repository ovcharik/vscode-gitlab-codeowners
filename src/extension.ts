import * as vscode from "vscode";
import { CodeownersManager, type OwnerInfo } from "./codeowners-manager";
import { CodeownersFoldingProvider } from "./codeowners-folding";
import { CodeownersDiagnostics } from "./codeowners-diagnostics";
import { CodeownersCompletionProvider } from "./codeowners-completion-provider";
const COMMAND_ID = "gitlab-codeowners.showOwners";
const STATUS_BAR_PRIORITY = 100;

export function activate(context: vscode.ExtensionContext) {
  const manager = new CodeownersManager();
  context.subscriptions.push(manager);

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: "codeowners" },
      new CodeownersFoldingProvider(),
    ),
  );

  new CodeownersDiagnostics(context);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "codeowners" },
      new CodeownersCompletionProvider(),
      "/",
      "@",
      " ",
    ),
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY,
  );
  statusBarItem.command = COMMAND_ID;
  statusBarItem.name = "GitLab CODEOWNERS";
  context.subscriptions.push(statusBarItem);

  const showOwnersCommand = vscode.commands.registerCommand(COMMAND_ID, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const owners = await manager.getOwnersForFile(editor.document.fileName);
    if (!owners || owners.length === 0) {
      vscode.window.showInformationMessage(
        "GitLab CODEOWNERS: no owners found for the current file.",
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      owners.map((o) => ({
        label: o.owner,
        description: formatOwnerDescription(o),
      })),
      { placeHolder: "Code owners of the current file" },
    );
    if (pick) {
      vscode.env.clipboard.writeText(pick.label);
    }
  });
  context.subscriptions.push(showOwnersCommand);

  const updateStatusBar = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      statusBarItem.hide();
      return;
    }

    const owners = await manager.getOwnersForFile(editor.document.fileName);
    if (owners === undefined) {
      // No CODEOWNERS file in the workspace
      statusBarItem.hide();
      return;
    }

    if (owners.length === 0) {
      statusBarItem.text = `$(person) Code Owners: none`;
    } else if (owners.length === 1) {
      statusBarItem.text = `$(person) ${owners[0].owner}`;
    } else {
      statusBarItem.text = `$(person) ${owners[0].owner} & ${owners.length - 1} more`;
    }

    const details = owners.map(formatOwner).filter(Boolean);
    statusBarItem.tooltip = new vscode.MarkdownString(
      details.length > 0 ? details.join("\n\n") : "No code owners",
    );
    statusBarItem.show();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      // Re-evaluate if the saved file is a CODEOWNERS file (its rules may change ownership)
      if (doc.fileName.endsWith("CODEOWNERS")) {
        void updateStatusBar();
      }
    }),
  );

  void updateStatusBar();
}

// Formats owners as it would appear in a CODEOWNERS file rule
function formatOwner(o: OwnerInfo): string {
  const description = formatOwnerDescription(o);
  if (!description) {
    return o.owner;
  }
  return `${o.owner} ${description}`;
}

// Description shown next to the owner label in the Quick Pick:
// section: Section, optional
function formatOwnerDescription(o: OwnerInfo): string {
  if (!o.section || o.section === "codeowners") {
    return "";
  }
  const parts = [`section: ${o.section}`];
  if (o.optional) {
    parts.push("optional");
  }
  return `${parts.join(", ")}`;
}

export function deactivate() {}
