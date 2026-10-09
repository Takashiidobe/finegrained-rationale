# Extension flows

The extension analyzes a GitHub commit or selected code and produces a rationale
with GOAL, NEED, and ALTERNATIVES components. It displays the result in a VS
Code panel and saves it as Markdown under `.rationale/` in the repository.

## Set up the backend

On activation, the extension prepares a Python environment in VS Code global
storage. It installs the locked dependencies with `uv`; setup failures offer a
setup log and retry, and **Rationale: Repair Backend** rebuilds the environment.

The backend runs locally as short-lived Python processes. The extension launches
ARGUS pipeline scripts through `runner.py`, passes model configuration and
credentials through the child process environment, and reads JSON results from
the runtime results directory. It does not start a server.

## Configure a model

**Rationale: Configure** lets you choose API or CLI execution mode, a provider,
and a model. API mode uses a saved provider key; CLI mode uses the selected
provider's installed and signed-in command-line tool. The optional GitHub token
is used to retrieve artifacts from private repositories. Credentials are stored
in VS Code SecretStorage.

## Explain a commit

Run **Rationale: Search via Commit...** and enter a GitHub commit URL or a
commit hash. A hash is combined with the repository's GitHub `origin`. If a
rationale already exists, you can open it for editing or regenerate it.

The backend runs these ARGUS stages for the commit:

1. Retrieve GitHub artifacts related to the commit.
2. Identify rationale sentences from those artifacts, using the configured
   `rationale.runs` count.
3. Generate the commit's GOAL, NEED, and ALTERNATIVES summary, with references
   to its evidence.

The extension formats those components and references, writes the Markdown file
under `.rationale/<owner>/<repo>/commit-<sha>.md`, and opens the result panel.

## Explain selected code

Select and save code in the editor, then run **Rationale: Explain Selected
Code**. The extension uses `git blame` on the selected lines and chooses up to
three commits, ranked by how many selected lines each commit contributed. Ties
follow their order in the blame output. The selected file must be saved so the
line range matches the file Git examines.

The backend runs the three ARGUS stages above for each chosen commit. It then
makes a separate model call in `selection_synthesis.py`, passing the selected
code and location, each commit's three rationale components, and the original
evidence sentences. The synthesis prompt requests one concise, coherent
explanation in distinct GOAL, NEED, and ALTERNATIVES paragraphs. It asks the
model to ground claims in the supplied code and summaries, avoid speculation,
and note incomplete or conflicting evidence.

The script parses the three labeled paragraphs and resolves their citation
markers against the gathered references. The extension formats the result and
saves it under `.rationale/<owner>/<repo>/selection-<range-hash>.md`, including
links to the contributing commits.

## View results and diagnose failures

The Rationale panel shows the three components, evidence references, and links
to the analyzed commit or contributing commits. The same content is saved in the
repository as Markdown. **Rationale: Show Log** opens the output channel for
analysis errors; backend setup failures can also be inspected through the setup
log offered by the error prompt.
