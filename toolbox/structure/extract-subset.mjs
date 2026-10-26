#!/usr/bin/env node
// Example of a topic's coordinate-extraction script (copy it to
// sites/<slug>/tools/ and adapt): cuts each RCSB entry listed in a structure
// set down to its declared chains, residue ranges and hetero groups, drops
// hydrogens, water and alternate locations other than the first, and writes
// <out-dir>/<id>.pdb. Runs on the author's machine; the repository keeps the
// result, so the page never calls a structure database.
//
//   node toolbox/structure/extract-subset.mjs <set.json> <out-dir> [dir-with-<pdb>.pdb]
//
// <set.json> has the shape of `defineStructureSet` ({ fetchedOn, entries })
// and only `id`, `source.pdb`, `source.title`, `subset` are read. Without the
// third argument the files are downloaded from https://files.rcsb.org. Each
// output starts with REMARK lines naming the entry, the SHA-256 of the full
// source file, the fetch date and the kept ranges; a topic script also records
// the source hashes in its own header. Selection rules: ATOM records of a
// listed chain inside its residue range; HETATM records whose chain, residue
// name and number are listed; atoms whose altloc is blank or "A" (written back
// with a blank altloc); no hydrogens. Water is never listed, so it is dropped.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [setPath, outDir, sourceDir] = process.argv.slice(2);
if (!setPath || !outDir)
  throw new Error("Usage: extract-subset.mjs <set.json> <out-dir> [pdb-dir]");
const config = JSON.parse(readFileSync(setPath, "utf8"));
mkdirSync(outDir, { recursive: true });

async function source(entry) {
  const code = entry.source.pdb;
  if (sourceDir) return readFileSync(resolve(sourceDir, `${code}.pdb`));
  const response = await fetch(`https://files.rcsb.org/download/${code}.pdb`);
  if (!response.ok) throw new Error(`RCSB ${code}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

for (const entry of config.entries) {
  const bytes = await source(entry);
  const keep = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    const record = line.slice(0, 6);
    if (record !== "ATOM  " && record !== "HETATM") continue;
    const element = line.slice(76, 78).trim();
    const alt = line[16];
    if (element === "H" || element === "D") continue;
    if (alt !== " " && alt !== "A") continue;
    const chain = line[21];
    const resn = line.slice(17, 20).trim();
    const resi = Number(line.slice(22, 26));
    const range = entry.subset.residues[chain];
    const inChain =
      record === "ATOM  " && range && resi >= range[0] && resi <= range[1];
    const hetero =
      record === "HETATM" &&
      entry.subset.hetero.some(
        (h) => h.chain === chain && h.resn === resn && h.resi === resi,
      );
    if (inChain || hetero)
      keep.push(`${line.slice(0, 16)} ${line.slice(17).trimEnd()}`);
  }
  const ranges = Object.entries(entry.subset.residues)
    .map(([chain, [a, b]]) => `chain ${chain} ${a}-${b}`)
    .join("; ");
  const hetero = entry.subset.hetero
    .map((h) => `${h.chain} ${h.resn} ${h.resi}`)
    .join("; ");
  const header = [
    `REMARK   1 SUBSET OF RCSB PDB ${entry.source.pdb}: ${entry.source.title}`,
    `REMARK   1 https://www.rcsb.org/structure/${entry.source.pdb}`,
    `REMARK   1 SOURCE FILE SHA-256 ${createHash("sha256").update(bytes).digest("hex")}`,
    `REMARK   1 FETCHED ${config.fetchedOn}`,
    `REMARK   1 KEPT ${ranges}; HETATM ${hetero}`,
    "REMARK   1 NO HYDROGENS; ALTLOC BLANK OR A ONLY",
  ];
  writeFileSync(
    resolve(outDir, `${entry.id}.pdb`),
    `${[...header, ...keep, "END"].join("\n")}\n`,
  );
  console.log(`${entry.id}: ${keep.length} atoms`);
}
