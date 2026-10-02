import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


from csv_utils import read_csv_rows
from rationale_sources import build_references, citation_id, citation_instructions, resolve_component_citations
from llm_provider import generate_text
from artifact_retrieval import DEFAULT_OUTPUT_ROOT, get_commit_output_dir, resolve_commit_coordinates
from rationale_sentence_identifier import ensure_artifacts_file, identify_rationale_sentences


SOURCE_ROOT = Path(__file__).resolve().parents[2]
CG_TEMPLATE_PATH = SOURCE_ROOT / "data" / "CGPromptTemplate.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate rationale summaries for a single commit's identified ARGUS rationale sentences."
    )
    parser.add_argument("--commit-url", help="GitHub commit URL.")
    parser.add_argument("--owner", help="Repository owner.")
    parser.add_argument("--repo", help="Repository name.")
    parser.add_argument("--hash", dest="commit_hash", help="Commit SHA.")
    parser.add_argument("--artifacts-file", help="Existing artifacts.json path.")
    parser.add_argument(
        "--identified-file",
        help="Existing identified_rationale_sentences.csv path.",
    )
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help="Root directory for saved single-commit ARGUS outputs.",
    )
    parser.add_argument(
        "--model",
        default="o4-mini",
        help="OpenAI model used for rationale generation.",
    )
    parser.add_argument(
        "--prompt-strategy",
        default="CG-FS",
        help="Prompt strategy name from data/CGPromptTemplate.csv.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifacts_path, identified_path = ensure_pipeline_inputs(
        commit_url=args.commit_url,
        owner=args.owner,
        repo=args.repo,
        commit_hash=args.commit_hash,
        artifacts_file=args.artifacts_file,
        identified_file=args.identified_file,
        output_root=Path(args.output_root),
    )
    output_dir = artifacts_path.parent
    summary_path = generate_rationale_summary(
        artifacts_path=artifacts_path,
        identified_path=identified_path,
        output_dir=output_dir,
        model_name=args.model,
        prompt_strategy=args.prompt_strategy,
    )
    print(f"Rationale summary saved to {summary_path}")


def ensure_pipeline_inputs(
    commit_url: str | None,
    owner: str | None,
    repo: str | None,
    commit_hash: str | None,
    artifacts_file: str | None,
    identified_file: str | None,
    output_root: Path,
) -> tuple[Path, Path]:
    artifacts_path = ensure_artifacts_file(
        commit_url=commit_url,
        owner=owner,
        repo=repo,
        commit_hash=commit_hash,
        artifacts_file=artifacts_file,
        output_root=output_root,
    )

    if identified_file:
        return Path(artifacts_path), Path(identified_file)

    if commit_url or (owner and repo and commit_hash):
        resolved_owner, resolved_repo, resolved_sha = resolve_commit_coordinates(
            commit_url, owner, repo, commit_hash
        )
    else:
        payload = read_json(artifacts_path)
        resolved_owner = payload["owner"]
        resolved_repo = payload["repo"]
        resolved_sha = payload["sha"]

    output_dir = get_commit_output_dir(output_root, resolved_owner, resolved_repo, resolved_sha)
    identified_path = output_dir / "identified_rationale_sentences.csv"
    if identified_path.exists():
        return Path(artifacts_path), identified_path

    identified_path = identify_rationale_sentences(
        artifacts_path=Path(artifacts_path),
        output_dir=output_dir,
        model_name="o4-mini",
        runs=1,
        prompt_strategy="CI-FS",
    )
    return Path(artifacts_path), identified_path


def generate_rationale_summary(
    artifacts_path: Path,
    identified_path: Path,
    output_dir: Path,
    model_name: str,
    prompt_strategy: str,
) -> Path:
    artifacts = read_json(artifacts_path)
    identified_rows = read_csv_rows(identified_path)

    prompt = build_generation_prompt(artifacts, identified_rows, prompt_strategy)
    (output_dir / "rationale_generation_prompt.txt").write_text(prompt, encoding="utf-8")

    response_text = request_openai_response(prompt, model_name)
    (output_dir / "rationale_summary.txt").write_text(response_text, encoding="utf-8")

    references = build_references(identified_rows)
    parsed_components = resolve_component_citations(parse_rationale_response(response_text), references)
    payload = {
        "commit_id": artifacts["commit_id"],
        "commit_url": artifacts["commit_url"],
        "model": model_name,
        "prompt_strategy": prompt_strategy,
        "raw_response": response_text,
        "components": parsed_components,
        "references": references,
    }

    output_path = output_dir / "rationale_summary.json"
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return output_path


