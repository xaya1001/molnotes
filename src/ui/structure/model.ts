// Pure data layer of StructureLab: the entries a lab offers (one committed
// coordinate subset each), what is drawn in which style, and the distances to
// measure first. `defineStructureSet` rejects a malformed set when it loads;
// `verifyStructure` is for each topic's unit test and checks the declaration
// against the coordinate file itself. Nothing here imports the UI.

import { distance, findAtom, type AtomRef, type PdbAtom } from "./pdb.ts";

/** Names of the colours a layer can use; the component maps them to 3Dmol. */
export const structureColors = [
  "grey",
  "blue",
  "cyan",
  "green",
  "orange",
  "magenta",
  "yellow",
] as const;
export const structureStyles = [
  "cartoon",
  "stick",
  "sphere",
  "surface",
] as const;

/** How the legend names a colour. */
export const structureColorWords: Record<StructureColor, string> = {
  grey: "灰",
  blue: "蓝",
  cyan: "青",
  green: "绿",
  orange: "橙",
  magenta: "品红",
  yellow: "黄",
};

export type StructureColor = (typeof structureColors)[number];
export type StructureStyle = (typeof structureStyles)[number];

/** A residue number, or an inclusive range such as "536-547". */
export type ResidueSpec = number | string;

export interface StructureSelection {
  chain?: string;
  /** Needs `chain`: residue numbers are per chain. */
  resi?: readonly ResidueSpec[];
  /** Element symbol, e.g. "Zn". */
  elem?: string;
}

/** One drawing rule. Layers apply in order; a later layer adds to the earlier ones. */
export interface StructureLayer {
  /** Names the layer in the legend; a layer without a label is not listed. */
  label?: string;
  select: StructureSelection;
  /** One of `structureStyles`. */
  style: string;
  /** One of `structureColors`. */
  color: string;
  radius?: number;
  opacity?: number;
}

export interface StructureHetero {
  chain: string;
  resn: string;
  resi: number;
  /** What the group is, e.g. "CRBN 的结构锌"; the ligand is named by `ligand`. */
  name?: string;
}

export interface StructurePreset {
  id: string;
  label: string;
  a: AtomRef;
  b: AtomRef;
  /** The distance (Å) the page text quotes; a unit test checks it against the coordinates. */
  expect?: number;
}

/** Everything the lab needs for one coordinate file. Topics may add fields; they are kept. */
export interface StructureEntry {
  id: string;
  /** Tab label when the lab offers several entries. */
  label: string;
  /** Same-origin path of the committed coordinate file. */
  url: string;
  source: {
    /** Four-character PDB code. */
    pdb: string;
    title: string;
    resolution?: number;
    /** Defaults to "X 射线". */
    method?: string;
    /** Where the structure is discussed, e.g. a paper and the topic's source numbers. */
    note?: string;
  };
  /** What the committed file keeps of the PDB entry. */
  subset: {
    /** Polymer chains and their first and last residue number. */
    residues: Readonly<Partial<Record<string, readonly number[]>>>;
    hetero: readonly StructureHetero[];
  };
  /** The group the view opens on; it must be one of `subset.hetero`. */
  ligand?: { chain: string; resn: string; resi: number; name: string };
  /** What the view zooms to when it opens; the ligand, else everything, when absent. */
  focus?: StructureSelection;
  layers: readonly StructureLayer[];
  /** Residues labelled in the view, with a switch. */
  labels?: { chain: string; resi: readonly number[] };
  presets: readonly StructurePreset[];
}

export interface StructureSetInput<E extends StructureEntry = StructureEntry> {
  /** ISO date the coordinates were fetched from RCSB. */
  fetchedOn: string;
  entries: readonly E[];
}

export interface StructureSet<
  E extends StructureEntry = StructureEntry,
> extends StructureSetInput<E> {
  entryById(id: unknown): E;
}

/** The kept chains with their first and last residue number. */
export function keptRanges(subset: StructureEntry["subset"]) {
  return Object.entries(subset.residues).filter(
    (item): item is [string, readonly number[]] => item[1] !== undefined,
  );
}

const pdbCode = /^[1-9][A-Za-z0-9]{3}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const rangeSpec = /^(\d+)-(\d+)$/;

/** True when `resi` is the number or lies in the range `spec` names. */
export function residueMatches(spec: ResidueSpec, resi: number) {
  if (typeof spec === "number") return spec === resi;
  const range = rangeSpec.exec(spec);
  return range ? resi >= Number(range[1]) && resi <= Number(range[2]) : false;
}

export function selectionMatches(select: StructureSelection, atom: PdbAtom) {
  return (
    (select.chain === undefined || select.chain === atom.chain) &&
    (select.elem === undefined ||
      select.elem.toUpperCase() === atom.element.toUpperCase()) &&
    (select.resi === undefined ||
      select.resi.some((spec) => residueMatches(spec, atom.resi)))
  );
}

