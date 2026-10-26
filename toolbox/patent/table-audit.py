#!/usr/bin/env python3
"""Compare separately transcribed cells with records; never infer missing grades."""
import argparse
import csv
import json
from pathlib import Path


def audit(records, cells, scales):
    index = {str(r["id"]): r for r in records}
    if len(index) != len(records):
        raise ValueError("duplicate record id")
    seen = set()
    errors = []
    for line, cell in enumerate(cells, 2):
        key = (cell["id"], cell["field"])
        if key in seen:
            raise ValueError(f"duplicate cell {key}")
        seen.add(key)
        if cell["id"] not in index or cell["field"] not in scales:
            raise ValueError(f"unknown record/field at CSV line {line}")
        state = cell["state"]
        if state not in ("grade", "blank", "dash", "unlisted"):
            raise ValueError(f"unknown cell state: {state}")
        if state == "grade" and cell["value"] not in scales[cell["field"]]:
            raise ValueError(f"unknown grade: {cell['value']}")
        if state != "grade" and cell["value"]:
            raise ValueError("missing states must have an empty value column")
        r = index[cell["id"]]
        field = cell["field"]
        wanted = {"blank": "", "dash": "--"}.get(state, cell["value"])
        matches = field not in r if state == "unlisted" else field in r and r[field] == wanted
        reviewed = bool(cell["reviewer"].strip() and cell["date"].strip() and cell["page"].strip())
        if not matches or not reviewed:
            errors.append({"id": cell["id"], "field": field, "matches": matches, "reviewed": reviewed})
    # Checklist must cover all expected cells, including unlisted entries.
    expected = {(id, field) for id in index for field in scales}
    if seen != expected:
        raise ValueError(f"incomplete checklist: {len(expected - seen)} missing cells")
    return errors


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("records", type=Path)
    p.add_argument("scales", type=Path, help='JSON {field: [allowed grade strings]}')
    p.add_argument("checklist", type=Path, help="CSV id,field,state,value,page,rect,reviewer,date")
    args = p.parse_args()
    with args.checklist.open(newline="") as stream:
        errors = audit(json.loads(args.records.read_text()), list(csv.DictReader(stream)), json.loads(args.scales.read_text()))
    print(json.dumps({"errors": errors}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(errors))


if __name__ == "__main__":
    main()
