#!/usr/bin/env node
// Run from the repository root (or a tools directory beneath its dependency tree).
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(path.resolve("package.json"));
const RDKit = await require("@rdkit/rdkit")();
const [mode, input, output] = process.argv.slice(2);
if (!["canonicalize", "scope", "review"].includes(mode) || !input || !output)
  throw new Error(
    "Usage: node chemistry.mjs canonicalize|scope|review input.json output",
  );
const data = JSON.parse(await fs.readFile(input, "utf8"));
if (mode === "review") {
  const escape = (value) =>
    String(value).replace(
      /[&<>"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  const cards = data.map((record) => {
    if (!record.image || !record.smiles)
      throw new Error("Review entries require image and smiles");
    const mol = RDKit.get_mol(record.smiles);
    if (!mol?.is_valid()) {
      mol?.delete();
      throw new Error(`Invalid SMILES for ${record.id}`);
    }
    try {
      return `<section><h2>${escape(record.id)}</h2><div class="pair"><img src="${escape(record.image)}" alt="Original ${escape(record.id)}">${mol.get_svg(550, 320)}</div><p>${escape(record.name ?? "")}</p><code>${escape(record.smiles)}</code><p>Connectivity / positions / bond order / isotope / charge / stereo: ______</p><p>Reviewer / date / decision / reason: ______</p></section>`;
    } finally {
      mol.delete();
    }
  });
  await fs.writeFile(
    output,
    `<!doctype html><meta charset="utf-8"><title>Structure review</title><style>body{font:16px sans-serif;margin:2rem}section{break-inside:avoid;border-bottom:1px solid;padding:1rem}.pair{display:flex;align-items:center;gap:1rem}.pair>*{width:48%;object-fit:contain}code{overflow-wrap:anywhere}</style><h1>Original and candidate structures</h1>${cards.join("")}`,
  );
} else if (mode === "canonicalize") {
  // Input candidates are kept separate from published, visually approved SMILES.
  const results = data.map((record) => ({
    ...record,
    results: record.results.map((result) => ({
      ...result,
      candidates: (result.candidates ?? []).map((candidate) => {
        const mol = RDKit.get_mol(candidate.smiles);
        if (!mol || !mol.is_valid()) {
          mol?.delete();
          return { ...candidate, error: "RDKit cannot parse this candidate" };
        }
        try {
          return { ...candidate, canonical: mol.get_smiles() };
        } finally {
          mol.delete();
        }
      }),
    })),
  }));
  await fs.writeFile(
    output,
    JSON.stringify({ rdkit: RDKit.version(), records: results }, null, 2) +
      "\n",
  );
} else {
  if (
    typeof data.note !== "string" ||
    !data.note.trim() ||
    !Array.isArray(data.cases) ||
    !data.cases.length
  )
    throw new Error("Scope input requires note and nonempty cases");
  const query = RDKit.get_qmol(data.smarts);
  if (!query || !query.is_valid()) {
    query?.delete();
    throw new Error("Invalid SMARTS");
  }
  try {
    const cases = data.cases.map((item) => {
      if (typeof item.expected !== "boolean")
        throw new Error("expected must be boolean");
      const mol = RDKit.get_mol(item.smiles);
      if (!mol || !mol.is_valid()) {
        mol?.delete();
        throw new Error(`Invalid SMILES for ${item.id}`);
      }
      try {
        const matched =
          Object.keys(JSON.parse(mol.get_substruct_match(query))).length > 0;
        return { ...item, matched, passed: matched === item.expected };
      } finally {
        mol.delete();
      }
    });
    await fs.writeFile(
      output,
      JSON.stringify(
        { rdkit: RDKit.version(), smarts: data.smarts, note: data.note, cases },
        null,
        2,
      ) + "\n",
    );
    if (cases.some((item) => !item.passed)) process.exitCode = 1;
  } finally {
    query.delete();
  }
}
