# ARGUS

This folder contains a standalone, single-commit version of the ARGUS pipeline.

The original repository scripts are designed for the full dataset. The modules in this folder are different: they start from one commit, collect the related artifacts for that commit, identify rationale-bearing sentences, and then generate a short rationale summary.

The three modules are:

1. `artifact_retrieval.py`
2. `rationale_sentence_identifier.py`
3. `rationale_generation.py`

Run all commands from the repository root: `finegrained-rationale/`.

## What Each Module Does

### 1. `artifact_retrieval.py`

This module takes one commit as input and saves the artifacts that ARGUS uses later.

In plain terms, it:

- fetches the GitHub commit metadata and changed files
- reads the commit message and extracts issue / pull request references
- fetches directly linked issues and pull requests
- fetches pull request review comments
- mines added / removed code comments from Java patch hunks
- mines changed Java class and method Javadocs from changed files
- searches for extra GitHub issues / pull requests that mention the commit SHA
- searches for additional issue / pull request IDs mentioned inside the retrieved artifacts

Its output is one file: `artifacts.json`.

### 2. `rationale_sentence_identifier.py`

This module reads the saved artifacts and converts them into sentence-level records.

In plain terms, it:

- splits artifact text into individual sentences with the rule-based splitter in `sentence_splitter.py`
- assigns a stable sentence ID to each sentence
- builds the rationale identification prompt
- asks the LLM to label sentences with `GOAL`, `NEED`, and `ALTERNATIVES`
- runs the prompt multiple times
- applies majority voting across runs
- saves both the full labeled sentence table and the rationale-only subset

Its main outputs are:

- `sentences.csv` / `sentences.json`
- `identification_prompt.txt`
- `identification_response_run_1.csv`, `identification_response_run_2.csv`, `identification_response_run_3.csv`
- `sentences_labeled.csv` / `sentences_labeled.json`
- `identified_rationale_sentences.csv` / `identified_rationale_sentences.json`

### 3. `rationale_generation.py`

This module reads the rationale-bearing sentences and asks the LLM to synthesize a concise rationale summary.

In plain terms, it:

- groups the already-labeled rationale sentences by source
- builds the rationale generation prompt
- asks the LLM to write `GOAL`, `NEED`, and `ALTERNATIVES` summaries
- saves both the raw text response and a structured JSON version

Its outputs are:

- `rationale_generation_prompt.txt`
- `rationale_summary.txt`
- `rationale_summary.json`

## Inputs

All three modules accept either:

- `--commit-url`
- or `--owner`, `--repo`, and `--hash`

### Input Flags

#### `--commit-url`

Example:

```bash
--commit-url https://github.com/spring-projects/spring-boot/commit/ad8f14e7855aaf71063f6ae200064c6c6185be00
```

Use this when you already have the full GitHub commit URL.

#### `--owner`

GitHub repository owner, for example:

```bash
--owner spring-projects
```

#### `--repo`

GitHub repository name, for example:

```bash
--repo spring-boot
```

#### `--hash`

Full commit SHA, for example:

```bash
--hash ad8f14e7855aaf71063f6ae200064c6c6185be00
```

### Optional Flags

#### `--output-root`

Root directory where the single-commit ARGUS results are saved.

Default:

```bash
data/generated/ARGUS
```

Each commit gets its own subdirectory:

```text
data/generated/ARGUS/<owner>__<repo>__<sha-prefix>/
```

Example:

```text
data/generated/ARGUS/spring-projects__spring-boot__ad8f14e7855a/
```

#### `--artifacts-file`

Only used by `rationale_sentence_identifier.py` and `rationale_generation.py`.

This lets you skip lookup by commit URL or SHA and point directly to an existing `artifacts.json`.

#### `--identified-file`

Only used by `rationale_generation.py`.

This lets you point directly to an existing `identified_rationale_sentences.csv`.

#### `--model`

Used by:

- `rationale_sentence_identifier.py`
- `rationale_generation.py`

This is the OpenAI model name used for the LLM call.

Default:

```bash
o4-mini
```

#### `--runs`

Only used by `rationale_sentence_identifier.py`.

This controls how many times the sentence labeling prompt is run before majority voting.

Default:

```bash
3
```

#### `--prompt-strategy`

Used by:

- `rationale_sentence_identifier.py`
- `rationale_generation.py`

This selects a prompt template from:

- `data/CIPromptTemplate.csv`
- `data/CGPromptTemplate.csv`

Defaults:

- identification: `CI-FS`
- generation: `CG-FS`

## Environment Requirements

You need:

- a Python environment with the repo dependencies installed
- `GITHUB_TOKEN` for GitHub API access
- `OPENAI_TOKEN` or `OPENAI_API_KEY` for the LLM stages

The retrieval module only needs `GITHUB_TOKEN`.

The identification and generation modules need both GitHub access and OpenAI access if they have to regenerate upstream inputs.

## How to Run for One Commit

### Step 0. Activate the environment

```bash
source .venv/bin/activate (works with python 3.12)
```

