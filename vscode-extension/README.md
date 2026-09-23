# Rationale for VS Code

Run **Rationale: Analyze GitHub Commit...** from the Command Palette and enter a GitHub commit URL. On first VS Code startup, the extension creates a private Python environment in global storage and installs the dependencies used by the bundled ARGUS pipeline. Setup errors appear in a notification and in the **Rationale** output channel. Analysis runs the bundled artifact retrieval, rationale identification, and summary generation scripts as one-shot Python processes; no backend web server or port is needed.

The extension asks for an OpenAI API key when needed and stores it in VS Code SecretStorage. GitHub token is optional; set `GITHUB_TOKEN` in the VS Code process environment to raise GitHub API limits. Python 3.10 through 3.14 are supported. Set `rationale.pythonPath` if `python3` (or `python` on Windows) is not the Python executable you want to use. Results are stored under the extension's global storage directory in `runtime/results/`.

## Run from source

```sh
cd vscode-extension
npm ci
npm run build
```

Open this folder in VS Code and press **F5** to start an Extension Development Host. Use the Rationale command from its Command Palette. The first activation installs Python dependencies; running analysis requires an OpenAI API key.

## Build a VSIX

```sh
npm ci
npm run package -- --target linux-x64
```

Choose a target supported by `@vscode/vsce`, such as `darwin-arm64`, `darwin-x64`, or `win32-x64`.
