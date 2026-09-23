import * as vscode from "vscode";
import { BackendClient } from "./backend";
import { showExplanation } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Rationale");
  const backend = new BackendClient(context, output);
  context.subscriptions.push(backend, output);
  void backend.install().catch((err) => {
    output.appendLine(String(err));
    void vscode.window.showErrorMessage(`Rationale backend setup failed: ${(err as Error).message}`);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("rationale.explainCommit", async () => {
      const commitUrl = await vscode.window.showInputBox({
        prompt: "GitHub commit URL to analyze",
        placeHolder: "https://github.com/owner/repository/commit/<sha>",
        validateInput: (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/[a-fA-F0-9]+$/.test(value) ? undefined : "Enter a GitHub commit URL.",
      });
      if (!commitUrl) {
        return;
      }

      const apiKeyName = "openaiApiKey";
      let apiKey = await context.secrets.get(apiKeyName);
      if (!apiKey) {
        apiKey = await vscode.window.showInputBox({ prompt: "OpenAI API key", password: true, ignoreFocusOut: true });
        if (apiKey) await context.secrets.store(apiKeyName, apiKey);
      }
      if (!apiKey) return;

      try {
        const result = await backend.explainCommit(commitUrl, apiKey);
        showExplanation(result);
        void vscode.window.showInformationMessage(`Rationale saved to ${String(result.artifacts)}.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Rationale: ${(err as Error).message}`);
      }
    }),
  );

}

export function deactivate(): void {}
