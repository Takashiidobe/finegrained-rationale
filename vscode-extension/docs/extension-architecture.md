# Extension architecture

The VS Code frontend runs ARGUS to explain a commit or selected code. It shows
GOAL, NEED, and ALTERNATIVE components in a panel and saves Markdown under
`.rationale/` in the repository.

## Run from source

From the repository root:

```sh
npm ci
npm run debug
```

## Runtime flow

On activation, the extension registers commands and prepares a private Python
environment using uv. It launches bundled ARGUS scripts as short-lived
processes; there is no backend server. **Rationale: Repair Backend** rebuilds
the environment if setup fails.

**Rationale: Configure** saves the provider and model in extension state, and
stores API keys and the optional GitHub token in VS Code SecretStorage. Test the
connection before saving. API mode supports OpenAI and Anthropic; CLI mode uses
the selected installed CLI provider.

Commit analysis retrieves artifacts, identifies rationale sentences, and
generates one rationale summary. Selected-code analysis uses `git blame` to
choose up to three contributing commits, runs those same stages for each, then
synthesizes their summaries for the selected code. See `files.md` for prompt
sources and pipeline file responsibilities.

The frontend formats citations, displays the result, and saves Markdown under
`.rationale/`. Use **Rationale: Show Log** for analysis errors; setup failures
offer a setup log and retry.
