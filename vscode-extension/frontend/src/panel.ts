import * as vscode from "vscode";
import type { ExplainResult } from "./backend";
import { referenceLabel, type RationaleComponent } from "./references";

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
  const commit = result.sourceCommits
    ? result.sourceCommits.map((source) => `<a href="${escapeHtml(source.url)}"><code>${escapeHtml(source.sha.slice(0, 12))}</code></a> (${source.lines} lines)`).join(" · ")
    : commitUrl
      ? `<a href="${escapeHtml(commitUrl)}"><code>${escapeHtml(result.commitSha.slice(0, 12))}</code></a>`
      : `<code>${escapeHtml(result.commitSha.slice(0, 12))}</code>`;
  const references = result.references || [];
  const marker = (number: number): string => references.some(reference => reference.number === number)
    ? `<sup><a href="#source-${number}">${number}</a></sup>` : "";
  const renderText = (value: string): string => escapeHtml(value).replace(/\[\^(\d+)\]/g, (_, number: string) => marker(Number(number)));
  const component = (label: string, value: string, key: RationaleComponent): string => `
    <section>
      <h2>${label}</h2>
      <p>${renderText(value || "Not identified.")}</p>
      ${result.evidence?.[key]?.length ? `<p class="muted">ARGUS ${key} evidence: ${result.evidence[key]!.map(marker).join(" ")}</p>` : ""}
    </section>`;
  const sources = references.length ? `<section><h2>References</h2><ol>${references.map(reference => `
    <li id="source-${reference.number}"><a href="${escapeHtml(reference.url)}">${escapeHtml(referenceLabel(reference.source))}</a> · ARGUS sentence <code>${escapeHtml(reference.sentenceId)}</code><p>${escapeHtml(reference.sentence)}</p></li>`).join("")}</ol></section>` : "";
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
    <h1>${escapeHtml(result.title || "Commit rationale")}</h1>
    <p class="muted">${escapeHtml(result.repository)} · ${commit}</p>
    ${component("GOAL", result.components.GOAL, "GOAL")}
    ${component("NEED", result.components.NEED, "NEED")}
    ${component("ALTERNATIVE", result.components.ALTERNATIVES, "ALTERNATIVES")}
    ${sources}
    <p class="muted">Saved to <code>${escapeHtml(result.rationaleFile)}</code></p>
  </body>
</html>`;
  p.reveal(vscode.ViewColumn.Beside);
}
