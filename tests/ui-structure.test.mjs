import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  distance,
  findAtom,
  meanB,
  nearestAtom,
  parsePdb,
  residueAtoms,
} from "../src/ui/structure/pdb.ts";
import {
  defineStructureSet,
  presetDistances,
  residueMatches,
  residueTag,
  selectionMatches,
  verifyStructure,
} from "../src/ui/structure/model.ts";

// Neutral data: a three-residue chain A, one ligand and one zinc.
const record = (kind, serial, name, resn, chain, resi, [x, y, z], b, element) =>
  `${kind.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${resn.padStart(3)} ${chain}${String(resi).padStart(4)}    ` +
  `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}` +
  `${"1.00".padStart(6)}${b.toFixed(2).padStart(6)}          ${element.padStart(2)}`;
const lines = (rows) => `${rows.join("\n")}\nEND\n`;
const rows = [
  record("ATOM", 1, "N", "GLY", "A", 10, [-4, 0, 0], 10, "N"),
  record("ATOM", 2, "CA", "GLY", "A", 10, [-3, 1, 0], 12, "C"),
  record("ATOM", 3, "CA", "TRP", "A", 11, [-1, 1, 0], 14, "C"),
  record("ATOM", 4, "NE1", "TRP", "A", 11, [0, 0, 0], 16, "N"),
  record("ATOM", 5, "CA", "ALA", "A", 12, [4, 0, 0], 20, "C"),
  record("HETATM", 6, "C1", "LIG", "A", 100, [3, 4, 0], 30, "C"),
  record("HETATM", 7, "O1", "LIG", "A", 100, [3, 6, 0], 40, "O"),
  record("HETATM", 8, "ZN", "ZN", "A", 101, [8, 0, 0], 50, "ZN"),
];
const pdb = lines(rows);
const atoms = parsePdb(pdb);

const entry = () => ({
  id: "demo",
  label: "demo · 配体",
  url: "/showcase/demo.pdb",
  source: { pdb: "1ABC", title: "A neutral demo", resolution: 1.8 },
  subset: {
    residues: { A: [10, 12] },
    hetero: [
      { chain: "A", resn: "LIG", resi: 100 },
      { chain: "A", resn: "ZN", resi: 101, name: "锌离子" },
    ],
  },
  ligand: { chain: "A", resn: "LIG", resi: 100, name: "配体" },
  layers: [
    { label: "链 A", select: { chain: "A" }, style: "cartoon", color: "grey" },
    {
      label: "位点",
      select: { chain: "A", resi: ["10-11"] },
      style: "stick",
      color: "orange",
    },
    { label: "锌", select: { elem: "Zn" }, style: "sphere", color: "grey" },
  ],
  labels: { chain: "A", resi: [11] },
  presets: [
    {
      id: "trp-lig",
      label: "W11 NE1 … 配体 C1",
      a: { chain: "A", resi: 11, atom: "NE1" },
      b: { chain: "A", resi: 100, atom: "C1" },
      expect: 5,
    },
  ],
});
const set = (change) => {
  const e = entry();
  change?.(e);
  return () => defineStructureSet({ fetchedOn: "2026-10-12", entries: [e] });
};

test("parsePdb reads fixed columns and rejects text without atoms", () => {
  assert.equal(atoms.length, 8);
  assert.deepEqual(
    { ...atoms[3] },
    {
      atom: "NE1",
      element: "N",
      resn: "TRP",
      chain: "A",
      resi: 11,
      x: 0,
      y: 0,
      z: 0,
      b: 16,
    },
  );
  assert.equal(atoms[7].element, "ZN");
  assert.throws(() => parsePdb("REMARK nothing\nEND\n"), /No atoms/);
  assert.throws(
    () => parsePdb(rows[0].replace("-4.000", "  oops ") + "\n"),
    /Unreadable PDB line/,
  );
});

