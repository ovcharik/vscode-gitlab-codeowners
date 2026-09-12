import * as vscode from "vscode";

// Section header line: ^optional [Name] [count] owners...
const SECTION_HEADER_RE = /^\s*(\^?)\[([^\]]+)\]/;

/**
 * Provides folding ranges for CODEOWNERS files: each section folds from its
 * header line up to the line before the next section header (or EOF).
 */
export class CodeownersFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];

    const headerLines: number[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      if (SECTION_HEADER_RE.test(document.lineAt(i).text)) {
        headerLines.push(i);
      }
    }

    for (let idx = 0; idx < headerLines.length; idx++) {
      const start = headerLines[idx];
      // Hard end of the section: line before the next header, or EOF
      const hardEnd =
        idx + 1 < headerLines.length ? headerLines[idx + 1] - 1 : document.lineCount - 1;

      // Trim trailing blank lines and comments belonging to the *next* section
      // so they stay visible when the current section is folded.
      let end = hardEnd;
      while (end > start) {
        const text = document.lineAt(end).text;
        if (text.trim() === "" || text.trim().startsWith("#")) {
          end--;
        } else {
          break;
        }
      }

      if (end > start) {
        ranges.push(new vscode.FoldingRange(start, end));
      }
    }

    return ranges;
  }
}
