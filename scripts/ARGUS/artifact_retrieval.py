import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


GITHUB_API_BASE = "https://api.github.com"
SOURCE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_ROOT = SOURCE_ROOT / "data" / "generated" / "ARGUS"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retrieve ARGUS artifacts for a single commit."
    )
    parser.add_argument("--commit-url", help="GitHub commit URL.")
    parser.add_argument("--owner", help="Repository owner.")
    parser.add_argument("--repo", help="Repository name.")
    parser.add_argument("--hash", dest="commit_hash", help="Commit SHA.")
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help="Root directory for saved single-commit ARGUS outputs.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    owner, repo, sha = resolve_commit_coordinates(
        commit_url=args.commit_url,
        owner=args.owner,
        repo=args.repo,
        commit_hash=args.commit_hash,
    )
    output_path = retrieve_artifacts(owner, repo, sha, Path(args.output_root))
    print(f"Artifacts saved to {output_path}")


def resolve_commit_coordinates(
    commit_url: str | None,
    owner: str | None,
    repo: str | None,
    commit_hash: str | None,
) -> tuple[str, str, str]:
    if commit_url:
        match = re.search(r"github\.com/([^/]+)/([^/]+)/commit/([a-fA-F0-9]+)", commit_url)
        if not match:
            raise ValueError(f"Unsupported commit URL: {commit_url}")
        return match.group(1), match.group(2), match.group(3)

    if owner and repo and commit_hash:
        return owner, repo, commit_hash

    raise ValueError("Provide either --commit-url or --owner/--repo/--hash.")


def retrieve_artifacts(owner: str, repo: str, sha: str, output_root: Path) -> Path:
    session = build_session()
    commit = fetch_commit(owner, repo, sha, session)
    commit_id = numeric_commit_id(sha)
    commit_url = f"https://github.com/{owner}/{repo}/commit/{sha}"

    issue_ids, pr_ids = extract_issue_pr_ids(commit["commit"]["message"], owner, repo, session)

    issue_info = [fetch_issue_bundle(owner, repo, issue_id, session) for issue_id in issue_ids]
    pr_info = [fetch_pull_request_bundle(owner, repo, pr_id, session) for pr_id in pr_ids]

    enrich_commit_files(commit, session)

    seen_ids = set(issue_ids) | set(pr_ids)
    ref_issue_info, ref_pr_info = search_reference_artifacts(owner, repo, sha, seen_ids, session)
    seen_ids |= {issue["number"] for issue in ref_issue_info}
    seen_ids |= {pr["number"] for pr in ref_pr_info}

    add_ref_issue_info, add_ref_pr_info = fetch_additional_reference_artifacts(
        owner=owner,
        repo=repo,
        seen_ids=seen_ids,
        artifacts=issue_info + pr_info + ref_issue_info + ref_pr_info,
        session=session,
    )

    payload = {
        "commit_id": commit_id,
        "commit_url": commit_url,
        "owner": owner,
        "repo": repo,
        "sha": sha,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "issue_ids": issue_ids,
        "pr_ids": pr_ids,
        "commit_info": commit,
        "issue_info": issue_info,
        "pr_info": pr_info,
        "ref_issue_info": ref_issue_info,
        "ref_pr_info": ref_pr_info,
        "add_ref_issue_info": add_ref_issue_info,
        "add_ref_pr_info": add_ref_pr_info,
    }

    output_dir = get_commit_output_dir(output_root, owner, repo, sha)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "artifacts.json"
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return output_path


def build_session() -> requests.Session:
    session = requests.Session()
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"token {token}"
    session.headers.update(headers)
    return session


def github_get(session: requests.Session, url: str, *, params: dict[str, Any] | None = None) -> Any:
    response = session.get(url, params=params, timeout=60)
    if response.status_code >= 400:
        raise RuntimeError(f"GitHub request failed: {response.status_code} {url} {response.text}")
    return response.json()


