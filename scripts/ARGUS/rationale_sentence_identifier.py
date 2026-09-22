import argparse
import csv
import io
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

import spacy
from openai import OpenAI

from csv_utils import read_csv_rows, write_csv_rows
from artifact_retrieval import (
    DEFAULT_OUTPUT_ROOT,
    get_commit_output_dir,
    numeric_commit_id,
    resolve_commit_coordinates,
    retrieve_artifacts,
)


SOURCE_ROOT = Path(__file__).resolve().parents[2]
CODEBOOK_PATH = SOURCE_ROOT / "data" / "AnnotationCodebook.csv"
CI_TEMPLATE_PATH = SOURCE_ROOT / "data" / "CIPromptTemplate.csv"
SOURCE_ID_MAP = {
    "COMMIT_MESSAGE": 1,
    "CODE_COMMENT": 2,
    "CLASS_JAVADOCS": 3,
    "METHOD_JAVADOCS": 4,
    "ISSUE": 5,
    "PULL_REQUEST": 6,
    "CODE_REVIEW_COMMENT": 7,
}
RATIONALE_CODES = ["GOAL", "NEED", "ALTERNATIVES"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Identify rationale sentences for a single commit's ARGUS artifacts."
    )
    parser.add_argument("--commit-url", help="GitHub commit URL.")
    parser.add_argument("--owner", help="Repository owner.")
    parser.add_argument("--repo", help="Repository name.")
    parser.add_argument("--hash", dest="commit_hash", help="Commit SHA.")
    parser.add_argument("--artifacts-file", help="Existing artifacts.json path.")
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help="Root directory for saved single-commit ARGUS outputs.",
    )
    parser.add_argument(
        "--model",
        default="o4-mini",
        help="OpenAI model used for rationale sentence identification.",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=3,
        help="Number of LLM runs used for majority voting.",
    )
    parser.add_argument(
        "--prompt-strategy",
        default="CI-FS",
        help="Prompt strategy name from data/CIPromptTemplate.csv.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifacts_path = ensure_artifacts_file(
        commit_url=args.commit_url,
        owner=args.owner,
        repo=args.repo,
        commit_hash=args.commit_hash,
        artifacts_file=args.artifacts_file,
        output_root=Path(args.output_root),
    )
    output_dir = Path(artifacts_path).parent
    identified_path = identify_rationale_sentences(
        artifacts_path=Path(artifacts_path),
        output_dir=output_dir,
        model_name=args.model,
        runs=args.runs,
        prompt_strategy=args.prompt_strategy,
    )
    print(f"Identified rationale sentences saved to {identified_path}")


def ensure_artifacts_file(
    commit_url: str | None,
    owner: str | None,
    repo: str | None,
    commit_hash: str | None,
    artifacts_file: str | None,
    output_root: Path,
) -> Path:
    if artifacts_file:
        return Path(artifacts_file)

    owner, repo, sha = resolve_commit_coordinates(commit_url, owner, repo, commit_hash)
    output_dir = get_commit_output_dir(output_root, owner, repo, sha)
    artifacts_path = output_dir / "artifacts.json"
    if artifacts_path.exists():
        return artifacts_path
    return retrieve_artifacts(owner, repo, sha, output_root)


def identify_rationale_sentences(
    artifacts_path: Path,
    output_dir: Path,
    model_name: str,
    runs: int,
    prompt_strategy: str,
) -> Path:
    payload = read_json(artifacts_path)
    sentences = build_sentence_rows(payload)
    sentences_csv_path = output_dir / "sentences.csv"
    write_csv_rows(sentences_csv_path, sentences)
    write_json(output_dir / "sentences.json", sentences)

    prompt = build_identification_prompt(payload, sentences, prompt_strategy)
    prompt_path = output_dir / "identification_prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")

    raw_responses: list[str] = []
    parsed_runs: list[dict[str, list[str]]] = []
    for run_index in range(runs):
        response_text = request_openai_response(prompt, model_name)
        raw_responses.append(response_text)
        (output_dir / f"identification_response_run_{run_index + 1}.csv").write_text(
            response_text,
            encoding="utf-8",
        )
        parsed_runs.append(parse_identification_response(response_text))

    rows_by_id = {row["id"]: dict(row) for row in sentences}
    for row in rows_by_id.values():
        row["run_labels"] = []

    for parsed in parsed_runs:
        for row in rows_by_id.values():
            labels = parsed.get(row["id"], [])
            row["run_labels"].append(", ".join(labels))

    for row in rows_by_id.values():
        row["final_labels"] = ", ".join(vote_labels(row["run_labels"]))

    all_rows = list(rows_by_id.values())
    rationale_rows = [row for row in all_rows if row["final_labels"]]

    all_sentences_path = output_dir / "sentences_labeled.csv"
    write_csv_rows(all_sentences_path, all_rows)
    identified_path = output_dir / "identified_rationale_sentences.csv"
    write_csv_rows(identified_path, rationale_rows)

    write_json(output_dir / "sentences_labeled.json", all_rows)
    write_json(output_dir / "identified_rationale_sentences.json", rationale_rows)
    return identified_path


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def get_nlp():
    if not hasattr(get_nlp, "_model"):
        get_nlp._model = spacy.load(os.environ.get("ARGUS_SPACY_MODEL", "en_core_web_trf"))
    return get_nlp._model


