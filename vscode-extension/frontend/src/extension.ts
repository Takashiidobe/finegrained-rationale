import * as vscode from "vscode";
import { blameRange } from "./blame";
import { enclosingSymbol } from "./symbols";
import { BackendClient } from "./backend";
import { showExplanation, showSearchResults } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Rationale");
  const backend = new BackendClient(output);
  context.subscriptions.push(backend, output);
  void backend.start();

  context.subscriptions.push(
    vscode.commands.registerCommand("rationale.explainSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Rationale: no active editor.");
        return;
      }

      const selection = editor.selection;
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      try {
        const symbol = await enclosingSymbol(editor.document, selection);
        const hashes = await blameRange(editor.document.uri.fsPath, startLine, endLine);
        if (hashes.length === 0) {
          vscode.window.showInformationMessage("Rationale: no commits found for this range.");
          return;
        }

        const label = symbol ? `${symbol.name} ` : "";
        output.appendLine(`Explaining ${label}(${startLine}-${endLine}): ${hashes.join(", ")}`);

        const result = await backend.explainSpan(editor.document.uri.fsPath, hashes);
        showExplanation(result);
      } catch (err) {
        vscode.window.showErrorMessage(`Rationale: ${(err as Error).message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rationale.explainCommit", async () => {
      const commitHash = await vscode.window.showInputBox({
        prompt: "Commit hash to explain",
      });
      if (!commitHash) {
        return;
      }

      try {
        const result = await backend.explainCommit(commitHash);
        showExplanation(result);
      } catch (err) {
        vscode.window.showErrorMessage(`Rationale: ${(err as Error).message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("rationale.search", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search rationale notes",
      });
      if (!query) {
        return;
      }

      try {
        const hits = await backend.search(query);
        showSearchResults(query, hits);
      } catch (err) {
        vscode.window.showErrorMessage(`Rationale: ${(err as Error).message}`);
      }
    }),
  );
}

export function deactivate(): void {}
