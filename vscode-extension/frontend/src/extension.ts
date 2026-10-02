import * as vscode from "vscode";
import { BackendClient } from "./backend";
import { CliUpdateRequiredError, offerCliUpdate } from "./cli";
import { getGitHubCommitUrl, isCommitHash } from "./commitInput";
import { getLlmConfiguration, openConfigurationPage } from "./configuration";
import { showExplanation } from "./panel";

const GITHUB_SECRET = "githubToken";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Rationale", { log: true });
  const backend = new BackendClient(context, output);
  context.subscriptions.push(backend, output);

  context.subscriptions.push(
    vscode.commands.registerCommand("rationale.configure", () => openConfigurationPage(context, backend)),
    vscode.commands.registerCommand("rationale.explainCommit", () => explainCommit(context, backend, output)),
    vscode.commands.registerCommand("rationale.explainSelection", () => explainSelection(context, backend, output)),
    vscode.commands.registerCommand("rationale.showLog", () => output.show()),
    vscode.commands.registerCommand("rationale.repairBackend", () => repairBackend(backend)),
  );

  void setUpBackend(backend, () => backend.install());
  void showFirstUseWelcome(context);
}

async function setUpBackend(backend: BackendClient, attempt: () => Promise<void>): Promise<void> {
  try {
    await attempt();
  } catch (err) {
    const choice = await vscode.window.showErrorMessage(`Rationale backend setup failed: ${(err as Error).message}`, "Show Setup Log", "Retry");
    if (choice === "Show Setup Log") {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(backend.setupLogPath));
      await vscode.window.showTextDocument(document, { preview: false });
    }
    if (choice === "Retry") await setUpBackend(backend, () => backend.install());
  }
}

async function repairBackend(backend: BackendClient): Promise<void> {
  await setUpBackend(backend, async () => {
    await backend.repair();
    void vscode.window.showInformationMessage("Rationale backend rebuilt.");
  });
}

async function reportFailure(err: unknown, output: vscode.LogOutputChannel): Promise<void> {
  output.error((err as Error).stack || String(err));
  if (err instanceof CliUpdateRequiredError) {
    await offerCliUpdate(err);
    return;
  }
  const choice = await vscode.window.showErrorMessage(`Rationale: ${(err as Error).message}`, "Show Log");
  if (choice === "Show Log") output.show();
}

async function explainSelection(context: vscode.ExtensionContext, backend: BackendClient, output: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Select code in an editor before explaining it.");
    return;
  }
  if (editor.document.isDirty) {
    void vscode.window.showWarningMessage("Save the selected file before explaining it so Git history matches the code.");
    return;
  }
  const selection = editor.selection;
  const startLine = selection.start.line;
  const endLine = selection.end.character === 0 && selection.end.line > startLine
    ? selection.end.line - 1
    : selection.end.line;
  const code = editor.document.getText(selection);
  if (!code.trim()) {
    void vscode.window.showWarningMessage("The selection does not contain any code.");
    return;
  }

  try {
    const llm = await getLlmConfiguration(context);
    if (llm.mode === "api" && !llm.apiKey) {
      const choice = await vscode.window.showWarningMessage("Configure a provider API key before generating rationale.", "Configure");
      if (choice === "Configure") openConfigurationPage(context, backend);
      return;
    }
    const githubToken = await context.secrets.get(GITHUB_SECRET);
    const result = await backend.explainSelection({
      filePath: editor.document.uri.fsPath,
      startLine: startLine + 1,
      endLine: endLine + 1,
      code,
    }, llm, githubToken);
    showExplanation(result);
    void vscode.window.showInformationMessage(`Selection rationale saved to ${result.rationaleFile}.`);
  } catch (err) {
    void reportFailure(err, output);
  }
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

async function explainCommit(context: vscode.ExtensionContext, backend: BackendClient, output: vscode.LogOutputChannel): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: "Commit hash or GitHub commit URL to analyze (hashes use the repository's origin)",
    placeHolder: "abc1234 or https://github.com/owner/repository/commit/<sha>",
    validateInput: (value) => isCommitHash(value) || getGitHubCommitUrl(value) ? undefined : "Enter a commit hash (7–40 hexadecimal characters) or a GitHub commit URL.",
  });
  if (!input) return;

  try {
    const commitUrl = await backend.resolveCommitUrl(input);
    const existingRationale = await backend.findExistingRationale(commitUrl);
    if (existingRationale) {
      const choice = await vscode.window.showInformationMessage(
        "A rationale already exists for this commit.",
        "Open and edit",
        "Regenerate",
      );
      if (choice === "Open and edit") {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(existingRationale));
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active, preview: false });
        return;
      }
      if (choice !== "Regenerate") return;
    }

    const llm = await getLlmConfiguration(context);
    if (llm.mode === "api" && !llm.apiKey) {
      const choice = await vscode.window.showWarningMessage(
        "Configure a provider API key before generating rationale.",
        "Configure",
      );
      if (choice !== "Configure") return;
      openConfigurationPage(context, backend);
      return;
    }

    const githubToken = await context.secrets.get(GITHUB_SECRET);
    const result = await backend.explainCommit(commitUrl, llm, githubToken);
    showExplanation(result);
    void vscode.window.showInformationMessage(`Rationale saved to ${result.rationaleFile}.`);
  } catch (err) {
    void reportFailure(err, output);
  }
}

export function deactivate(): void {}
