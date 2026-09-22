import * as vscode from "vscode";
import type { ExplainResult, SearchHit } from "./backend";

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

export function showSearchResults(query: string, hits: SearchHit[]): void {
  const p = getPanel();
  const items = hits
    .map(
      (hit) => `<li><strong>${escapeHtml(hit.title)}</strong> (${hit.score.toFixed(2)})<br>${escapeHtml(hit.snippet)}</li>`,
    )
    .join("\n");
  p.webview.html = `<!DOCTYPE html>
<html>
  <body>
    <h2>Results for "${escapeHtml(query)}"</h2>
    <ul>${items}</ul>
  </body>
</html>`;
  p.reveal(vscode.ViewColumn.Beside);
}
