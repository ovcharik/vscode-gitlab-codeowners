import * as vscode from "vscode";
import { CodeownersManager, type OwnerInfo } from "./codeowners-manager";
import { CodeownersFoldingProvider } from "./codeowners-folding";
import { CodeownersDiagnostics } from "./codeowners-diagnostics";
import { CodeownersCompletionProvider } from "./codeowners-completion-provider";
import { findCodeownersForRoot } from "./codeowners-locator";
import { collectWorkspacePaths } from "./codeowners-lint";
import { collectOwners, filesOwnedByAsync } from "./codeowners-search";
const COMMAND_ID = "gitlab-codeowners.showOwners";
const SEARCH_COMMAND_ID = "gitlab-codeowners.searchByOwner";
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

  const searchByOwnerCommand = vscode.commands.registerCommand(SEARCH_COMMAND_ID, async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showInformationMessage("GitLab CODEOWNERS: no workspace folder open.");
      return;
    }
    const codeownersPath = findCodeownersForRoot(root);
    if (!codeownersPath) {
      vscode.window.showInformationMessage("GitLab CODEOWNERS: no CODEOWNERS file found.");
      return;
    }
    const docText = await vscode.workspace.fs
      .readFile(vscode.Uri.file(codeownersPath))
      .then((b) => Buffer.from(b).toString("utf8"));

    // One persistent Quick Pick: owner selection -> busy spinner -> file list.
    // The imperative API keeps the picker open while results are computed,
    // and the chunked search keeps the extension host responsive so the
    // spinner (animated by the UI process) runs smoothly.
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = "Search files by owner";
    quickPick.items = collectOwners(docText).map((o) => ({ label: o }));
    quickPick.matchOnDescription = true;
    quickPick.show();

    const chosenOwnerOrFile: string | undefined = await new Promise((resolve) => {
      quickPick.onDidChangeSelection((selection) => {
        const [first] = selection;
        if (!first) return;
        if (quickPick.busy) return; // ignore stray picks while searching
        resolve(first.label);
      });
      quickPick.onDidHide(() => resolve(undefined));
    });

    // The user closed the picker without choosing an owner
    if (!chosenOwnerOrFile) {
      quickPick.dispose();
      return;
    }
    const owner = chosenOwnerOrFile;

    quickPick.busy = true;
    // Clear the typed owner name, otherwise Quick Pick keeps filtering the
    // upcoming file list by it and hides everything
    quickPick.value = "";
    quickPick.placeholder = `Searching files owned by ${owner}...`;
    quickPick.items = [];

    const { files, truncated } = await filesOwnedByAsync(
      docText,
      owner,
      collectWorkspacePaths(root),
    );

    if (files.length === 0) {
      quickPick.hide();
      quickPick.dispose();
      vscode.window.showInformationMessage(`GitLab CODEOWNERS: no files owned by ${owner}.`);
      return;
    }

    quickPick.busy = false;
    quickPick.placeholder = `${files.length} file${files.length === 1 ? "" : "s"} owned by ${owner}${truncated ? " (list truncated)" : ""}`;
    quickPick.items = files.map((f) => ({
      label: f.file,
      description: f.section ? `section: ${f.section}` : "",
    }));

    const chosenFile: string | undefined = await new Promise((resolve) => {
      quickPick.onDidChangeSelection((selection) => {
        const [first] = selection;
        if (!first || quickPick.busy) return;
        resolve(first.label);
      });
      quickPick.onDidHide(() => resolve(undefined));
    });
    quickPick.dispose();

    if (chosenFile) {
      vscode.window.showTextDocument(
        vscode.Uri.joinPath(vscode.Uri.file(root), chosenFile.replace(/^\//, "")),
      );
    }
  });
  context.subscriptions.push(searchByOwnerCommand);

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