def fetch_commit(owner: str, repo: str, sha: str, session: requests.Session) -> dict[str, Any]:
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits/{sha}"
    return github_get(session, url)


def fetch_issue_bundle(
    owner: str,
    repo: str,
    issue_id: int,
    session: requests.Session,
) -> dict[str, Any]:
    issue = github_get(session, f"{GITHUB_API_BASE}/repos/{owner}/{repo}/issues/{issue_id}")
    issue["comments_details"] = fetch_paginated(issue.get("comments_url"), session)
    return issue


def fetch_pull_request_bundle(
    owner: str,
    repo: str,
    pr_id: int,
    session: requests.Session,
) -> dict[str, Any]:
    pull_request = github_get(session, f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls/{pr_id}")
    pull_request["comments_details"] = fetch_paginated(pull_request.get("comments_url"), session)
    pull_request["review_comments_details"] = fetch_paginated(
        pull_request.get("review_comments_url"),
        session,
    )
    return pull_request


def fetch_paginated(url: str | None, session: requests.Session) -> list[dict[str, Any]]:
    if not url:
        return []

    results: list[dict[str, Any]] = []
    page = 1
    clean_url = url.split("{", 1)[0]
    while True:
        batch = github_get(session, clean_url, params={"per_page": 100, "page": page})
        if not batch:
            break
        results.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return results


def extract_issue_pr_ids(
    text: str | None,
    owner: str,
    repo: str,
    session: requests.Session,
) -> tuple[list[int], list[int]]:
    issue_ids: list[int] = []
    pr_ids: list[int] = []
    for artifact_id in extract_github_ids(text, owner, repo):
        if is_pull_request(owner, repo, artifact_id, session):
            pr_ids.append(artifact_id)
        elif is_issue(owner, repo, artifact_id, session):
            issue_ids.append(artifact_id)
    return sorted(set(issue_ids)), sorted(set(pr_ids))


def extract_github_ids(text: str | None, owner: str | None = None, repo: str | None = None) -> list[int]:
    if not text:
        return []

    patterns = [
        r"#(\d+)",
        r"gh.?(\d+)",
        r"issue.?(\d+)",
        r"pull.?(\d+)",
    ]
    if owner and repo:
        patterns.extend(
            [
                rf"{re.escape(repo)}-(\d+)",
                rf"github\.com/{re.escape(owner)}/{re.escape(repo)}/issues/(\d+)",
                rf"github\.com/{re.escape(owner)}/{re.escape(repo)}/pull/(\d+)",
            ]
        )

    ids: set[int] = set()
    for pattern in patterns:
        for match in re.findall(pattern, text, flags=re.IGNORECASE):
            ids.add(int(match))
    return sorted(ids)


def is_pull_request(owner: str, repo: str, artifact_id: int, session: requests.Session) -> bool:
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls/{artifact_id}"
    response = session.get(url, timeout=60)
    if response.status_code == 200:
        return True
    if response.status_code == 404:
        return False
    raise RuntimeError(f"Failed to classify PR {artifact_id}: {response.status_code} {response.text}")


def is_issue(owner: str, repo: str, artifact_id: int, session: requests.Session) -> bool:
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/issues/{artifact_id}"
    response = session.get(url, timeout=60)
    if response.status_code == 200:
        payload = response.json()
        return "pull_request" not in payload
    if response.status_code == 404:
        return False
    raise RuntimeError(f"Failed to classify issue {artifact_id}: {response.status_code} {response.text}")


def search_reference_artifacts(
    owner: str,
    repo: str,
    sha: str,
    seen_ids: set[int],
    session: requests.Session,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    search_url = f"{GITHUB_API_BASE}/search/issues"
    items: list[dict[str, Any]] = []
    for qualifier in ("is:issue", "is:pr"):
        query = f"repo:{owner}/{repo} {sha} {qualifier}"
        items.extend(github_get(session, search_url, params={"q": query, "per_page": 100}).get("items", []))

    issue_info: list[dict[str, Any]] = []
    pr_info: list[dict[str, Any]] = []
    for item in items:
        number = item["number"]
        if number in seen_ids:
            continue
        if item["html_url"].split("/")[-2] == "pull":
            if pull_request_merged(owner, repo, number, session):
                pr_info.append(fetch_pull_request_bundle(owner, repo, number, session))
        else:
            issue_info.append(fetch_issue_bundle(owner, repo, number, session))
    return issue_info, pr_info


def pull_request_merged(owner: str, repo: str, pr_id: int, session: requests.Session) -> bool:
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls/{pr_id}/merge"
    response = session.get(url, timeout=60)
    if response.status_code == 204:
        return True
    if response.status_code == 404:
        return False
    raise RuntimeError(f"Failed to check merge status for PR {pr_id}: {response.status_code} {response.text}")


def fetch_additional_reference_artifacts(
    owner: str,
    repo: str,
    seen_ids: set[int],
    artifacts: list[dict[str, Any]],
    session: requests.Session,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    texts: list[str] = []
    for artifact in artifacts:
        texts.extend(artifact_texts(artifact))

    found_ids: set[int] = set()
    for text in texts:
        found_ids.update(extract_github_ids(text, owner, repo))

    issue_info: list[dict[str, Any]] = []
    pr_info: list[dict[str, Any]] = []
    for artifact_id in sorted(found_ids - seen_ids):
        if is_pull_request(owner, repo, artifact_id, session):
            if pull_request_merged(owner, repo, artifact_id, session):
                pr_info.append(fetch_pull_request_bundle(owner, repo, artifact_id, session))
        elif is_issue(owner, repo, artifact_id, session):
            issue_info.append(fetch_issue_bundle(owner, repo, artifact_id, session))
    return issue_info, pr_info


def artifact_texts(artifact: dict[str, Any]) -> list[str]:
    texts = [artifact.get("title") or "", artifact.get("body") or ""]
    for comment in artifact.get("comments_details", []):
        texts.append(comment.get("body") or "")
    for comment in artifact.get("review_comments_details", []):
        texts.append(comment.get("body") or "")
    return [text for text in texts if text]


def enrich_commit_files(commit: dict[str, Any], session: requests.Session) -> None:
    for file_info in commit.get("files", []):
        added_comments, removed_comments = get_comments_from_code_change(file_info)
        file_info["added_comments"] = added_comments
        file_info["removed_comments"] = removed_comments
        class_docstrings, method_docstrings = get_docstring_info(file_info, session)
        file_info["class_docstrings"] = class_docstrings or []
        file_info["method_docstrings"] = method_docstrings or []


def get_comments_from_code_change(file_info: dict[str, Any]) -> tuple[list[str], list[str]]:
    if not file_info.get("filename", "").endswith(".java"):
        return [], []

    patch_text = file_info.get("patch") or ""
    return get_changed_comments(patch_text, "+"), get_changed_comments(patch_text, "-")


def get_changed_comments(patch_text: str, sign: str) -> list[str]:
    changes: list[str] = []
    javadoc_pattern = re.compile(rf"^[{re.escape(sign)}]\s*\*\s?(.*)")
    inline_pattern = re.compile(rf"^[{re.escape(sign)}].*?//\s?(.*)")
    current = ""

    for line in patch_text.splitlines():
        matched = False
        for pattern in (javadoc_pattern, inline_pattern):
            match = pattern.match(line)
            if match:
                piece = match.group(1).strip()
                current = f"{current} {piece}".strip()
                matched = True
                break
        if not matched and current:
            changes.append(current)
            current = ""

    if current:
        changes.append(current)
    return changes


def get_docstring_info(
    file_info: dict[str, Any],
    session: requests.Session,
) -> tuple[list[tuple[str, str]], list[tuple[str, str]]] | tuple[None, None]:
    if not file_info.get("filename", "").endswith(".java"):
        return None, None

    patch = file_info.get("patch") or ""
    raw_url = file_info.get("raw_url")
    if not patch or not raw_url:
        return None, None

    changed_lines = get_changed_target_lines(patch)
    raw_file = session.get(raw_url, timeout=60)
    if raw_file.status_code >= 400:
        raise RuntimeError(f"Failed to fetch raw file {raw_url}: {raw_file.status_code} {raw_file.text}")
    lines = raw_file.text.splitlines()

    class_blocks = find_blocks(lines, r"\b(class|interface|enum)\s+([A-Za-z_]\w*)")
    method_blocks = find_blocks(
        lines,
        r"\b(public|protected|private|static)\b.*?\b([A-Za-z_]\w*)\s*\([^)]*\)\s*\{",
    )

    class_docstrings: list[tuple[str, str]] = []
    method_docstrings: list[tuple[str, str]] = []

    for name, start, end in class_blocks:
        if any(start <= line_number <= end for line_number in changed_lines):
            doc = extract_javadoc_above(lines, start)
            if doc:
                class_docstrings.append((name, clean_javadoc(doc)))

    for name, start, end in method_blocks:
        if any(start <= line_number <= end for line_number in changed_lines):
            doc = extract_javadoc_above(lines, start)
            if doc:
                method_docstrings.append((name, clean_javadoc(doc)))

    return class_docstrings, method_docstrings


def get_changed_target_lines(patch: str) -> set[int]:
    changed: set[int] = set()
    current_new_line: int | None = None

    for raw in patch.splitlines():
        match = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", raw)
        if match:
            current_new_line = int(match.group(1))
            continue

        if current_new_line is None or raw.startswith(("+++", "---")):
            continue

        if raw.startswith("+"):
            changed.add(current_new_line)
            current_new_line += 1
        elif raw.startswith("-"):
            changed.add(current_new_line)
        elif raw.startswith(" "):
            current_new_line += 1

    return changed


def find_blocks(lines: list[str], signature_regex: str) -> list[tuple[str, int, int]]:
    text = "\n".join(lines)
    blocks: list[tuple[str, int, int]] = []

    for match in re.finditer(signature_regex, text):
        name = match.group(2)
        start_line = text[: match.start()].count("\n") + 1

        depth = 0
        seen_open = False
        for index in range(start_line - 1, len(lines)):
            opens = lines[index].count("{")
            closes = lines[index].count("}")
            if opens:
                depth += opens
                seen_open = True
            if closes:
                depth -= closes
            if seen_open and depth == 0:
                blocks.append((name, start_line, index + 1))
                break

    return blocks


def extract_javadoc_above(lines: list[str], start_line: int) -> str | None:
    index = start_line - 2
    while index >= 0 and (not lines[index].strip() or lines[index].strip().startswith("@")):
        index -= 1

    if index < 0 or not lines[index].strip().endswith("*/"):
        return None

    doc_lines: list[str] = []
    while index >= 0:
        doc_lines.insert(0, lines[index])
        if lines[index].strip().startswith("/**"):
            return "\n".join(doc_lines).strip()
        index -= 1
    return None


def clean_javadoc(docstring: str) -> str:
    text = docstring.strip()
    if text.startswith("/**"):
        text = text[3:]
    if text.endswith("*/"):
        text = text[:-2]

    lines = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("*"):
            stripped = stripped[1:].lstrip()
        if stripped:
            lines.append(stripped)
    return " ".join(lines)


def numeric_commit_id(sha: str) -> int:
    return int(sha[:12], 16) % 100_000_000


def get_commit_output_dir(output_root: Path, owner: str, repo: str, sha: str) -> Path:
    slug = f"{owner}__{repo}__{sha[:12]}"
    return output_root / slug


if __name__ == "__main__":
    main()
