import re
from pathlib import Path
from string import Template
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


def citation_aliases(references: list[dict[str, Any]]) -> dict[str, str]:
    return {reference_id: f"s{index}" for index, reference_id in enumerate(sorted({ref["id"] for ref in references}), 1)}


def shorten_citations(text: str, aliases: dict[str, str]) -> str:
    return CITATION.sub(lambda match: f"[^{aliases[match[1]]}]" if match[1] in aliases else "", text)


def render_prompt(name: str, **values: Any) -> str:
    prompt_path = Path(__file__).resolve().parents[2] / "prompts" / name
    return Template(prompt_path.read_text(encoding="utf-8")).substitute(values)


def citation_instructions(references: list[dict[str, Any]]) -> str:
    aliases = citation_aliases(references)
    allowed = "\n".join(f"{aliases[ref['id']]} ({', '.join(ref['labels'])})" for ref in references)
    return render_prompt("citations.md", allowed_sources=allowed)


def resolve_component_citations(components: dict[str, str], references: list[dict[str, Any]]) -> dict[str, str]:
    by_id = {reference["id"]: reference for reference in references}
    by_id.update({alias: by_id[reference_id] for reference_id, alias in citation_aliases(references).items()})
    result = {}
    for label in COMPONENTS:
        text = components.get(label, "")
        def replace(match: re.Match[str]) -> str:
            reference = by_id.get(match[1])
            return f"[^{reference['id']}]" if reference and label in reference["labels"] else ""
        resolved = CITATION.sub(replace, text).strip()
        resolved = re.sub(r"[ \t]+(?=\[\^)", "", resolved)
        claims = [claim.strip() for claim in re.findall(r"[\s\S]+?(?:[.!?](?:\[\^[^\]\r\n]+\])*(?=\s|$)|$)", resolved) if claim.strip()]
        result[label] = resolved if claims and all(CITATION.search(claim) for claim in claims) else "No evidence found."
    return result
