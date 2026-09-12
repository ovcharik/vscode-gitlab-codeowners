import * as vscode from "vscode";
import { lintDocument, collectWorkspacePaths, type WorkspacePaths } from "./codeowners-lint";

/**
 * Thin VS Code wrapper around the pure lint rules:
 * converts LintMessage positions into Diagnostics.
 */
export class CodeownersDiagnostics {
  private collection: vscode.DiagnosticCollection;
  private workspacePaths: WorkspacePaths | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.collection = vscode.languages.createDiagnosticCollection("gitlab-codeowners");
    context.subscriptions.push(this.collection);

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((d) => this.validate(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.validate(e.document)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.workspacePaths = undefined;
      }),
    );
    // Re-validate files that are already open (e.g. after activation)
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "codeowners") void this.validate(doc);
    }
  }

  private isCodeownersDocument(document: vscode.TextDocument): boolean {
    if (document.languageId === "codeowners") return true;
    return (
      document.uri.scheme === "file" &&
      document.fileName.endsWith("CODEOWNERS") &&
      document.languageId === "plaintext"
    );
  }

  private getWorkspacePaths(): WorkspacePaths | undefined {
    if (this.workspacePaths) return this.workspacePaths;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return undefined;
    this.workspacePaths = collectWorkspacePaths(root);
    return this.workspacePaths;
  }

  validate(document: vscode.TextDocument) {
    if (!this.isCodeownersDocument(document)) return;

    const ws = this.getWorkspacePaths();
    const messages = lintDocument(
      document.getText(),
      ws ?? { files: new Set<string>(), directories: new Set<string>() },
    );

    const diagnostics = messages.map((m) => {
      const range = new vscode.Range(m.line, m.column, m.line, m.column + Math.max(m.length, 1));
      const severity =
        m.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : m.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;
      return new vscode.Diagnostic(range, m.message, severity);
    });

    this.collection.set(document.uri, diagnostics);
  }
}