test("distances come from named atoms and an atom must be named exactly once", () => {
  const w = { chain: "A", resi: 11, atom: "NE1" };
  const c1 = { chain: "A", resi: 100, atom: "C1" };
  assert.equal(distance(atoms, w, c1), 5);
  assert.equal(findAtom(atoms, c1).b, 30);
  assert.throws(
    () => findAtom(atoms, { chain: "A", resi: 11, atom: "CZ" }),
    /found 0/,
  );
  assert.throws(() => findAtom([...atoms, atoms[3]], w), /found 2/);
  const near = nearestAtom(findAtom(atoms, w), residueAtoms(atoms, "A", 100));
  assert.equal(near.atom.atom, "C1");
  assert.equal(near.distance, 5);
  assert.throws(() => nearestAtom(atoms[0], []), /Empty atom group/);
  assert.equal(
    meanB(atoms, [
      { chain: "A", resi: 100, atom: "C1" },
      { chain: "A", resi: 100, atom: "O1" },
    ]),
    35,
  );
});

test("a structure set is checked when it is defined", () => {
  const defined = set()();
  assert.equal(defined.entryById("demo").label, "demo · 配体");
  assert.throws(() => defined.entryById("other"), /Unknown structure/);
  // fields a topic adds to an entry are kept
  const extra = defineStructureSet({
    fetchedOn: "2026-10-12",
    entries: [{ ...entry(), fragments: ["ring"] }],
  });
  assert.deepEqual(extra.entries[0].fragments, ["ring"]);

  assert.throws(
    () => defineStructureSet({ fetchedOn: "2026-10-12", entries: [] }),
    /no entries/,
  );
  assert.throws(
    () =>
      defineStructureSet({
        fetchedOn: "2026-10-12",
        entries: [entry(), entry()],
      }),
    /Duplicate structure demo/,
  );
  assert.throws(
    () => defineStructureSet({ fetchedOn: "12 Oct 2026", entries: [entry()] }),
    /not a date/,
  );
  for (const [change, message] of [
    [
      (e) => (e.url = "https://files.rcsb.org/download/1ABC.pdb"),
      /path on this site/,
    ],
    [(e) => (e.url = "//files.rcsb.org/1ABC.pdb"), /path on this site/],
    [(e) => (e.source.pdb = "ABCDE"), /not a PDB code/],
    [(e) => (e.source.resolution = 0), /resolution/],
    [(e) => (e.subset.residues.A = [12, 10]), /\[first, last\]/],
    [(e) => (e.ligand.resn = "XYZ"), /not in subset\.hetero/],
    [(e) => (e.layers = []), /at least one layer/],
    [(e) => (e.layers[0].color = "teal"), /unknown colour teal/],
    [(e) => (e.layers[0].style = "ribbon"), /unknown style ribbon/],
    [(e) => (e.layers[0].select = {}), /names nothing/],
    [
      (e) => (e.layers[0].select = { chain: "B" }),
      /chain B is not in the subset/,
    ],
    [(e) => (e.layers[1].select = { resi: [10] }), /resi needs a chain/],
    [(e) => (e.layers[1].select.resi = ["12-10"]), /bad residue/],
    [(e) => (e.labels.chain = "B"), /labels need/],
    [(e) => e.presets.push({ ...e.presets[0] }), /duplicate preset trp-lig/],
    [(e) => (e.presets[0].expect = -1), /preset trp-lig: expect/],
    [
      (e) => (e.presets[0].b = { ...e.presets[0].a }),
      /preset trp-lig: a and b are the same atom/,
    ],
  ]) {
    assert.throws(set(change), message, String(change));
  }
});

test("both atoms of a preset must lie in the entry's coordinate subset", () => {
  // chain B is not kept
  assert.throws(
    set((e) => (e.presets[0].b = { chain: "B", resi: 11, atom: "CA" })),
    /Structure demo preset trp-lig atom b: atom B11 CA is outside the coordinate subset/,
  );
  // residue 13 is past the kept range 10–12 and is not a hetero group
  assert.throws(
    set((e) => (e.presets[0].a = { chain: "A", resi: 13, atom: "CA" })),
    /preset trp-lig atom a: atom A13 CA is outside the coordinate subset/,
  );
  // a kept hetero group counts
  assert.doesNotThrow(
    set((e) => (e.presets[0].b = { chain: "A", resi: 101, atom: "ZN" })),
  );
});