### Step 1. Retrieve artifacts

Using a commit URL:

```bash
python scripts/ARGUS/artifact_retrieval.py \
  --commit-url https://github.com/spring-projects/spring-boot/commit/ad8f14e7855aaf71063f6ae200064c6c6185be00
```

Or using owner / repo / hash:

```bash
python scripts/ARGUS/artifact_retrieval.py \
  --owner spring-projects \
  --repo spring-boot \
  --hash ad8f14e7855aaf71063f6ae200064c6c6185be00
```

### Step 2. Identify rationale sentences

```bash
python scripts/ARGUS/rationale_sentence_identifier.py \
  --commit-url https://github.com/spring-projects/spring-boot/commit/ad8f14e7855aaf71063f6ae200064c6c6185be00
```

### Step 3. Generate rationale summary

```bash
python scripts/ARGUS/rationale_generation.py \
  --commit-url https://github.com/spring-projects/spring-boot/commit/ad8f14e7855aaf71063f6ae200064c6c6185be00
```

If you already have the intermediate files, you can call later stages directly:

```bash
python scripts/ARGUS/rationale_sentence_identifier.py \
  --artifacts-file data/generated/ARGUS/spring-projects__spring-boot__ad8f14e7855a/artifacts.json

python scripts/ARGUS/rationale_generation.py \
  --artifacts-file data/generated/ARGUS/spring-projects__spring-boot__ad8f14e7855a/artifacts.json \
  --identified-file data/generated/ARGUS/spring-projects__spring-boot__ad8f14e7855a/identified_rationale_sentences.csv
```

## Output Directory

For the Spring Boot example commit, the output directory is:

```text
data/generated/ARGUS/spring-projects__spring-boot__ad8f14e7855a/
```

The directory contains:

- `artifacts.json`
- `sentences.csv`
- `sentences.json`
- `identification_prompt.txt`
- `identification_response_run_1.csv`
- `identification_response_run_2.csv`
- `identification_response_run_3.csv`
- `sentences_labeled.csv`
- `sentences_labeled.json`
- `identified_rationale_sentences.csv`
- `identified_rationale_sentences.json`
- `rationale_generation_prompt.txt`
- `rationale_summary.txt`
- `rationale_summary.json`

## Output File Guide and Schema

### `artifacts.json`

This is the main retrieval output. It is the raw artifact bundle for one commit.

Top-level schema:

```json
{
  "commit_id": 42645850,
  "commit_url": "https://github.com/<owner>/<repo>/commit/<sha>",
  "owner": "spring-projects",
  "repo": "spring-boot",
  "sha": "ad8f14e7855aaf71063f6ae200064c6c6185be00",
  "retrieved_at": "2026-09-19T...Z",
  "issue_ids": [45377],
  "pr_ids": [51549],
  "commit_info": {...},
  "issue_info": [...],
  "pr_info": [...],
  "ref_issue_info": [...],
  "ref_pr_info": [...],
  "add_ref_issue_info": [...],
  "add_ref_pr_info": [...]
}
```

What each field means:

- `commit_id`: a synthetic numeric ID derived from the commit SHA. It is used only for sentence IDs and local bookkeeping.
- `commit_url`: the GitHub URL of the target commit.
- `owner`, `repo`, `sha`: the resolved repository coordinates.
- `retrieved_at`: UTC timestamp of retrieval.
- `issue_ids`: issue IDs found directly from the commit message.
- `pr_ids`: PR IDs found directly from the commit message.
- `commit_info`: GitHub commit API payload, enriched with mined Java comments and Javadocs.
- `issue_info`: direct issue artifacts linked from the commit message.
- `pr_info`: direct PR artifacts linked from the commit message.
- `ref_issue_info`, `ref_pr_info`: extra issues / PRs found by searching for the commit SHA.
- `add_ref_issue_info`, `add_ref_pr_info`: extra issues / PRs discovered from mentions inside other retrieved artifacts.

Important nested schema notes:

- `commit_info["files"]` is a list of changed files.
- Each file item includes GitHub patch metadata plus:
  - `added_comments`
  - `removed_comments`
  - `class_docstrings`
  - `method_docstrings`

Typical file-level shape:

```json
{
  "filename": "spring-boot-project/...",
  "status": "modified",
  "additions": 10,
  "deletions": 4,
  "changes": 14,
  "blob_url": "https://github.com/...",
  "raw_url": "https://github.com/.../raw/...",
  "patch": "@@ -... +... @@ ...",
  "added_comments": ["..."],
  "removed_comments": ["..."],
  "class_docstrings": [["ClassName", "Javadoc text"]],
  "method_docstrings": [["methodName", "Javadoc text"]]
}
```

Issue / PR entries are mostly GitHub API objects plus:

- `comments_details`
- `review_comments_details` for PRs

### `sentences.csv`

This is the sentence-level expansion of `artifacts.json`.

One row = one sentence.

Columns:

