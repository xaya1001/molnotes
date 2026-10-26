"""Neutral authoring fixtures; no patent material is needed."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import pymupdf as fitz

ROOT = Path(__file__).parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class TableAuditTests(unittest.TestCase):
    def setUp(self):
        self.audit = module("table-audit").audit
        self.records = [{"id": 1, "a": "A", "b": "", "c": "--"}]
        self.scales = {key: ["A", "B"] for key in "abcd"}
        self.cells = [{"id": "1", "field": field, "state": state, "value": value, "reviewer": "fixture", "date": "2026-01-01", "page": "1"} for field, state, value in [("a", "grade", "A"), ("b", "blank", ""), ("c", "dash", ""), ("d", "unlisted", "")]]

    def test_missing_states_remain_distinct(self):
        self.assertEqual(self.audit(self.records, self.cells, self.scales), [])
        self.records[0]["b"] = "--"
        self.assertEqual(self.audit(self.records, self.cells, self.scales)[0]["field"], "b")

    def test_incomplete_and_duplicate_checklists_fail(self):
        for cells in (self.cells[:-1], self.cells + self.cells[:1]):
            with self.assertRaises(ValueError):
                self.audit(self.records, cells, self.scales)

    def test_unreviewed_cell_is_not_approved(self):
        self.cells[0]["reviewer"] = ""
        self.assertFalse(self.audit(self.records, self.cells, self.scales)[0]["reviewed"])


class PdfTests(unittest.TestCase):
    def test_page_and_crop_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "sample.pdf"
            doc = fitz.open()
            page = doc.new_page(width=612, height=792)
            page.insert_text((50, 50), "[0001] Sample A")
            doc.new_page(width=612, height=792)
            doc.save(pdf)
            renderer = module("render-pages")
            result = renderer.render(pdf, root / "images", 72, [{"page": 1, "asset": "section", "rect": [40, 20, 200, 80]}])
            self.assertEqual(result[0]["pageSize"], [612, 792])
            self.assertEqual(len(result[0]["sha256"]), 64)
            with self.assertRaises(ValueError):
                renderer.render(pdf, root / "bad", 72, [{"page": 1, "rect": [-1, 0, 100, 100]}])
            subprocess.run(["python3", str(ROOT / "index-ocr.py"), str(pdf), str(root / "ocr")], check=True, capture_output=True)
            self.assertEqual(len(json.loads((root / "ocr/pages-text.json").read_text())), 2)
            self.assertEqual(json.loads((root / "ocr/paragraphs.json").read_text()), {"0001": 1})
            grid = root / "grid.json"
            grid.write_text(json.dumps([{"id": 1, "field": "grade", "page": 1, "rect": [40, 20, 200, 80]}]))
            subprocess.run(["python3", str(ROOT / "extract-cells.py"), str(pdf), str(grid), str(root / "cells.csv")], check=True)
            self.assertIn("pending", (root / "cells.csv").read_text())


if __name__ == "__main__":
    unittest.main()
