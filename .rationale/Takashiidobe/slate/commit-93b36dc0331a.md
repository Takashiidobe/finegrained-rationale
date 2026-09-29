---
commit: "https://github.com/Takashiidobe/slate/commit/93b36dc0331a4ce6326d2d2da0aa64842239a7f3"
commit_sha: "93b36dc0331a4ce6326d2d2da0aa64842239a7f3"
repository: "Takashiidobe/slate"
provider: "codex"
model: "gpt-6-luna"
runs: 1
generated_at: "2026-09-24T16:21:22.171Z"
---

# Rationale for Takashiidobe/slate@93b36dc0331a

## GOAL

Correctly handle addressed (`maybe_memory`) inline assembly outputs with register alternatives by tracking operand groups and binding them to their target places.

## NEED

Flattening CIR’s output and input operand groups misclassified addressed outputs such as `=g`, `=imr`, and `+g` as inputs, reading the address as data and causing a silent miscompile.

## ALTERNATIVE

Not identified.
