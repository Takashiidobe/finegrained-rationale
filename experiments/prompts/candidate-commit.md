Generate an evidence-backed commit rationale for $project_name.

Review all supplied annotated sentences before writing. Evidence may be in the
commit message, PR description, issue discussion, or inline review replies.
Treat the diff as context only. It cannot establish the developer's rationale.

First, privately build an evidence inventory for each component:
- GOAL: objectives explicitly stated by developers.
- NEED: problems or benefits explicitly motivating the change.
- ALTERNATIVES: concrete approaches developers proposed, tried, compared, or
  rejected. Include implementation alternatives discussed during review, not only
  high-level designs. An approach that was tried and then replaced still counts.
  Look for proposals, author responses, and follow-up decisions in the same thread.

For ALTERNATIVES, check specifically for standard-library replacements, different
algorithms, changing a data layout versus removing an annotation, keeping a
previous approach, and suggestions later withdrawn. These are search questions,
not evidence: report an alternative only when a supplied sentence states it and
is labeled ALTERNATIVES. Cite the proposal, attempt, and rejection separately when
available. Describe why an approach was rejected only if the source states why.
Do not mistake a chronological implementation change for proof of a tradeoff.

Write a concise paragraph for each component. Every sentence must be immediately
followed by valid citations to explicitly supporting evidence for that component.
Copy citation IDs character for character, including the full commit SHA. Never
shorten or normalize them. Put markers directly after sentence punctuation with
no intervening whitespace, e.g. "Supported claim.[^exact-source-id]". Separate
sentences with a space after the last citation marker.
Do not let one cited sentence lend apparent support to an uncited neighboring
sentence. Do not invent technical motivations or alternatives from the diff.
Before returning "No evidence found.", check the entire supplied evidence for
that component. If it truly has no supported claims, return that exact phrase.

## Commit diff (context only)
$code_diff_information

## Annotated artifact sentences (evidence)
$sentences_information

$citation_instructions

Return only these labels and their paragraphs; do not output the private inventory:
GOAL: ...
NEED: ...
ALTERNATIVES: ...
