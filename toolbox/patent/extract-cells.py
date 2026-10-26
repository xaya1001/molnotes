#!/usr/bin/env python3
"""Extract OCR text from an author-defined table grid into an unreviewed checklist."""
import argparse
import csv
import json
from pathlib import Path
import pymupdf as fitz


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("pdf", type=Path)
    p.add_argument("grid", type=Path, help='JSON [{id, field, page, rect:[x0,y0,x1,y1]}]')
    p.add_argument("output", type=Path)
    args = p.parse_args()
    cells = json.loads(args.grid.read_text())
    seen = set()
    rows = []
    with fitz.open(args.pdf) as doc:
        for cell in cells:
            key = (str(cell["id"]), cell["field"])
            if key in seen:
                raise ValueError(f"duplicate cell {key}")
            seen.add(key)
            n = cell["page"]
            if not isinstance(n, int) or not 1 <= n <= len(doc):
                raise ValueError("invalid page")
            page = doc[n - 1]
            rect = fitz.Rect(cell["rect"])
            if rect.is_empty or not page.rect.contains(rect):
                raise ValueError(f"invalid rect for {key}")
            text = page.get_textbox(rect).strip()
            # Empty OCR is not proof of a blank printed cell. All states need review.
            rows.append({"id": cell["id"], "field": cell["field"], "state": "pending", "value": text, "page": n, "rect": json.dumps(list(rect)), "reviewer": "", "date": ""})
    with args.output.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["id", "field", "state", "value", "page", "rect", "reviewer", "date"])
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
