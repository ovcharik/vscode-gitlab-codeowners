import * as vscode from "vscode";
import { lintDocument } from "./codeowners-lint";
import { WorkspacePathsCache } from "./codeowners-workspace-paths";

/**
 * Thin VS Code wrapper around the pure lint rules:
 * converts LintMessage positions into Diagnostics.
 */
export class CodeownersDiagnostics {
  private collection: vscode.DiagnosticCollection;
  /** Pending debounce timers per document URI */
  private pending = new Map<vscode.Uri, ReturnType<typeof setTimeout>>();
  private static readonly DEBOUNCE_MS = 300;

  constructor(
    context: vscode.ExtensionContext,
    private readonly workspacePaths: WorkspacePathsCache,
  ) {
    this.collection = vscode.languages.createDiagnosticCollection("gitlab-codeowners");
    context.subscriptions.push(this.collection);
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider({ language: "codeowners" }, this, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }),
    );

    const validateDebounced = (doc: vscode.TextDocument) => {
      const previous = this.pending.get(doc.uri);
      if (previous) clearTimeout(previous);
      this.pending.set(
        doc.uri,
        setTimeout(() => {
          this.pending.delete(doc.uri);
          // The document may have been closed while the timer was pending —
          // re-setting diagnostics for a closed file would leave ghosts
          // in the Problems panel that nothing cleans up afterwards.
          if (doc.isClosed) return;
          this.validate(doc);
        }, CodeownersDiagnostics.DEBOUNCE_MS),
      );
    };

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((d) => this.validate(d)),
      vscode.workspace.onDidChangeTextDocument((e) => validateDebounced(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.collection.delete(d.uri);
        // Drop a pending timer: the debounced validate would run on a closed doc
        const previous = this.pending.get(d.uri);
        if (previous) {
          clearTimeout(previous);
          this.pending.delete(d.uri);
        }
      }),
      {
        dispose: () => {
          for (const t of this.pending.values()) clearTimeout(t);
          this.pending.clear();
        },
      },
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

  private async validate(document: vscode.TextDocument): Promise<void> {
    if (!this.isCodeownersDocument(document)) return;

    // Cold start on a big repo: await the (chunked, non-blocking) walk
    // instead of linting against an empty tree full of false "not found"s.
    const ws = await this.workspacePaths.get();
    // The user may have closed the document while the walk was running
    if (document.isClosed) return;

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
      const diagnostic = new vscode.Diagnostic(range, m.message, severity);
      if (m.code) diagnostic.code = m.code;
      return diagnostic;
    });

    this.collection.set(document.uri, diagnostics);
  }

  /** Quick fixes for our own diagnostics. */
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] | undefined {
    if (!this.isCodeownersDocument(document)) return undefined;
    const diagnostics: readonly vscode.Diagnostic[] = this.collection.get(document.uri) ?? [];
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      if (!diagnostic.range.intersection(range)) continue;
      const action = this.quickFixFor(document, diagnostic);
      if (action) actions.push(action);
    }
    return actions.length > 0 ? actions : undefined;
  }

  private quickFixFor(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction | undefined {
    switch (diagnostic.code) {
      case "need-trailing-slash": {
        const edit = new vscode.WorkspaceEdit();
        const pos = diagnostic.range.end;
        edit.insert(document.uri, pos, "/");
        const action = new vscode.CodeAction(
          "Append trailing slash (/)",
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [diagnostic];
        action.edit = edit;
        return action;
      }
      case "exclude-redundant": {
        const edit = new vscode.WorkspaceEdit();
        edit.delete(document.uri, diagnostic.range);
        const action = new vscode.CodeAction(
          "Remove ineffective rule",
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [diagnostic];
        action.edit = edit;
        return action;
      }
      default:
        return undefined;
    }
  }
}
