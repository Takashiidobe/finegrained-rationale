import re

BLOCK_BOUNDARY = re.compile(r"\n\s*\n|\n(?=\s*(?:[-*+]|\d+[.)])\s)")
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[`#*]?[A-Z0-9])")
ABBREVIATIONS = ("e.g.", "i.e.", "etc.", "vs.", "cf.", "approx.", "Mr.", "Mrs.", "Ms.", "Dr.", "Fig.", "No.")


def split_sentences(text: str | None) -> list[str]:
    if not text:
        return []
    sentences: list[str] = []
    for block in BLOCK_BOUNDARY.split(text):
        block = " ".join(block.split())
        if not block:
            continue
        pieces: list[str] = []
        for piece in SENTENCE_BOUNDARY.split(block):
            if pieces and pieces[-1].endswith(ABBREVIATIONS):
                pieces[-1] = f"{pieces[-1]} {piece}"
            else:
                pieces.append(piece)
        sentences.extend(pieces)
    return sentences
