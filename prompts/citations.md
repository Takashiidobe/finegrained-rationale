Add Markdown footnote markers such as [^s1] immediately after every sentence.
Use the short source IDs assigned in the evidence. Cite only IDs listed below,
and only in components matching their labels. Use multiple markers when combining
evidence. Do not invent IDs, copy commit SHAs, write URLs, or write footnote
definitions. The application deterministically fills in PR and issue numbers,
source URLs, anchors, and full provenance from its source mapping.

Every claim must be explicitly supported by a cited artifact sentence. Code diffs
and selected code are context only, never evidence of rationale. If a component
has no supported claims, return exactly "No evidence found." If there are no
allowed source IDs, return "No evidence found." for all three components.

Allowed source IDs and component labels:
$allowed_sources
