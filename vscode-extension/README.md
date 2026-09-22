# ARGUS Rationale for VS Code

Run **ARGUS: Analyze GitHub Commit** from the Command Palette, enter a GitHub commit URL, and provide an OpenAI API key. The extension retrieves GitHub artifacts, identifies rationale sentences, and generates a summary. Results are saved under VS Code's global storage directory in `results/<owner>__<repo>__<sha-prefix>/`.

On first command use, ARGUS creates a private Python virtual environment in VS Code global storage and installs compatible dependencies. Python 3.10 through 3.13 are supported. Later runs reuse the environment and reinstall dependencies if the extension's dependency spec changes. Setup and analysis run with progress and can be cancelled. Python can be selected with `argus.pythonPath`; `python3` (or `python` on Windows) is used by default. GitHub token is optional but recommended to avoid low unauthenticated API limits. API keys are kept in VS Code SecretStorage.

The extension package contains the pipeline source and required prompt/data files. Python wheels and spaCy's small English model (about 13 MB) are installed on first use. The extension uses this CPU-only model for sentence splitting; the command-line replication pipeline continues to use the transformer model by default. This can change sentence boundaries slightly. `GITHUB_TOKEN` and `OPENAI_API_KEY` are not required in CI packaging jobs. The original pinned replication environment remains in the root `requirements.txt`; the extension uses compatible version ranges from `requirements-extension.txt`.

## Build a VSIX

From this directory:

```sh
npm ci
npm run package -- --target linux-x64
```

Change the target to `darwin-arm64`, `darwin-x64`, `win32-x64`, or another target supported by `@vscode/vsce` to produce a platform-targeted VSIX.
