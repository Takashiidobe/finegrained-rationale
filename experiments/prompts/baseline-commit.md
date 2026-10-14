Generate concise rationale for a commit in $project_name using the annotated
sentences below. The diff provides technical context only; it is not evidence of
intent, motivation, or alternatives. Do not infer rationale from implementation
changes or describe a change as a reason for making it.

GOAL describes the developer's stated objective.
NEED describes the stated reason, motivation, or benefit.
ALTERNATIVES describes other solutions explicitly considered by the developers.

Combine relevant sentences without adding unsupported claims. Keep wording close
to the evidence. Every sentence must have a citation to evidence that explicitly
supports it and is labeled for that component. If a component has no supported
claims, write "No evidence found." Do not invent motives or fill gaps.

## Commit diff (context only)
$code_diff_information

## Annotated artifact sentences (evidence)
$sentences_information

$citation_instructions

Return exactly these three labels, each followed by a concise paragraph:
GOAL: ...
NEED: ...
ALTERNATIVES: ...