def split_sentences(text: str | None) -> list[str]:
    if not text:
        return []
    doc = get_nlp()(text)
    return [sentence.text.strip() for sentence in doc.sents if sentence.text.strip()]


def build_sentence_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    commit_id = payload["commit_id"]
    commit_url = payload["commit_url"]
    owner = payload["owner"]
    repo = payload["repo"]
    sha = payload["sha"]

    rows: list[dict[str, Any]] = []
    text_counters = defaultdict(int)

    def next_text_id(source: str) -> int:
        text_counters[source] += 1
        return text_counters[source]

    def add_text_group(
        *,
        source: str,
        source_url: str,
        text: str,
        artifact_kind: str,
        artifact_number: int | None = None,
        class_name: str | None = None,
    ) -> None:
        sentences = split_sentences(text)
        if not sentences:
            return
        text_id = next_text_id(source)
        for local_index, sentence in enumerate(sentences):
            rows.append(
                {
                    "id": f"{commit_id}_{SOURCE_ID_MAP[source]}_{text_id}_{local_index}",
                    "commit_id": commit_id,
                    "commit_url": commit_url,
                    "owner": owner,
                    "repo": repo,
                    "sha": sha,
                    "source_id": SOURCE_ID_MAP[source],
                    "text_id": text_id,
                    "sentence_id": local_index,
                    "source": source,
                    "source_url": source_url,
                    "artifact_kind": artifact_kind,
                    "artifact_number": artifact_number,
                    "class_name": class_name or "",
                    "text": text,
                    "sentence": sentence,
                }
            )

    add_text_group(
        source="COMMIT_MESSAGE",
        source_url=commit_url,
        text=payload["commit_info"]["commit"]["message"],
        artifact_kind="commit_message",
    )

    for file_info in payload["commit_info"].get("files", []):
        file_url = file_info.get("blob_url") or commit_url
        for comment in file_info.get("added_comments", []):
            add_text_group(
                source="CODE_COMMENT",
                source_url=file_url,
                text=f"[ADD]: {comment}",
                artifact_kind="code_comment_added",
            )
        for comment in file_info.get("removed_comments", []):
            add_text_group(
                source="CODE_COMMENT",
                source_url=file_url,
                text=f"[REM]: {comment}",
                artifact_kind="code_comment_removed",
            )
        for class_name, docstring in file_info.get("class_docstrings", []):
            add_text_group(
                source="CLASS_JAVADOCS",
                source_url=file_url,
                text=docstring,
                artifact_kind="class_javadocs",
                class_name=class_name,
            )
        for class_name, docstring in file_info.get("method_docstrings", []):
            add_text_group(
                source="METHOD_JAVADOCS",
                source_url=file_url,
                text=docstring,
                artifact_kind="method_javadocs",
                class_name=class_name,
            )

    for column_name, source in (
        ("issue_info", "ISSUE"),
        ("ref_issue_info", "ISSUE"),
        ("add_ref_issue_info", "ISSUE"),
        ("pr_info", "PULL_REQUEST"),
        ("ref_pr_info", "PULL_REQUEST"),
        ("add_ref_pr_info", "PULL_REQUEST"),
    ):
        for artifact in payload.get(column_name, []):
            artifact_number = artifact.get("number")
            artifact_url = artifact.get("html_url") or commit_url
            body = filter_issue_body(artifact.get("body") or "")
            add_text_group(
                source=source,
                source_url=f"{artifact_url}#title",
                text=artifact.get("title") or "",
                artifact_kind=f"{column_name}_title",
                artifact_number=artifact_number,
            )
            add_text_group(
                source=source,
                source_url=f"{artifact_url}#body",
                text=body,
                artifact_kind=f"{column_name}_body",
                artifact_number=artifact_number,
            )
            for comment in artifact.get("comments_details", []):
                comment_body = comment.get("body") or ""
                if comment_body.startswith("# [Codecov]"):
                    continue
                add_text_group(
                    source=source,
                    source_url=comment.get("html_url") or artifact_url,
                    text=comment_body,
                    artifact_kind=f"{column_name}_comment",
                    artifact_number=artifact_number,
                )
            for review_comment in artifact.get("review_comments_details", []):
                add_text_group(
                    source="CODE_REVIEW_COMMENT",
                    source_url=review_comment.get("html_url") or artifact_url,
                    text=review_comment.get("body") or "",
                    artifact_kind=f"{column_name}_review_comment",
                    artifact_number=artifact_number,
                )

    return rows


def filter_issue_body(text: str) -> str:
    if not text:
        return ""
    if text.startswith("## What is the purpose of the change"):
        normalized = text.replace("\r", "")
        normalized = "\n".join(
            line for line in normalized.split("\n") if line and not line.startswith("#")
        )
        marker = "Follow this checklist to help us incorporate your contribution quickly and easily"
        marker_index = normalized.find(marker)
        if marker_index >= 0:
            normalized = normalized[:marker_index]
        return normalized
    return text


