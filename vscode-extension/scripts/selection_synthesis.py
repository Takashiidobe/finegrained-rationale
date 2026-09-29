import argparse
import json
from pathlib import Path

from llm_provider import generate_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Synthesize rationale for selected code from its top contributing commits.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    commit_context = []
    for commit in data["commits"]:
        summary = json.loads(Path(commit["summary_path"]).read_text(encoding="utf-8"))
        components = summary.get("components", {})
        commit_context.append(
            f"Commit: {commit['sha']} ({commit['lines']} selected lines)\n"
            f"URL: {commit['url']}\n"
            f"GOAL: {components.get('GOAL', '')}\n"
            f"NEED: {components.get('NEED', '')}\n"
            f"ALTERNATIVES: {components.get('ALTERNATIVES', '')}"
        )
    prompt = f"""Explain the rationale for a selected piece of code by synthesizing the evidence below.
Describe how the commits contribute to the selected code as one coherent explanation. Ground claims in the supplied summaries and code; do not invent motives or fill gaps with speculation. If evidence is incomplete or the summaries disagree, say so. Keep the three requested components distinct.

Repository: {data['repository']}
File: {data['file']}, lines {data['start_line']}-{data['end_line']}

Selected code:
```text
{data['code']}
```

Top contributing commit summaries (ranked by number of selected lines):
{chr(10).join(commit_context)}

Return exactly these three labels, each followed by a concise paragraph:
GOAL: ...
NEED: ...
ALTERNATIVES: ..."""
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    (output_path.parent / f"{output_path.stem}.prompt.txt").write_text(prompt, encoding="utf-8")
    response = generate_text(prompt, args.model)
    output_path.write_text(json.dumps({"raw_response": response, "components": parse_components(response)}, indent=2), encoding="utf-8")


def parse_components(text: str) -> dict[str, str]:
    labels = ("GOAL", "NEED", "ALTERNATIVES")
    components: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        matched = next((label for label in labels if line.startswith(f"{label}:")), None)
        if matched:
            current = matched
            components.setdefault(current, []).append(line.split(":", 1)[1].strip())
        elif current and line:
            components[current].append(line)
    return {label: " ".join(components.get(label, [])).strip() for label in labels}


if __name__ == "__main__":
    main()
