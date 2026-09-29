---
repository: "Takashiidobe/finegrained-rationale"
file: "scripts/a_DatasetPreprocessor.py"
start_line: 27
end_line: 33
generated_at: "2026-09-28T15:23:27.049Z"
---

# Rationale for scripts/a_DatasetPreprocessor.py:27-33

- [325ff6db8515](https://github.com/Takashiidobe/finegrained-rationale/commit/325ff6db85157ed0ba86b670b53763fe47337828) — 4 selected lines
- [ccd54b62459f](https://github.com/Takashiidobe/finegrained-rationale/commit/ccd54b62459f8e6415ee3df8226ce5e0b0134509) — 3 selected lines

## GOAL

Convert the input CSV into a readable JSON array, keeping only rows marked `sampling_commit == 1`. This supports the preprocessing workflow that samples commits after collecting change counts and filtering for Java files and line changes.

## NEED

The selected code and commit summaries show that the output should contain the sampled commits in a format saved to the requested path. They do not explain why this filter or JSON format was chosen.

## ALTERNATIVES

The supplied evidence names no alternatives.
