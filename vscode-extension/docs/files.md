# Source files and prompts

This page maps the files involved in the extension's main flows and names where
each model prompt is defined. For the runtime sequence, see `architecture.md`.

## Find the implementation files

The frontend source is under `frontend/src`. The Python files under
`../scripts/ARGUS` are the source for the bundled ARGUS pipeline; `build.js`
copies them and their data files into the extension package.

| File                                      | Responsibility                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `extension.ts`                            | Registers commands, validates the selected range, collects credentials, and routes commit or selection results to the panel. |
| `backend.ts`                              | Sets up Python, invokes pipeline stages, handles Git blame and commit selection, and saves Markdown results.                 |
| `configuration.ts`                        | Implements the configuration webview, model/provider selection, credential storage, and connection check.                    |
| `panel.ts`                                | Renders rationale components, commit links, evidence, and source references in the VS Code webview.                          |
| `references.ts`                           | Validates and numbers source references, resolves citation markers for display, and formats Markdown.                        |
| `commitInput.ts`                          | Validates and normalizes GitHub commit URLs and hashes.                                                                      |
| `uv.ts`                                   | Obtains the pinned uv executable used to provision the Python runtime.                                                       |
| `cli.ts` and `cliVersion.ts`              | Detect supported CLI providers and report when a CLI update is needed.                                                       |
| `failure.ts`                              | Turns pipeline errors into readable extension errors.                                                                        |
| `artifact_retrieval.py`                   | Retrieves commit metadata, diffs, and related GitHub artifacts. It does not make an LLM call.                                |
| `rationale_sentence_identifier.py`        | Splits retrieved artifacts into sentences and asks the model to label rationale evidence.                                    |
| `rationale_generation.py`                 | Asks the model to synthesize the labeled evidence and code diff into GOAL, NEED, and ALTERNATIVES.                           |
| `selection_synthesis.py`                  | Makes the final model call that combines per-commit summaries for selected code.                                             |
| `rationale_sources.py`                    | Builds source references, gives the model citation rules, and removes invalid citation markers.                              |
| `llm_provider.py`                         | Routes prompts to the selected API provider or local CLI.                                                                    |
| `runner.py`                               | Runs a pipeline script and emits structured error details for the frontend.                                                  |
| `sentence_splitter.py` and `csv_utils.py` | Shared sentence parsing and CSV read/write helpers.                                                                          |
| `build.js`                                | Copies ARGUS sources, prompt data, and backend dependencies into the extension package.                                      |

## Find the prompts

Commit and selected-code analysis share the first three prompts. Selected-code
analysis adds a synthesis prompt. Each is assembled with run-specific input.

- **Connection check:** `cli_selftest.py` - `Reply with the single word OK.`
- **Evidence identification:** `CI-FS` in `CIPromptTemplate.csv`; built by
  `rationale_sentence_identifier.py` with `AnnotationCodebook.csv`. Labels
  artifact sentences.
- **Per-commit rationale:** `CG-FS` in `CGPromptTemplate.csv`; built by
  `rationale_generation.py` with citation rules from `rationale_sources.py`.
  Summarizes diff and evidence.
- **Selected-code synthesis:** built by `selection_synthesis.py` with citation
  rules from `rationale_sources.py`. Combines commit summaries. Snapshot:
  `.prompt.txt` beside the synthesis output in VS Code global storage.

Prompt snapshots are created during a run, so they are not source files in the
repository. `rationale.runs` controls repeated evidence identification calls;
their labels are combined by majority vote.