def build_identification_prompt(
    payload: dict[str, Any],
    sentences: list[dict[str, Any]],
    prompt_strategy: str,
) -> str:
    template_row = next(
        (row for row in read_csv_rows(CI_TEMPLATE_PATH) if row["prompt_strategy"] == prompt_strategy),
        None,
    )
    if template_row is None:
        raise ValueError(f"Prompt strategy not found: {prompt_strategy}")
    row = template_row
    template = row["template"]

    codebook = [
        row for row in read_csv_rows(CODEBOOK_PATH)
        if row["Annotation Labels"] in RATIONALE_CODES
    ]

    code_information = "\n\n".join(
        row["code_information"]
        .replace("<index>", str(index + 1))
        .replace("<code>", code_row["Annotation Labels"])
        .replace("<definintion>", str(code_row["Description"]))
        .replace("<question>", str(code_row["Component Expressed as Question"]))
        .replace("<rule>", str(code_row.get("Rules", "")))
        for index, code_row in enumerate(codebook)
    )

    code_diff_information = "\n\n".join(
        row["code_diff_information"]
        .replace("<index>", str(index + 1))
        .replace("<file_name>", file_info.get("filename", ""))
        .replace("<diff>", file_info.get("patch") or "<patch unavailable>")
        for index, file_info in enumerate(payload["commit_info"].get("files", []))
    )

    sentences_information = format_sentences_for_prompt(row["sentences_information"], sentences)
    project_name = f"{payload['owner']}/{payload['repo']}"

    return (
        template.replace("<project_name>", project_name)
        .replace("<code_information>", code_information)
        .replace("<code_diff_information>", code_diff_information)
        .replace("<sentences_information>", sentences_information)
        .replace("<sentence_count>", str(len(sentences)))
    )


def format_sentences_for_prompt(template: str, sentences: list[dict[str, Any]]) -> str:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for sentence in sentences:
        group_key = f"{sentence['source']}::{sentence['source_id']}::{sentence['text_id']}"
        grouped[group_key].append(sentence)

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
        formatted_sentences = []
        for row in group:
            formatted = (
                template.replace("<index>", row["id"])
                .replace("<source>", row["source"])
                .replace("<sentence>", row["sentence"])
            )
            formatted_sentences.append(formatted)

        if source in {"CLASS_JAVADOCS", "METHOD_JAVADOCS"}:
            buckets[source][group[0]["class_name"]].extend(formatted_sentences)
        elif source in {"ISSUE", "PULL_REQUEST", "CODE_REVIEW_COMMENT"}:
            issue_key = group[0]["source_url"].split("#", 1)[0]
            buckets[source][issue_key].extend(formatted_sentences)
        else:
            buckets[source].extend(formatted_sentences)

    sections: list[str] = []
    if buckets["COMMIT_MESSAGE"]:
        sections.append(
            "\n\nThe following sentences come from the commit message\n\n"
            + "\n\n".join(buckets["COMMIT_MESSAGE"])
        )
    if buckets["CODE_COMMENT"]:
        sections.append(
            "\n\nThe following sentences come from the comments of the changed code.\n\n"
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
    api_key = os.environ.get("OPENAI_TOKEN") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_TOKEN or OPENAI_API_KEY must be set.")

    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=model_name,
        input=[{"role": "user", "content": prompt}],
        reasoning={"effort": "high"},
    )
    return (response.output_text or "").strip()


def parse_identification_response(response_text: str) -> dict[str, list[str]]:
    if not response_text.strip():
        return {}

    text = strip_code_fences(response_text.strip())
    if not text.lower().startswith("sentence_id,"):
        text = "sentence_id, labels\n" + text

    reader = csv.reader(io.StringIO(text), skipinitialspace=True)
    rows = list(reader)
    if not rows:
        return {}

    parsed: dict[str, list[str]] = {}
    for row in rows[1:]:
        if not row:
            continue
        sentence_id = row[0].strip()
        labels_text = ",".join(row[1:]).strip()
        labels = normalize_labels(labels_text)
        if sentence_id and labels:
            parsed[sentence_id] = labels
    return parsed


def normalize_labels(labels_text: str) -> list[str]:
    labels = []
    for raw_label in labels_text.replace('"', "").split(","):
        label = raw_label.strip().upper()
        if label in RATIONALE_CODES and label not in labels:
            labels.append(label)
    return labels


def vote_labels(run_labels: list[str]) -> list[str]:
    counts = {code: 0 for code in RATIONALE_CODES}
    threshold = len(run_labels) // 2 + 1
    for label_text in run_labels:
        for code in normalize_labels(label_text):
            counts[code] += 1
    return [code for code in RATIONALE_CODES if counts[code] >= threshold]


def strip_code_fences(text: str) -> str:
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1]).strip()
    return text


if __name__ == "__main__":
    main()
