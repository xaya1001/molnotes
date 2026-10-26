// Pure helpers for committed PDB subsets: parse the coordinates and measure
// distances between named atoms. StructureLab and each topic's unit tests use
// the same functions, so every distance shown on a page is computed from the
// coordinate file.

export interface PdbAtom {
  chain: string;
  resi: number;
  resn: string;
  atom: string;
  /** Element symbol from the last columns of the record. */
  element: string;
  x: number;
  y: number;
  z: number;
  /** Crystallographic B-factor (Å²): how uncertain the atom's position is. */
  b: number;
}

/** Names one atom: chain, residue number and PDB atom name ("O", "ND2", "N2" for a ligand). */
export interface AtomRef {
  chain: string;
  resi: number;
  atom: string;
}

export function parsePdb(text: string): PdbAtom[] {
  const atoms: PdbAtom[] = [];
  for (const line of text.split("\n")) {
    const record = line.slice(0, 6);
    if (record !== "ATOM  " && record !== "HETATM") continue;
    const atom: PdbAtom = {
      atom: line.slice(12, 16).trim(),
      element: line.slice(76, 78).trim(),
      resn: line.slice(17, 20).trim(),
      chain: line[21],
      resi: Number(line.slice(22, 26)),
      x: Number(line.slice(30, 38)),
      y: Number(line.slice(38, 46)),
      z: Number(line.slice(46, 54)),
      b: Number(line.slice(60, 66)),
    };
    if (![atom.resi, atom.x, atom.y, atom.z, atom.b].every(Number.isFinite))
      throw new Error(`Unreadable PDB line: ${line}`);
    atoms.push(atom);
  }
  if (!atoms.length) throw new Error("No atoms in the PDB text");
  return atoms;
}

export function findAtom(atoms: readonly PdbAtom[], ref: AtomRef): PdbAtom {
  const found = atoms.filter(
    (a) => a.chain === ref.chain && a.resi === ref.resi && a.atom === ref.atom,
  );
  if (found.length !== 1)
    throw new Error(
      `Expected one atom ${ref.chain}${ref.resi} ${ref.atom}, found ${found.length}`,
    );
  return found[0];
}

export function distanceBetween(a: PdbAtom, b: PdbAtom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distance(
  atoms: readonly PdbAtom[],
  a: AtomRef,
  b: AtomRef,
): number {
  return distanceBetween(findAtom(atoms, a), findAtom(atoms, b));
}

/** The atom of `group` that lies closest to `from`, and how far away it is. */
export function nearestAtom(
  from: PdbAtom,
  group: readonly PdbAtom[],
): { atom: PdbAtom; distance: number } {
  let best: { atom: PdbAtom; distance: number } | undefined;
  for (const atom of group) {
    const d = distanceBetween(from, atom);
    if (!best || d < best.distance) best = { atom, distance: d };
  }
  if (!best) throw new Error("Empty atom group");
  return best;
}

/** Atoms of one residue (a ligand included) in one chain. */
export function residueAtoms(
  atoms: readonly PdbAtom[],
  chain: string,
  resi: number,
) {
  return atoms.filter((a) => a.chain === chain && a.resi === resi);
}

export function meanB(atoms: readonly PdbAtom[], refs: readonly AtomRef[]) {
  const values = refs.map((ref) => findAtom(atoms, ref).b);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
