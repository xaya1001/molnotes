#!/usr/bin/env python3
"""Resolve explicit input names; cache evidence, never approve structures."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


def resolve(name, provider, cache):
    endpoint = ("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + urllib.parse.quote(name, safe="") + "/property/SMILES/JSON" if provider == "pubchem" else "https://www.ebi.ac.uk/opsin/ws/" + urllib.parse.quote(name, safe="") + ".json")
    target = cache / (hashlib.sha256(endpoint.encode()).hexdigest() + ".json")
    if target.exists():
        return json.loads(target.read_text())
    result = {"provider": provider, "name": name, "url": endpoint, "checked": time.strftime("%Y-%m-%d", time.gmtime())}
    for attempt in range(3):
        try:
            with urllib.request.urlopen(endpoint, timeout=30) as response:
                body = json.load(response)
            result["response"] = body
            if provider == "pubchem":
                result["candidates"] = [{"smiles": p["SMILES"], "cid": p["CID"]} for p in body["PropertyTable"]["Properties"]]
            else:
                result["candidates"] = ([{"smiles": body["smiles"]}] if body.get("status") == "SUCCESS" else [])
            break
        except urllib.error.HTTPError as error:
            result["error"] = f"HTTP {error.code}"
            result["httpStatus"] = error.code
            result["response"] = error.read().decode("utf-8", errors="replace")
            if error.code == 404:
                result["candidates"] = []
                break
            if error.code not in (429, 500, 502, 503, 504):
                raise
        except (TimeoutError, urllib.error.URLError) as error:
            result["error"] = type(error).__name__
        time.sleep(2 ** (attempt + 1))
    # Do not permanently cache temporary failures; reruns retry them.
    if "candidates" in result:
        result.pop("error", None)
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    time.sleep(0.3)  # serial requests: below PubChem's five requests/second limit
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path, help='JSON array: [{"id":..., "name":"..."}]')
    p.add_argument("output", type=Path)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--providers", nargs="+", choices=["pubchem", "opsin"], default=["pubchem", "opsin"])
    args = p.parse_args()
    records = json.loads(args.input.read_text())
    if not isinstance(records, list) or any(not isinstance(r.get("name"), str) or not r["name"].strip() for r in records):
        p.error("input must be records with nonempty name")
    if len({str(r["id"]) for r in records}) != len(records):
        p.error("duplicate id")
    args.cache.mkdir(parents=True, exist_ok=True)
    results = []
    for record in records:
        results.append({"id": record["id"], "name": record["name"], "results": [resolve(record["name"], provider, args.cache) for provider in args.providers]})
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        print(f"{record['id']}: {sum(len(r.get('candidates', [])) for r in results[-1]['results'])} candidates", flush=True)


if __name__ == "__main__":
    main()
