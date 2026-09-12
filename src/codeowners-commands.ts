import * as vscode from "vscode";
import { CodeownersManager, formatOwnerDescription } from "./codeowners-manager";
import { WorkspacePathsCache } from "./codeowners-workspace-paths";
import { findCodeownersForRoot } from "./codeowners-locator";
import { collectOwners, filesOwnedByAsync } from "./codeowners-search";

export const SHOW_OWNERS_COMMAND_ID = "gitlab-codeowners.showOwners";
export const SEARCH_BY_OWNER_COMMAND_ID = "gitlab-codeowners.searchByOwner";

/**
 * Registers the two extension commands. Each command is a self-contained
 * function so the bootstrap in extension.ts stays declarative.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  manager: CodeownersManager,
  workspacePaths: WorkspacePathsCache,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_OWNERS_COMMAND_ID, () => showOwners(manager)),
    vscode.commands.registerCommand(SEARCH_BY_OWNER_COMMAND_ID, () =>
      searchByOwner(workspacePaths),
    ),
  );
}

async function showOwners(manager: CodeownersManager): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage(
      "GitLab CODEOWNERS: open a file first, then run this command again.",
    );
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
}

/**
 * One persistent Quick Pick: owner selection -> busy spinner -> file list.
 * The imperative API keeps the picker open while results are computed,
 * and the chunked search keeps the extension host responsive so the
 * spinner (animated by the UI process) runs smoothly.
 */
async function searchByOwner(workspacePaths: WorkspacePathsCache): Promise<void> {
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

  const quickPick = vscode.window.createQuickPick();
  try {
    quickPick.placeholder = "Search files by owner";
    quickPick.items = collectOwners(docText).map((o) => ({ label: o }));
    quickPick.matchOnDescription = true;
    quickPick.show();

    // Warm the workspace tree cache while the user is browsing owners,
    // so the search does not start with a cold blocking walk.
    void workspacePaths.get();

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
      return;
    }
    const owner = chosenOwnerOrFile;

    quickPick.busy = true;
    // Clear the typed owner name, otherwise Quick Pick keeps filtering the
    // upcoming file list by it and hides everything
    quickPick.value = "";
    quickPick.placeholder = `Searching files owned by ${owner}...`;
    quickPick.items = [];

    const ws = await workspacePaths.get();
    if (!ws) {
      vscode.window.showInformationMessage("GitLab CODEOWNERS: no workspace folder open.");
      return;
    }
    const { files, truncated } = await filesOwnedByAsync(docText, owner, ws);

    if (files.length === 0) {
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

    if (chosenFile) {
      vscode.window.showTextDocument(
        vscode.Uri.joinPath(vscode.Uri.file(root), chosenFile.replace(/^\//, "")),
      );
    }
  } finally {
    quickPick.dispose();
  }
}