test("verifyStructure compares the declaration with the coordinates", () => {
  const e = entry();
  verifyStructure(e, atoms);
  const measured = presetDistances(e, atoms);
  assert.equal(measured[0].value, 5);

  const withExpect = (expect) => ({
    ...e,
    presets: [{ ...e.presets[0], expect }],
  });
  verifyStructure(withExpect(5.004), atoms);
  assert.throws(
    () => verifyStructure(withExpect(5.006), atoms),
    /preset trp-lig: expects 5\.006 Å, the coordinates give 5\.000 Å/,
  );
  assert.throws(
    () =>
      verifyStructure(
        {
          ...e,
          presets: [
            { ...e.presets[0], b: { chain: "A", resi: 12, atom: "CB" } },
          ],
        },
        atoms,
      ),
    /preset trp-lig: Expected one atom A12 CB, found 0/,
  );
  assert.throws(
    () =>
      verifyStructure(
        { ...e, subset: { ...e.subset, residues: { A: [10, 13] } } },
        atoms,
      ),
    /chain A does not span 10–13/,
  );
  assert.throws(
    () =>
      verifyStructure(
        {
          ...e,
          subset: {
            ...e.subset,
            hetero: [{ chain: "A", resn: "NAG", resi: 100 }],
          },
        },
        atoms,
      ),
    /hetero group NAG A100/,
  );
  assert.throws(
    () =>
      verifyStructure(
        {
          ...e,
          layers: [{ select: { elem: "Mg" }, style: "sphere", color: "green" }],
        },
        atoms,
      ),
    /layer 1 selects no atom/,
  );
  assert.throws(
    () => verifyStructure({ ...e, labels: { chain: "A", resi: [99] } }, atoms),
    /No residue A99/,
  );
  const hydrogen = parsePdb(
    lines([
      ...rows,
      record("ATOM", 9, "HA", "ALA", "A", 12, [4, 1, 0], 20, "H"),
    ]),
  );
  assert.throws(() => verifyStructure(e, hydrogen), /hydrogen/);
  const water = parsePdb(
    lines([
      ...rows,
      record("HETATM", 9, "O", "HOH", "A", 200, [9, 9, 9], 20, "O"),
    ]),
  );
  assert.throws(() => verifyStructure(e, water), /water/);
  const stray = parsePdb(
    lines([
      ...rows,
      record("ATOM", 9, "CA", "ALA", "B", 12, [9, 9, 9], 20, "C"),
    ]),
  );
  assert.throws(
    () => verifyStructure(e, stray),
    /chain the subset does not list/,
  );
});

test("selections, residue ranges and tags read the coordinates", () => {
  assert.ok(residueMatches(11, 11));
  assert.ok(residueMatches("10-12", 12));
  assert.ok(!residueMatches("10-12", 13));
  assert.ok(!residueMatches("x", 10));
  const [n, , , , , , , zn] = atoms;
  assert.ok(selectionMatches({ chain: "A", resi: ["10-11"] }, n));
  assert.ok(!selectionMatches({ chain: "A", resi: [12] }, n));
  assert.ok(selectionMatches({ elem: "Zn" }, zn));
  assert.ok(!selectionMatches({ elem: "Zn" }, n));
  assert.equal(residueTag(atoms, "A", 11), "W11");
  assert.equal(residueTag(atoms, "A", 100), "LIG100");
});

test("the showcase demo subset matches what it declares", () => {
  const demo = JSON.parse(
    readFileSync(new URL("../src/showcase/structures.json", import.meta.url)),
  );
  const defined = defineStructureSet({
    fetchedOn: demo.fetchedOn,
    entries: demo.entries.map((e) => ({ ...e, url: `/showcase/${e.id}.pdb` })),
  });
  for (const e of defined.entries) {
    const text = readFileSync(
      new URL(`../public/showcase/${e.id}.pdb`, import.meta.url),
      "utf8",
    );
    assert.match(text, new RegExp(`SUBSET OF RCSB PDB ${e.source.pdb}`));
    assert.match(text, /SOURCE FILE SHA-256 [0-9a-f]{64}/);
    assert.ok(text.includes(`FETCHED ${demo.fetchedOn}`));
    const demoAtoms = parsePdb(text);
    verifyStructure(e, demoAtoms);
    // L99A: alanine at 99, where the wild-type enzyme has leucine
    assert.equal(
      findAtom(demoAtoms, { chain: "A", resi: 99, atom: "CB" }).resn,
      "ALA",
    );
  }
});
