import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "ARGUS"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from csv_utils import write_csv_rows
from rationale_generation import build_generation_prompt, generate_rationale_summary
from rationale_sources import build_references, citation_id, resolve_component_citations
import selection_synthesis


class RationaleSourcesTest(unittest.TestCase):
    def setUp(self):
        self.row = {
            "id": "12_5_3_0", "sha": "abc1234", "source": "ISSUE", "source_id": "5", "text_id": "3",
            "source_url": "https://github.com/owner/repo/issues/42#issuecomment-123",
            "sentence": 'The firewall was lost, even with "custom" settings.\nThis breaks requests.',
            "final_labels": "GOAL, NEED",
        }
        self.artifacts = {
            "owner": "owner", "repo": "repo", "commit_id": 12,
            "commit_url": "https://github.com/owner/repo/commit/abc1234", "commit_info": {"files": []},
        }

    def test_sources_preserve_csv_provenance_and_separate_commits(self):
        references = build_references([self.row, self.row, {**self.row, "sha": "def5678"}])
        self.assertEqual(len(references), 2)
        self.assertNotEqual(references[0]["id"], references[1]["id"])
        self.assertEqual(references[0]["sentenceId"], self.row["id"])
        self.assertEqual(references[0]["url"], self.row["source_url"])
        self.assertEqual(references[0]["sentence"], self.row["sentence"])
        self.assertEqual(references[0]["labels"], ["GOAL", "NEED"])

    def test_unsafe_urls_and_unlabeled_evidence_are_excluded(self):
        for changes in [{"source_url": "javascript:alert(1)"}, {"source_url": "https://notgithub.com/x"}, {"source_url": "https://user@github.com/x"}, {"final_labels": ""}, {"id": ""}]:
            self.assertEqual(build_references([{**self.row, **changes}]), [])

    def test_unknown_and_wrong_component_citations_are_removed(self):
        marker = f"[^{citation_id(self.row)}]"
        resolved = resolve_component_citations({"NEED": f"Supported.{marker}[^invented]", "ALTERNATIVES": f"Unsupported.{marker}"}, build_references([self.row]))
        self.assertEqual(resolved["NEED"], f"Supported.{marker}")
        self.assertEqual(resolved["ALTERNATIVES"], "Unsupported.")

    def test_generation_carries_real_csv_evidence_into_the_summary(self):
        marker = f"[^{citation_id(self.row)}]"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            artifacts_path = output / "artifacts.json"
            artifacts_path.write_text(json.dumps(self.artifacts), encoding="utf-8")
            csv_path = output / "identified_rationale_sentences.csv"
            write_csv_rows(csv_path, [self.row])
            with patch("rationale_generation.request_openai_response", return_value=f"NEED: Keep the firewall.{marker}[^invented]") as generate:
                summary_path = generate_rationale_summary(artifacts_path, csv_path, output, "test-model", "CG-FS")
            prompt = generate.call_args.args[0]
            self.assertIn(f"Id: {citation_id(self.row)}", prompt)
            self.assertIn("Allowed source IDs", prompt)
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertEqual(summary["components"]["NEED"], f"Keep the firewall.{marker}")
            self.assertEqual(summary["references"][0]["sentence"], self.row["sentence"])
            self.assertEqual(summary["references"][0]["url"], self.row["source_url"])

    def test_no_evidence_does_not_request_invented_citations(self):
        prompt = build_generation_prompt(self.artifacts, [], "CG-FS")
        self.assertNotIn("Allowed source IDs", prompt)
        self.assertEqual(build_references([]), [])

    def test_selection_synthesis_keeps_sources_from_multiple_commits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commits = []
            expected_references = []
            for sha in ["abc1234", "def5678"]:
                row = {**self.row, "sha": sha}
                refs = build_references([row])
                expected_references.extend(refs)
                summary_path = root / f"{sha}.json"
                summary_path.write_text(json.dumps({"components": {"NEED": f"Keep the firewall.[^{citation_id(row)}]"}, "references": refs}), encoding="utf-8")
                commits.append({"sha": sha, "lines": 3, "url": f"https://github.com/owner/repo/commit/{sha}", "summary_path": str(summary_path)})
            input_path = root / "input.json"
            input_path.write_text(json.dumps({"repository": "owner/repo", "file": "file.py", "start_line": 1, "end_line": 6, "code": "code", "commits": commits}), encoding="utf-8")
            output_path = root / "selection.json"
            response = "NEED: Preserve settings." + "".join(f"[^{ref['id']}]" for ref in expected_references)
            with patch.object(sys, "argv", ["selection_synthesis.py", "--input", str(input_path), "--output", str(output_path), "--model", "test-model"]), patch.object(selection_synthesis, "generate_text", return_value=response) as generate:
                selection_synthesis.main()
            result = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(result["components"]["NEED"], response.removeprefix("NEED: "))
            self.assertEqual(result["references"], expected_references)
            self.assertIn(self.row["sentence"], generate.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
