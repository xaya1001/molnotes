#!/usr/bin/env python3
"""Render PDF pages or explicitly located segments to lossless WebP."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import pymupdf as fitz
from PIL import Image


def render(pdf, output, dpi, segments):
    if not 72 <= dpi <= 600:
        raise ValueError("DPI must be between 72 and 600")
    output.mkdir(parents=True, exist_ok=True)
    manifest = []
    with fitz.open(pdf) as doc:
        for segment in segments:
            number = segment["page"]
            if not isinstance(number, int) or isinstance(number, bool) or not 1 <= number <= len(doc):
                raise ValueError(f"invalid PDF page: {number}")
            page = doc[number - 1]
            rect = fitz.Rect(segment.get("rect", page.rect))
            if rect.is_empty or rect.is_infinite or not page.rect.contains(rect):
                raise ValueError(f"invalid rectangle on page {number}")
            asset = segment.get("asset", str(number))
            if not isinstance(asset, str) or not asset or Path(asset).name != asset or asset in (".", ".."):
                raise ValueError("asset must be a filename stem")
            dest = output / f"{asset}.webp"
            if any(item["file"] == dest.name for item in manifest):
                raise ValueError(f"duplicate asset: {asset}")
            pix = page.get_pixmap(dpi=dpi, clip=rect, alpha=False)
            Image.open(io.BytesIO(pix.tobytes("png"))).save(dest, "WEBP", lossless=True)
            manifest.append({"file": dest.name, "page": number, "rect": list(rect), "pageSize": [page.rect.width, page.rect.height], "dpi": dpi, "sha256": hashlib.sha256(dest.read_bytes()).hexdigest()})
    return manifest


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("pdf", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--dpi", type=int, default=150)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--pages", nargs=2, type=int, metavar=("FIRST", "LAST"))
    group.add_argument("--segments", type=Path, help='JSON [{page, rect: [x0,y0,x1,y1], asset}] in PDF points')
    args = p.parse_args()
    if args.pages and args.pages[0] > args.pages[1]:
        p.error("FIRST exceeds LAST")
    segments = json.loads(args.segments.read_text()) if args.segments else [{"page": n} for n in range(args.pages[0], args.pages[1] + 1)]
    manifest = render(args.pdf, args.output, args.dpi, segments)
    (args.output / "render-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
