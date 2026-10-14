import argparse
import json
from pathlib import Path

from llm_provider import generate_text
from rationale_sources import citation_aliases, citation_instructions, render_prompt, resolve_component_citations, shorten_citations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synthesize rationale for selected code from its top contributing commits."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    commit_context = []
    references = {}
    summaries = []
    for commit in data["commits"]:
        summary = json.loads(Path(commit["summary_path"]).read_text(encoding="utf-8"))
        summaries.append((commit, summary))
        for reference in summary.get("references", []):
            references[reference["id"]] = reference
    sources = list(references.values())
    aliases = citation_aliases(sources)
    for commit, summary in summaries:
        components = {label: shorten_citations(text, aliases) for label, text in summary.get("components", {}).items()}
        commit_context.append(
            f"Commit: {commit['sha']} ({commit['lines']} selected lines)\n"
            f"URL: {commit['url']}\n"
            f"GOAL: {components.get('GOAL', '')}\n"
            f"NEED: {components.get('NEED', '')}\n"
            f"ALTERNATIVES: {components.get('ALTERNATIVES', '')}"
        )
    prompt = render_prompt(
        "selection-rationale.md", repository=data["repository"], file=data["file"],
        start_line=data["start_line"], end_line=data["end_line"], code=data["code"],
        commit_context="\n\n".join(commit_context),
        sentences_information="\n\n".join(
            f"Id: {aliases[ref['id']]}\nSource: {ref['source']}\nSentence: {ref['sentence']}\nLabels: {', '.join(ref['labels'])}"
            for ref in sources
        ),
        citation_instructions=citation_instructions(sources),
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    (output_path.parent / f"{output_path.stem}.prompt.txt").write_text(
        prompt, encoding="utf-8"
    )
    response = generate_text(prompt, args.model) if sources else "\n".join(
        f"{label}: No evidence found." for label in ("GOAL", "NEED", "ALTERNATIVES")
    )
    components = resolve_component_citations(parse_components(response), sources)
    output_path.write_text(
        json.dumps(
            {"raw_response": response, "components": components, "references": sources,
             "citation_aliases": {alias: reference_id for reference_id, alias in aliases.items()}},
            indent=2,
        ),
        encoding="utf-8",
    )


def parse_components(text: str) -> dict[str, str]:
    labels = ("GOAL", "NEED", "ALTERNATIVES")
    components: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        matched = next(
            (label for label in labels if line.startswith(f"{label}:")), None
        )
        if matched:
            current = matched
            components.setdefault(current, []).append(line.split(":", 1)[1].strip())
        elif current and line:
            components[current].append(line)
    return {label: " ".join(components.get(label, [])).strip() for label in labels}


if __name__ == "__main__":
    main()
