import re
from typing import Any
from urllib.parse import urlparse


COMPONENTS = ("GOAL", "NEED", "ALTERNATIVES")
CITATION = re.compile(r"\[\^([^\]\r\n]+)\]")


def citation_id(row: dict[str, Any]) -> str:
    return f"{row.get('sha', '')}-{row['id']}"


def build_references(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    references = {}
    for row in rows:
        source_url = str(row.get("source_url") or "").strip()
        url = urlparse(source_url)
        labels = [label.strip() for label in str(row.get("final_labels") or "").split(",")]
        labels = [label for label in labels if label in COMPONENTS]
        sentence_id = str(row.get("id") or "")
        if not sentence_id or not row.get("sentence") or not labels or url.scheme != "https" or url.hostname != "github.com" or url.username or url.password:
            continue
        reference_id = citation_id(row)
        if not re.fullmatch(r"[\w-]+", reference_id):
            continue
        references[reference_id] = {
            "id": reference_id,
            "sentenceId": sentence_id,
            "source": str(row.get("source") or "SOURCE"),
            "url": source_url,
            "sentence": str(row.get("sentence") or ""),
            "labels": labels,
        }
    return list(references.values())


def citation_instructions(references: list[dict[str, Any]]) -> str:
    if not references:
        return ""
    allowed = "\n".join(f"{ref['id']} ({', '.join(ref['labels'])})" for ref in references)
    return f"""\n\nSource citations:
Add Markdown footnote markers [^source-id] immediately after each claim supported by an annotated sentence. Replace source-id with its exact Id from the inputs. Cite only IDs listed below, and only in components matching their labels. Use multiple markers when a claim combines evidence. Do not invent IDs or write footnote definitions; the application links the markers to the original sources. Claims based only on the code diff may remain uncited.
Allowed source IDs and component labels:
{allowed}"""


def resolve_component_citations(components: dict[str, str], references: list[dict[str, Any]]) -> dict[str, str]:
    by_id = {reference["id"]: reference for reference in references}
    result = {}
    for label, text in components.items():
        def replace(match: re.Match[str]) -> str:
            reference = by_id.get(match[1])
            return match[0] if reference and label in reference["labels"] else ""
        result[label] = CITATION.sub(replace, text).strip()
    return result
