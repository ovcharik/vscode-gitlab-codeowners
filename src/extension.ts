import * as vscode from "vscode";
import { CodeownersManager } from "./codeowners-manager";
import { CodeownersFoldingProvider } from "./codeowners-folding";
import { CodeownersDiagnostics } from "./codeowners-diagnostics";
import { CodeownersCompletionProvider } from "./codeowners-completion-provider";
import { registerCommands } from "./codeowners-commands";
import { CodeownersStatusBar } from "./codeowners-status-bar";
import { WorkspacePathsCache } from "./codeowners-workspace-paths";

export function activate(context: vscode.ExtensionContext) {
  const manager = new CodeownersManager();
  const workspacePaths = new WorkspacePathsCache();
  context.subscriptions.push(manager, workspacePaths);

  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: "codeowners" },
      new CodeownersFoldingProvider(),
    ),
  );

  new CodeownersDiagnostics(context, workspacePaths);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "codeowners" },
      new CodeownersCompletionProvider(workspacePaths),
      "/",
      "@",
      " ",
    ),
  );

  registerCommands(context, manager, workspacePaths);

  context.subscriptions.push(new CodeownersStatusBar(manager));
}

export function deactivate() {}
