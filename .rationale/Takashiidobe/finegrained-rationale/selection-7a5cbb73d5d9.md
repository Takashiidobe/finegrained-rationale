---
repository: "Takashiidobe/finegrained-rationale"
file: "scripts/ARGUS/sentence_splitter.py"
start_line: 8
end_line: 23
generated_at: "2026-10-11T19:59:05.353Z"
---

# Rationale for scripts/ARGUS/sentence_splitter.py:8-23

- [3215f9bc0c62](https://github.com/Takashiidobe/finegrained-rationale/commit/3215f9bc0c62af9b3f467d74c738b89ff31e1683) — 16 selected lines

## GOAL

The commit's overall aim was to migrate the project's Python dependency and environment management to uv. The VS Code extension backend now downloads a pinned, checksum-verified uv, which installs a private Python 3.14 and locked dependencies from `pyproject.toml` and `uv.lock`, and CI syncs with uv. As part of this, the spaCy-based sentence splitting was replaced by a dependency-free, rule-based `sentence_splitter.py`.[^1] The selected `split_sentences` function is that replacement. It returns an empty list for empty input, splits text into blocks, collapses whitespace, splits each block into sentence pieces, and re-joins pieces where the previous one ends with a known abbreviation, so abbreviations don't produce false sentence breaks.

## NEED

The supplied evidence does not state an explicit need. The summary's NEED field is empty and the commit message is only "migrate to uv". From the code alone, the splitter must produce sentence lists without spaCy, and it must avoid splitting after abbreviations. The evidence does not say why spaCy was a problem, such as install size or compatibility with Python 3.14, so I won't infer a motive.

## ALTERNATIVE

The evidence names no alternatives considered. The only contrast it records is the previous approach, spaCy-based sentence splitting, which was replaced by this rule-based splitter. It does not say whether other libraries or approaches were evaluated, or why they were rejected.

## References

[^1]: [Commit message](<https://github.com/Takashiidobe/finegrained-rationale/commit/3215f9bc0c62af9b3f467d74c738b89ff31e1683>) — “migrate to uv”
