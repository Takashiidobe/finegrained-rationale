import * as vscode from "vscode";
import type { ExplainResult } from "./backend";

let panel: vscode.WebviewPanel | undefined;

function getPanel(): vscode.WebviewPanel {
  if (panel) {
    return panel;
  }
  panel = vscode.window.createWebviewPanel(
    "rationale",
    "Rationale",
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );
  panel.onDidDispose(() => {
    panel = undefined;
  });
  return panel;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function showExplanation(result: ExplainResult): void {
  const p = getPanel();
  p.webview.html = `<!DOCTYPE html>
<html>
  <body>
    <pre>${escapeHtml(result.markdown)}</pre>
  </body>
</html>`;
  p.reveal(vscode.ViewColumn.Beside);
}
