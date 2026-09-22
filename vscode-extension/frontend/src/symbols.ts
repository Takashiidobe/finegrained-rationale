import * as vscode from "vscode";

export async function enclosingSymbol(
  document: vscode.TextDocument,
  range: vscode.Range,
): Promise<vscode.DocumentSymbol | undefined> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
    "vscode.executeDocumentSymbolProvider",
    document.uri,
  );
  if (!symbols) {
    return undefined;
  }

  let best: vscode.DocumentSymbol | undefined;

  const visit = (candidates: vscode.DocumentSymbol[]) => {
    for (const symbol of candidates) {
      if (symbol.range.contains(range)) {
        best = symbol;
        visit(symbol.children);
      }
    }
  };
  visit(symbols);

  return best;
}
