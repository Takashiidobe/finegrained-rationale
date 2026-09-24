import * as vscode from "vscode";
import { BackendClient } from "./backend";
import { getLlmConfiguration, openConfigurationPage } from "./configuration";
import { showExplanation } from "./panel";

const GITHUB_SECRET = "githubToken";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Rationale");
  const backend = new BackendClient(context, output);
  context.subscriptions.push(backend, output);

  context.subscriptions.push(
    vscode.commands.registerCommand("rationale.configure", () => openConfigurationPage(context)),
    vscode.commands.registerCommand("rationale.explainCommit", () => explainCommit(context, backend)),
  );

  void backend.install().catch((err) => {
    output.appendLine(String(err));
    void vscode.window.showErrorMessage(`Rationale backend setup failed: ${(err as Error).message}`);
  });
  void showFirstUseWelcome(context);
}

async function showFirstUseWelcome(context: vscode.ExtensionContext): Promise<void> {
  const shown = context.globalState.get<boolean>("welcomeShown", false);
  if (shown) return;
  await context.globalState.update("welcomeShown", true);
  const choice = await vscode.window.showInformationMessage(
    "Welcome to Rationale. Choose API or CLI mode, configure provider access, or start analyzing a commit.",
    "Configure",
    "Analyze a commit",
    "Later",
  );
  if (choice === "Configure") await vscode.commands.executeCommand("rationale.configure");
  if (choice === "Analyze a commit") await vscode.commands.executeCommand("rationale.explainCommit");
}

async function explainCommit(context: vscode.ExtensionContext, backend: BackendClient): Promise<void> {
  const commitUrl = await vscode.window.showInputBox({
    prompt: "GitHub commit URL to analyze",
    placeHolder: "https://github.com/owner/repository/commit/<sha>",
    validateInput: (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/[a-fA-F0-9]+$/.test(value) ? undefined : "Enter a GitHub commit URL.",
  });
  if (!commitUrl) return;

  let llm = await getLlmConfiguration(context);
  if (llm.mode === "api" && !llm.apiKey) {
    const choice = await vscode.window.showWarningMessage(
      "Configure a provider API key before generating rationale.",
      "Configure",
    );
    if (choice !== "Configure") return;
    openConfigurationPage(context);
    return;
  }

  try {
    const githubToken = await context.secrets.get(GITHUB_SECRET);
    const result = await backend.explainCommit(commitUrl, llm, githubToken);
    showExplanation(result);
    void vscode.window.showInformationMessage(`Rationale saved to ${String(result.artifacts)}.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`Rationale: ${(err as Error).message}`);
  }
}

export function deactivate(): void {}
