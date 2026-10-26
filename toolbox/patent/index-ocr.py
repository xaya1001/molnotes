#!/usr/bin/env python3
"""Keep PDF page boundaries and index paragraph numbers without correcting OCR."""
import argparse
import json
from pathlib import Path
import re
import pymupdf as fitz


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("pdf", type=Path, help="searchable/OCR PDF")
    p.add_argument("output", type=Path)
    args = p.parse_args()
    with fitz.open(args.pdf) as doc:
        pages = [page.get_text() for page in doc]
    paragraphs = {}
    duplicates = {}
    for number, text in enumerate(pages, 1):
        for match in re.finditer(r"\[(\d{4})\]", text):
            key = match[1]
            if key in paragraphs and paragraphs[key] != number:
                duplicates.setdefault(key, [paragraphs[key]]).append(number)
            else:
                paragraphs[key] = number
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in [("pages-text", pages), ("paragraphs", paragraphs), ("paragraph-conflicts", duplicates)]:
        (args.output / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(pages)} pages; {len(paragraphs)} paragraph candidates; {len(duplicates)} ambiguous numbers")
    if duplicates:
        raise SystemExit("Resolve paragraph-conflicts.json against page images before publishing")


if __name__ == "__main__":
    main()
