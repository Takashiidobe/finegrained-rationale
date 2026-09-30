# Rationale for VS Code

Run **Rationale: Search via Commit...** from the Command Palette and enter a GitHub commit URL, or select code in an editor and run **Rationale: Explain Selected Code**. The selection command attributes selected lines with `git blame`, analyzes up to the three commits that account for the most selected lines, and synthesizes their rationales with the selected code. It currently expects the selected code to be committed and the repository's `origin` to be a GitHub remote. On first VS Code startup, Rationale offers setup and creates a private Python environment in global storage. First-time **Rationale: Configure** guides you through choosing a mode and provider, connecting and loading models, then optionally adding GitHub access. Later visits show the full editable configuration page.

API mode calls OpenAI or Anthropic directly and uses provider API billing. The setup checks an API key by requesting the models available to that account, then shows the live model list. Keys are kept in VS Code SecretStorage only after setup is finished. CLI mode invokes an installed and signed-in Codex or Claude Code CLI and uses its account's plan allowance. Codex refreshes from its local model catalog. Claude Code offers its documented current model IDs and account aliases; account availability can vary. CLI credentials are handled by the CLI itself. A custom model ID remains available if it is not listed. GitHub access is optional for public repositories and needed for private repositories. A classic GitHub token needs the `repo` scope; a fine-grained token needs read access to Contents, Issues, and Pull requests for the repository.

Setup errors appear in a notification and in the **Rationale** output channel. Analysis runs the bundled artifact retrieval, rationale identification, and summary generation scripts as one-shot Python processes; no backend web server or port is needed. Rationale displays GOAL, NEED, and ALTERNATIVE sections and writes a shareable Markdown file to `.rationale/commit-<short-sha>.md` at the root of the open Git repository. Rationale identification defaults to one run; change `rationale.runs` to use repeated runs and majority voting. On first use Rationale downloads a pinned copy of [uv](https://github.com/astral-sh/uv), which installs a private Python 3.14 and the locked backend dependencies; your system Python is never used, and everything lives under the extension's global storage directory. If GitHub releases are unreachable, install uv yourself and set `rationale.uvPath`. The full log of the last setup attempt is saved to `logs/setup.log` in global storage (the error notification links to it); **Rationale: Show Log** opens the output channel and **Rationale: Repair Backend** rebuilds the environment. CLI mode requires Codex CLI 0.159.2+ or Claude Code 2.1.285+; saving a CLI configuration sends one short test prompt through the CLI. Raw analysis artifacts are stored under the extension's global storage directory in `runtime/results/`.

## Run from source

```sh
cd vscode-extension
npm ci
npm run debug
```

This builds the extension and opens a new VS Code Extension Development Host with Rationale loaded. Use **Rationale: Configure** to enter credentials, **Rationale: Search via Commit...** to analyze a commit, or select code and use **Rationale: Explain Selected Code**. The first activation installs Python dependencies. The existing **Run Rationale Extension** launch configuration is also available when you open this folder in VS Code and press **F5**.

## Build a VSIX

```sh
npm ci
npm run package
```

This creates one universal VSIX. The extension bundles the same Python source on every platform and installs dependencies into a private environment using the user's Python installation, so separate VSIX files per OS, architecture, or Python version are not needed. GitHub Actions checks dependency installation on Linux with Python 3.10–3.14, and on macOS and Windows with Python 3.12.