def build_generation_prompt(
    artifacts: dict[str, Any],
    identified_rows: list[dict[str, Any]],
    prompt_strategy: str,
) -> str:
    template_row = next(
        (row for row in read_csv_rows(CG_TEMPLATE_PATH) if row["prompt_strategy"] == prompt_strategy),
        None,
    )
    if template_row is None:
        raise ValueError(f"Prompt strategy not found: {prompt_strategy}")
    row = template_row

    code_diff_information = "\n\n".join(
        row["code_diff_information"]
        .replace("<index>", str(index + 1))
        .replace("<file_name>", file_info.get("filename", ""))
        .replace("<diff>", file_info.get("patch") or "<patch unavailable>")
        for index, file_info in enumerate(artifacts["commit_info"].get("files", []))
    )

    sentences_information = format_identified_sentences_for_prompt(
        row["sentences_information"],
        identified_rows,
    )

    project_name = f"{artifacts['owner']}/{artifacts['repo']}"
    return (
        row["template"]
        .replace("<project_name>", project_name)
        .replace("<code_diff_information>", code_diff_information)
        .replace("<sentences_information>", sentences_information)
        .replace("<sentence_count>", str(len(identified_rows)))
    ) + citation_instructions(build_references(identified_rows))


def format_identified_sentences_for_prompt(template: str, rows: list[dict[str, Any]]) -> str:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[f"{row['source']}::{row['source_id']}::{row['text_id']}"].append(row)

    buckets = {
        "COMMIT_MESSAGE": [],
        "CLASS_JAVADOCS": defaultdict(list),
        "METHOD_JAVADOCS": defaultdict(list),
        "CODE_COMMENT": [],
        "ISSUE": defaultdict(list),
        "PULL_REQUEST": defaultdict(list),
        "CODE_REVIEW_COMMENT": defaultdict(list),
    }

    for group in grouped.values():
        source = group[0]["source"]
        formatted_rows = []
        for row in group:
            formatted_rows.append(
                template.replace("<index>", citation_id(row))
                .replace("<source>", str(row["source"]))
                .replace("<sentence>", str(row["sentence"]))
                .replace("<labels>", str(row["final_labels"]))
            )

        if source in {"CLASS_JAVADOCS", "METHOD_JAVADOCS"}:
            buckets[source][group[0].get("class_name", "")].extend(formatted_rows)
        elif source in {"ISSUE", "PULL_REQUEST", "CODE_REVIEW_COMMENT"}:
            issue_key = str(group[0]["source_url"]).split("#", 1)[0]
            buckets[source][issue_key].extend(formatted_rows)
        else:
            buckets[source].extend(formatted_rows)

    sections: list[str] = []
    if buckets["COMMIT_MESSAGE"]:
        sections.append(
            "\n\nThe following sentences come from the commit message\n\n"
            + "\n\n".join(buckets["COMMIT_MESSAGE"])
        )
    if buckets["CODE_COMMENT"]:
        sections.append(
            "\n\nThe following sentences come from the comments of the changed code. The sentences have [ADD] and [REM] prefix. The sentences with [ADD] mean these sentences are added in the code commit and sentences with [REM] mean these sentences are removed in the code commit\n\n"
            + "\n\n".join(buckets["CODE_COMMENT"])
        )
    for source in ("CLASS_JAVADOCS", "METHOD_JAVADOCS"):
        for class_name, items in buckets[source].items():
            role = source.split("_")[0].lower()
            sections.append(
                f"\n\nThe following sentences come from the Javadoc comments of the {role}({class_name}) that were changed\n\n"
                + "\n\n".join(items)
            )
    for source in ("ISSUE", "PULL_REQUEST", "CODE_REVIEW_COMMENT"):
        for issue_url, items in buckets[source].items():
            sections.append(
                f"\n\nThe following sentences come from the {source.lower()}: {issue_url}, associated with the commit\n\n"
                + "\n\n".join(items)
            )
    return "".join(sections)


def request_openai_response(prompt: str, model_name: str) -> str:
    return generate_text(prompt, model_name)


def parse_rationale_response(text: str) -> dict[str, str]:
    components: dict[str, str] = {}
    current_label = None
    current_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        matched_label = None
        for label in ("GOAL", "NEED", "ALTERNATIVES"):
            if line.startswith(f"{label}:"):
                matched_label = label
                break

        if matched_label:
            if current_label and current_lines:
                components[current_label] = " ".join(current_lines).strip()
            current_label = matched_label
            current_lines = [line.split(":", 1)[1].strip()]
        elif current_label:
            current_lines.append(line)

    if current_label and current_lines:
        components[current_label] = " ".join(current_lines).strip()

    return {key: value for key, value in components.items() if value}


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


if __name__ == "__main__":
    main()
