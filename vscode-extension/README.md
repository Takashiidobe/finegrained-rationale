# Rationale for VS Code

Extension version: **0.1.4**.

Rationale explains the reasoning behind code changes and selected code, then
saves results as Markdown in `.rationale/` at your repository root.

## Features

From the Command Palette, run **Rationale: Search via Commit...** and enter a
GitHub commit URL or commit hash. Hashes use the repository GitHub's `origin`
remote.

To refresh rationale later, run **Rationale: Search via Commit...**,
enter the same command for that commit again and
choose **Regenerate** when prompted. Rationale retrieves the current GitHub
context and replaces the saved Markdown for that commit. Choose **Open and
edit** to revise the existing Markdown by hand.

Otherwise, select code in VS Code and run **Rationale: Explain Selected Code**.
Rationale uses Git blame to find the commits behind the selected lines, then
analyzes those commits and the code. Selected code must be committed, and the
repository's `origin` must point to GitHub for Rationale to pick up
artifacts related to the code.

## Configuration

Run **Rationale: Configure** from the Command Palette. Provide an API
Key from OpenAI or Anthropic or a signed-in Codex or Claude Code CLI,
select a model, and test the connection before saving.

GitHub access is optional for public repositories and required for private
ones.

If you want to use this extension for a private repo, add a token with
access to the repository so ARGUS can gather its artifacts. To create a
fine-grained token, open
[GitHub's token settings](https://github.com/settings/personal-access-tokens),
choose the private repository under **Repository access**, and grant
read-only access to **Contents**, **Issues**, and **Pull requests** under
**Repository permissions**. Generate and copy the token, then paste it into
the GitHub access field in Rationale's configuration. A classic token needs
the `repo` scope instead.

## Troubleshooting

Setup and analysis errors appear in the **Rationale** output channel. Run
**Rationale: Show Log** to view it. For backend setup problems, run
**Rationale: Repair Backend**.

When reporting a problem, attach your Rationale and VS Code versions and the
error from the output channel and create a [new issue]
(https://github.com/sea-lab-wm/finegrained-rationale/issues/new).

## Settings

- `rationale.runs`: Number of rationale identification runs; defaults to `1`.
- `rationale.uvPath`: Optional path to an installed `uv` executable, useful if
  Rationale cannot download its bundled copy.

See [PUBLISHING.md](PUBLISHING.md) for building and publishing the extension.