- `id`: stable sentence ID in the format `CommitID_SourceID_TextID_LocalSentenceID`
- `commit_id`
- `commit_url`
- `owner`
- `repo`
- `sha`
- `source_id`: numeric code for the source type
- `text_id`: ID for the original text block inside that source type
- `sentence_id`: sentence offset inside that text block
- `source`: one of `COMMIT_MESSAGE`, `CODE_COMMENT`, `CLASS_JAVADOCS`, `METHOD_JAVADOCS`, `ISSUE`, `PULL_REQUEST`, `CODE_REVIEW_COMMENT`
- `source_url`: URL of the artifact the sentence came from
- `artifact_kind`: more specific source category, for example `commit_message`, `code_comment_added`, `pr_info_body`
- `artifact_number`: issue or PR number when relevant; blank otherwise
- `class_name`: class or method name for Javadocs; blank otherwise
- `text`: the full parent text block before sentence splitting
- `sentence`: the individual sentence used for labeling

The JSON version, `sentences.json`, stores the same information as a list of objects.

### `identification_prompt.txt`

This is the exact prompt sent to the LLM for sentence labeling.

It includes:

- the rationale taxonomy
- the target commit diff
- the grouped sentences by source
- the response format instruction

This file is useful for debugging model behavior.

### `identification_response_run_1.csv`, `identification_response_run_2.csv`, `identification_response_run_3.csv`

These are the raw LLM outputs from the sentence identification stage.

Expected schema:

```csv
sentence_id,labels
42645850_1_1_2,GOAL
42645850_5_1_0,NEED
42645850_5_3_0,"ALTERNATIVES"
42645850_5_10_0,"GOAL, NEED"
```

Notes:

- these files are raw model responses, not post-processed tables
- a row only appears if the model decided that the sentence expresses at least one rationale component
- labels can contain one or more of `GOAL`, `NEED`, `ALTERNATIVES`

### `sentences_labeled.csv`

This is `sentences.csv` plus the labels from all LLM runs and the final majority-voted label.

It has all columns from `sentences.csv`, plus:

- `run_labels`
- `final_labels`

Meaning:

- `run_labels`: the per-run labels before voting
  - in CSV, this is stored as a string representation such as `['GOAL', '', 'GOAL']`
  - in JSON, this is stored as a real list
- `final_labels`: majority-voted label string
  - blank if the sentence was not selected as rationale-bearing

The JSON version, `sentences_labeled.json`, is usually easier to work with programmatically because `run_labels` remains a true list there.

### `identified_rationale_sentences.csv`

This is the filtered subset of `sentences_labeled.csv`.

It contains only rows where `final_labels` is not blank.

Schema:

- exactly the same columns as `sentences_labeled.csv`
- fewer rows

This is the main input to rationale generation.

The JSON version, `identified_rationale_sentences.json`, stores the same rows as a list of objects.

### `rationale_generation_prompt.txt`

This is the exact prompt sent to the LLM for rationale summarization.

It includes:

- the target diff
- only the sentences that survived sentence identification
- each sentence with its final rationale label

### `rationale_summary.txt`

This is the raw text returned by the LLM in the generation stage.

Expected shape:

```text
GOAL: ...
NEED: ...
ALTERNATIVES: ...
```

If the model omits one component, the file may contain only the components it found support for.

### `rationale_summary.json`

This is the structured version of the final rationale output.

Schema:

```json
{
  "commit_id": 42645850,
  "commit_url": "https://github.com/<owner>/<repo>/commit/<sha>",
  "model": "o4-mini",
  "prompt_strategy": "CG-FS",
  "raw_response": "GOAL: ...\nNEED: ...",
  "components": {
    "GOAL": "...",
    "NEED": "...",
    "ALTERNATIVES": "..."
  }
}
```

Meaning:

- `raw_response`: the exact LLM text
- `components`: parsed dictionary of rationale summaries

## Source ID Mapping

The numeric `source_id` values used in sentence IDs are:

- `1`: `COMMIT_MESSAGE`
- `2`: `CODE_COMMENT`
- `3`: `CLASS_JAVADOCS`
- `4`: `METHOD_JAVADOCS`
- `5`: `ISSUE`
- `6`: `PULL_REQUEST`
- `7`: `CODE_REVIEW_COMMENT`

So an ID like `42645850_5_3_1` means:

- `42645850`: commit ID
- `5`: issue source
- `3`: the third issue text block seen for this commit
- `1`: the second sentence inside that text block

## Practical Notes

- Run the modules from the repository root so relative paths to `data/` work correctly.
- Sentence splitting uses the dependency-free, rule-based `sentence_splitter.py`. The original study used the `en_core_web_trf` spaCy model, so sentence boundaries (and therefore sentence IDs) can differ from the published results.
- The current implementation does not create one wrapper script for all three stages; you run the three modules in sequence.
- If an intermediate file already exists and you point a later stage directly to it, the later stage will reuse it.
- The CSV and JSON outputs carry the same information, but JSON preserves Python list structure better for fields like `run_labels`.
