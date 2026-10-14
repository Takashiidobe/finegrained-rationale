# Rationale prompts

The extension uses these templates to generate rationale backed by artifact
citations:

- `commit-rationale.md`: Summarize a commit's annotated artifact sentences.
- `selection-rationale.md`: Synthesize selected-code rationale from original
  evidence across contributing commits.
- `citations.md`: Shared citation requirements and allowed source IDs.

Templates use Python `string.Template` placeholders such as `$project_name`.
Context values are substituted once; text inside those values stays unchanged.
The extension build copies this directory into its Python backend. Generation
uses short citation IDs such as `s1`; the backend resolves them to full
provenance, and the extension fills in PR and issue numbers, URLs, and anchors
from that mapping.

The original research prompts remain in `data/CGPromptTemplate.csv`. The
`rationale_generation.py` CLI defaults to `--prompt-strategy commit`; pass a
research strategy such as `--prompt-strategy CG-FS` to use the CSV template.
