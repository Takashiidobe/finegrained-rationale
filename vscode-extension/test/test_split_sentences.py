import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "ARGUS"))

from sentence_splitter import split_sentences


class SplitSentencesTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(split_sentences(None), [])
        self.assertEqual(split_sentences("  \n "), [])

    def test_splits_on_terminal_punctuation(self):
        self.assertEqual(
            split_sentences("Fix the crash. It happened on startup! Why? Nobody knows."),
            ["Fix the crash.", "It happened on startup!", "Why?", "Nobody knows."],
        )

    def test_keeps_code_urls_and_versions_intact(self):
        self.assertEqual(
            split_sentences("Fix NPE in Foo.bar(). See https://github.com/a/b/issues/12 for details. Bump to v1.2.3 now."),
            ["Fix NPE in Foo.bar().", "See https://github.com/a/b/issues/12 for details.", "Bump to v1.2.3 now."],
        )

    def test_does_not_split_after_abbreviations(self):
        self.assertEqual(
            split_sentences("Use a cache, e.g. Redis. This avoids load, i.e. fewer queries."),
            ["Use a cache, e.g. Redis.", "This avoids load, i.e. fewer queries."],
        )

    def test_joins_wrapped_lines_and_splits_paragraphs(self):
        self.assertEqual(
            split_sentences("Summary line\n\nThe body is wrapped\nat seventy two columns. Second sentence."),
            ["Summary line", "The body is wrapped at seventy two columns.", "Second sentence."],
        )

    def test_splits_list_items(self):
        self.assertEqual(
            split_sentences("Changes:\n* bump deps\n- add test\n1. update docs"),
            ["Changes:", "* bump deps", "- add test", "1. update docs"],
        )


if __name__ == "__main__":
    unittest.main()