function inSubset(entry: StructureEntry, ref: AtomRef) {
  const range = entry.subset.residues[ref.chain];
  if (range && ref.resi >= range[0] && ref.resi <= range[1]) return true;
  return entry.subset.hetero.some(
    (h) => h.chain === ref.chain && h.resi === ref.resi,
  );
}

function checkAtomRef(entry: StructureEntry, where: string, ref: AtomRef) {
  if (
    typeof ref.chain !== "string" ||
    ref.chain.length !== 1 ||
    !Number.isInteger(ref.resi) ||
    typeof ref.atom !== "string" ||
    !ref.atom
  )
    throw new Error(`Structure ${entry.id} ${where}: malformed atom`);
  if (!inSubset(entry, ref))
    throw new Error(
      `Structure ${entry.id} ${where}: atom ${ref.chain}${ref.resi} ${ref.atom} is outside the coordinate subset`,
    );
}

function checkEntry(entry: StructureEntry) {
  const fail = (message: string) => {
    throw new Error(`Structure ${entry.id}: ${message}`);
  };
  if (!entry.id || !entry.label) fail("id and label are required");
  if (
    !entry.url.startsWith("/") ||
    entry.url.startsWith("//") ||
    entry.url.includes("://")
  )
    fail(`url ${entry.url} must be a path on this site`);
  if (!pdbCode.test(entry.source.pdb))
    fail(`${entry.source.pdb} is not a PDB code`);
  if (!entry.source.title) fail("source title is required");
  const { resolution } = entry.source;
  if (resolution !== undefined && !(resolution > 0))
    fail("resolution must be a positive number");

  const chains = new Set<string>();
  const ranges = keptRanges(entry.subset);
  if (!ranges.length) fail("subset keeps no chain");
  for (const [chain, range] of ranges) {
    const [from, to] = range;
    if (
      chain.length !== 1 ||
      range.length !== 2 ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from > to
    )
      fail(`subset residues of chain ${chain} must be [first, last]`);
    chains.add(chain);
  }
  for (const h of entry.subset.hetero) {
    if (h.chain.length !== 1 || !h.resn || !Number.isInteger(h.resi))
      fail(`malformed hetero group ${h.resn}`);
    chains.add(h.chain);
  }
  const { ligand } = entry;
  if (
    ligand &&
    !entry.subset.hetero.some(
      (h) =>
        h.chain === ligand.chain &&
        h.resn === ligand.resn &&
        h.resi === ligand.resi,
    )
  )
    fail(`ligand ${ligand.resn} is not in subset.hetero`);

  if (!entry.layers.length) fail("at least one layer is required");
  entry.layers.forEach((layer, index) => {
    const where = `layer ${index + 1}`;
    if (!structureStyles.includes(layer.style as StructureStyle))
      fail(`${where}: unknown style ${layer.style}`);
    if (!structureColors.includes(layer.color as StructureColor))
      fail(`${where}: unknown colour ${layer.color}`);
    const { chain, resi, elem } = layer.select;
    if (chain === undefined && resi === undefined && elem === undefined)
      fail(`${where}: select names nothing`);
    if (chain !== undefined && !chains.has(chain))
      fail(`${where}: chain ${chain} is not in the subset`);
    if (resi !== undefined && chain === undefined)
      fail(`${where}: resi needs a chain`);
    for (const spec of resi ?? []) {
      const range = typeof spec === "string" ? rangeSpec.exec(spec) : null;
      const valid =
        typeof spec === "number"
          ? Number.isInteger(spec)
          : range !== null && Number(range[1]) <= Number(range[2]);
      if (!valid) fail(`${where}: bad residue ${spec}`);
    }
  });
  if (entry.labels) {
    const { chain, resi } = entry.labels;
    if (!entry.subset.residues[chain] || !resi.length)
      fail("labels need a polymer chain of the subset and residues");
  }

  const ids = new Set<string>();
  for (const preset of entry.presets) {
    if (!preset.id || !preset.label) fail("preset id and label are required");
    if (ids.has(preset.id)) fail(`duplicate preset ${preset.id}`);
    ids.add(preset.id);
    const where = `preset ${preset.id}`;
    checkAtomRef(entry, `${where} atom a`, preset.a);
    checkAtomRef(entry, `${where} atom b`, preset.b);
    if (
      preset.a.chain === preset.b.chain &&
      preset.a.resi === preset.b.resi &&
      preset.a.atom === preset.b.atom
    )
      fail(`${where}: a and b are the same atom`);
    if (
      preset.expect !== undefined &&
      !(Number.isFinite(preset.expect) && preset.expect > 0)
    )
      fail(`${where}: expect must be a positive number`);
  }
}

/**
 * Validates the declaration of a structure lab and returns it with a lookup.
 * Fields a topic adds to an entry keep their types.
 */
