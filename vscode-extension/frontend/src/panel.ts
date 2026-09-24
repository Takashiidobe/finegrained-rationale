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
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCommitUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || !/^\/[\w.-]+\/[\w.-]+\/commit\/[a-fA-F0-9]+$/.test(url.pathname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function showExplanation(result: ExplainResult): void {
  const p = getPanel();
  const commitUrl = getCommitUrl(result.commitUrl);
  const commit = commitUrl
    ? `<a href="${escapeHtml(commitUrl)}"><code>${escapeHtml(result.commitSha.slice(0, 12))}</code></a>`
    : `<code>${escapeHtml(result.commitSha.slice(0, 12))}</code>`;
  const component = (label: string, value: string): string => `
    <section>
      <h2>${label}</h2>
      <p>${escapeHtml(value || "Not identified.")}</p>
    </section>`;
  p.webview.html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font); max-width: 900px; margin: 0 auto; padding: 24px; }
      h1 { margin-bottom: 4px; } h2 { font-size: 1.05em; letter-spacing: .04em; }
      .muted { color: var(--vscode-descriptionForeground); }
      a { color: var(--vscode-textLink-foreground); }
      section { border: 1px solid var(--vscode-panel-border); padding: 16px; margin: 16px 0; }
      section p { white-space: pre-wrap; line-height: 1.55; }
      code { color: var(--vscode-textLink-foreground); }
    </style>
  </head>
  <body>
    <h1>Commit rationale</h1>
    <p class="muted">${escapeHtml(result.repository)} · ${commit}</p>
    ${component("GOAL", result.components.GOAL)}
    ${component("NEED", result.components.NEED)}
    ${component("ALTERNATIVE", result.components.ALTERNATIVES)}
    <p class="muted">Saved to <code>${escapeHtml(result.rationaleFile)}</code></p>
  </body>
</html>`;
  p.reveal(vscode.ViewColumn.Beside);
}
