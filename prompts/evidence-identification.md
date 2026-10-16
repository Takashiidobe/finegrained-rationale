Identify which artifact sentences provide evidence for the rationale behind a
code change in $project_name.

Use the diff only to understand the change. Label a sentence only when its
content supports one or more of these components:

- GOAL: what the developer aimed to change or achieve.
- NEED: why the change was needed, including a stated problem, motivation, or
  benefit.
- ALTERNATIVES: other solutions the developers explicitly considered.

Do not infer intent from the diff or label sentences that only describe
implementation details without explaining rationale. A sentence may receive
multiple labels. Omit sentences with no supported component.

## Commit diff (context only)
$code_diff_information

## Artifact sentences
$sentences_information

Return only CSV rows with the columns `Id` and `Labels`. Use each sentence ID
exactly as provided, and separate multiple labels with commas inside the
Labels field. Do not include a header, explanation, or Markdown fences.
