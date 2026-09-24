# Rationale for VS Code

Run **Rationale: Search via Commit...** from the Command Palette and enter a GitHub commit URL. On first VS Code startup, the extension creates a private Python environment in global storage and installs the dependencies used by the bundled ARGUS pipeline. Setup errors appear in a notification and in the **Rationale** output channel. Analysis runs the bundled artifact retrieval, rationale identification, and summary generation scripts as one-shot Python processes; no backend web server or port is needed.

The extension asks for an OpenAI API key when needed and stores it in VS Code SecretStorage. GitHub token is optional; set `GITHUB_TOKEN` in the VS Code process environment to raise GitHub API limits. Python 3.10 through 3.14 are supported. Set `rationale.pythonPath` if `python3` (or `python` on Windows) is not the Python executable you want to use. Results are stored under the extension's global storage directory in `runtime/results/`.

## Run from source

```sh
cd vscode-extension
npm ci
npm run debug
```

This builds the extension and opens a new VS Code Extension Development Host with Rationale loaded. Use **Rationale: Search via Commit...** from its Command Palette. The first activation installs Python dependencies; running analysis requires an OpenAI API key. The existing **Run Rationale Extension** launch configuration is also available when you open this folder in VS Code and press **F5**.

## Build a VSIX

```sh
npm ci
npm run package
```

This creates one universal VSIX. The extension bundles the same Python source on every platform and installs dependencies into a private environment using the user's Python installation, so separate VSIX files per OS, architecture, or Python version are not needed. GitHub Actions checks dependency installation on Linux with Python 3.10–3.14, and on macOS and Windows with Python 3.12.