export function defineStructureSet<E extends StructureEntry>(
  input: StructureSetInput<E>,
): StructureSet<E> {
  const date = new Date(`${input.fetchedOn}T00:00:00Z`);
  if (!isoDate.test(input.fetchedOn) || Number.isNaN(date.getTime()))
    throw new Error(
      `Structure set: fetchedOn ${input.fetchedOn} is not a date`,
    );
  if (!input.entries.length) throw new Error("Structure set has no entries");
  const ids = new Set<string>();
  for (const entry of input.entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate structure ${entry.id}`);
    ids.add(entry.id);
    checkEntry(entry);
  }
  const entryById = (id: unknown) => {
    const found = input.entries.find((entry) => entry.id === id);
    if (!found) throw new Error(`Unknown structure ${id}`);
    return found;
  };
  return { ...input, entryById };
}

export interface MeasuredPreset extends StructurePreset {
  value: number;
}

/** The distance of every preset, measured on the coordinates. */
export function presetDistances(
  entry: StructureEntry,
  atoms: readonly PdbAtom[],
): MeasuredPreset[] {
  return entry.presets.map((preset) => ({
    ...preset,
    value: distance(atoms, preset.a, preset.b),
  }));
}

const oneLetter: Record<string, string> = {
  ALA: "A",
  ARG: "R",
  ASN: "N",
  ASP: "D",
  CYS: "C",
  GLN: "Q",
  GLU: "E",
  GLY: "G",
  HIS: "H",
  ILE: "I",
  LEU: "L",
  LYS: "K",
  MET: "M",
  PHE: "F",
  PRO: "P",
  SER: "S",
  THR: "T",
  TRP: "W",
  TYR: "Y",
  VAL: "V",
};

/** "W380": the one-letter residue code and number, read from the coordinates. */
export function residueTag(
  atoms: readonly PdbAtom[],
  chain: string,
  resi: number,
) {
  const found = atoms.find((a) => a.chain === chain && a.resi === resi);
  if (!found) throw new Error(`No residue ${chain}${resi} in the coordinates`);
  return `${oneLetter[found.resn] ?? found.resn}${resi}`;
}

/**
 * Checks a coordinate file against the entry that declares it: the kept
 * chains and ranges, the hetero groups and the ligand, no hydrogens or water,
 * layers and labels that select something, presets whose two atoms exist once
 * each, and `expect` values that equal the measured distance to `tolerance` Å.
 * For a topic's unit test; the page itself only measures.
 */
export function verifyStructure(
  entry: StructureEntry,
  atoms: readonly PdbAtom[],
  tolerance = 0.005,
) {
  const fail = (message: string) => {
    throw new Error(`Structure ${entry.id}: ${message}`);
  };
  if (atoms.some((a) => a.element === "H" || a.element === "D"))
    fail("coordinates contain hydrogen atoms");
  if (atoms.some((a) => a.resn === "HOH")) fail("coordinates contain water");
  const isHetero = (a: PdbAtom) =>
    entry.subset.hetero.some((h) => h.chain === a.chain && h.resi === a.resi);
  for (const h of entry.subset.hetero) {
    const group = atoms.filter((a) => a.chain === h.chain && a.resi === h.resi);
    if (!group.length || group.some((a) => a.resn !== h.resn))
      fail(
        `hetero group ${h.resn} ${h.chain}${h.resi} is not in the coordinates`,
      );
  }
  for (const [chain, range] of keptRanges(entry.subset)) {
    const numbers = atoms
      .filter((a) => a.chain === chain && !isHetero(a))
      .map((a) => a.resi);
    if (!numbers.length) fail(`chain ${chain} has no atoms`);
    if (Math.min(...numbers) !== range[0] || Math.max(...numbers) !== range[1])
      fail(`chain ${chain} does not span ${range[0]}–${range[1]}`);
  }
  for (const a of atoms)
    if (!isHetero(a) && !entry.subset.residues[a.chain])
      fail(
        `atom ${a.chain}${a.resi} ${a.atom} is on a chain the subset does not list`,
      );
  entry.layers.forEach((layer, index) => {
    if (!atoms.some((a) => selectionMatches(layer.select, a)))
      fail(`layer ${index + 1} selects no atom`);
  });
  for (const resi of entry.labels?.resi ?? [])
    residueTag(atoms, entry.labels!.chain, resi);
  for (const preset of entry.presets) {
    let value: number;
    try {
      findAtom(atoms, preset.a);
      findAtom(atoms, preset.b);
      value = distance(atoms, preset.a, preset.b);
    } catch (reason) {
      return fail(
        `preset ${preset.id}: ${reason instanceof Error ? reason.message : reason}`,
      );
    }
    if (
      preset.expect !== undefined &&
      Math.abs(value - preset.expect) > tolerance
    )
      fail(
        `preset ${preset.id}: expects ${preset.expect} Å, the coordinates give ${value.toFixed(3)} Å`,
      );
  }
}
