import type {
  ChemicalToolkit,
  ChemicalMolecule as MoleculeHandle,
} from "./chemical-toolkit.ts";
import { isObject } from "./json.ts";
import type { Point } from "./chemical-library/types.ts";

type ChemistryToolkit = Pick<ChemicalToolkit, "get_qmol">;

// Concrete fragments for substituent substitution and display.
export const abbreviationFragments = {
  Boc: "*C(=O)OC(C)(C)C",
  Cbz: "*C(=O)OCc1ccccc1",
  Fmoc: "*C(=O)OCC1c2ccccc2-c2ccccc21",
  Ts: "*S(=O)(=O)c1ccc(C)cc1",
  Ms: "*S(=O)(=O)C",
  Tf: "*S(=O)(=O)C(F)(F)F",
  OTMS: "*O[Si](C)(C)C",
  CCl3: "*C(Cl)(Cl)Cl",
  PPh3: "*P(c1ccccc1)(c1ccccc1)c1ccccc1",
  TMS: "*[Si](C)(C)C",
  TBS: "*[Si](C)(C)C(C)(C)C",
  TIPS: "*[Si](C(C)C)(C(C)C)C(C)C",
  Bn: "*Cc1ccccc1",
  PMB: "*Cc1ccc(OC)cc1",
  Ac: "*C(=O)C",
  Bz: "*C(=O)c1ccccc1",
  Piv: "*C(=O)C(C)(C)C",
  Ph: "*c1ccccc1",
  "CO₂Me": "*C(=O)OC",
  CO2Et: "*C(=O)OCC",
  "CO₂tBu": "*C(=O)OC(C)(C)C",
  OMe: "*OC",
  OEt: "*OCC",
  CF3: "*C(F)(F)F",
  OTBS: "*O[Si](C)(C)C(C)(C)C",
  OTBDPS: "*O[Si](c1ccccc1)(c1ccccc1)C(C)(C)C",
  OTES: "*O[Si](CC)(CC)CC",
  OTIPS: "*O[Si](C(C)C)(C(C)C)C(C)C",
  OPMB: "*OCc1ccc(OC)cc1",
  OBn: "*OCc1ccccc1",
  OPiv: "*OC(=O)C(C)(C)C",
  OAc: "*OC(C)=O",
  OBz: "*OC(=O)c1ccccc1",
  OMOM: "*OCOC",
  OTs: "*OS(=O)(=O)c1ccc(C)cc1",
  OMs: "*OS(C)(=O)=O",
  OTf: "*OS(=O)(=O)C(F)(F)F",
  NHBoc: "*NC(=O)OC(C)(C)C",
  CN: "*C#N",
  SCH2Ph: "*SCc1ccccc1",
  CO2H: "*C(=O)O",
  NO2: "*[N+](=O)[O-]",
  Tr: "*C(c1ccccc1)(c1ccccc1)c1ccccc1",
  N3: "*N=[N+]=[N-]",
  CHO: "*C=O",
  COCl: "*C(=O)Cl",
  CONH2: "*C(=O)N",
  NHAc: "*NC(=O)C",
  NMe: "*NC",
  NMe2: "*N(C)C",
  NEt2: "*N(CC)CC",
  SO2Me: "*S(=O)(=O)C",
  SO2Ph: "*S(=O)(=O)c1ccccc1",
  SO3H: "*S(=O)(=O)O",
  SMe: "*SC",
  OPh: "*Oc1ccccc1",
  iPr: "*C(C)C",
  tBu: "*C(C)(C)C",
  nBu: "*CCCC",
  Et: "*CC",
  Alloc: "*C(=O)OCC=C",
  Troc: "*C(=O)OCC(Cl)(Cl)Cl",
  Teoc: "*C(=O)OCC[Si](C)(C)C",
  SEM: "*COCC[Si](C)(C)C",
  THP: "*C1CCCCO1",
  Ns: "*S(=O)(=O)c1ccccc1[N+](=O)[O-]",
  Mes: "*c1c(C)cc(C)cc1C",
  TES: "*[Si](CC)(CC)CC",
  TBDPS: "*[Si](c1ccccc1)(c1ccccc1)C(C)(C)C",
  OTHP: "*OC1CCCCO1",
  OSEM: "*OCOCC[Si](C)(C)C",
  CO2Bn: "*C(=O)OCc1ccccc1",
  CO2iPr: "*C(=O)OC(C)C",
  Bpin: "*B1OC(C)(C)C(C)(C)O1",
  SnBu3: "*[Sn](CCCC)(CCCC)CCCC",
  "PO(OEt)2": "*P(=O)(OCC)OCC",
  MOM: "*COC",
  OCF3: "*OC(F)(F)F",
  OCHF2: "*OC(F)F",
  Cy: "*C1CCCCC1",
  nDec: "*CCCCCCCCCC",
  nNon: "*CCCCCCCCC",
  nOct: "*CCCCCCCC",
  nHept: "*CCCCCCC",
  nHex: "*CCCCCC",
  nPent: "*CCCCC",
  iBu: "*CC(C)C",
  sBu: "*C(C)CC",
  nPr: "*CCC",
  "N(OH)CH3": "*N(O)C",
  "CO2-": "*C(=O)[O-]",
  NHFmoc: "*NC(=O)OCC1c2ccccc2-c2ccccc21",
  NHTs: "*NS(=O)(=O)c1ccc(C)cc1",
  SPh: "*Sc1ccccc1",
  CHF2: "*C(F)F",
  CH2F: "*CF",
  CH2Cl: "*CCl",
  C2F5: "*C(F)(F)C(F)(F)F",
  OBoc: "*OC(=O)OC(C)(C)C",
  CO2Ph: "*C(=O)Oc1ccccc1",
  CH2OH: "*CO",
  CH2OBn: "*COCc1ccccc1",
  SO2NH2: "*S(=O)(=O)N",
  NH2: "*[NH2]",
  PMP: "*c1ccc(OC)cc1",
  pTol: "*c1ccc(C)cc1",
} as const;
export type AbbreviationName = keyof typeof abbreviationFragments;
export type MoleculeAbbreviation =
  AbbreviationName | { name: AbbreviationName; atom: number };

export const defaultFigureAbbreviations = [
  "OTBS",
  "OTBDPS",
  "OTES",
  "OTIPS",
  "OPMB",
  "OBn",
  "OPiv",
  "OAc",
  "OBz",
  "OMOM",
  "OTs",
  "OMs",
  "OTf",
  "NHBoc",
  "TMS",
  "TBS",
  "Boc",
  "Ts",
  "CO₂Me",
  "CO2Et",
  "CO₂tBu",
  "CN",
  "SCH2Ph",
  "CO2H",
  "Ac",
  "NO2",
  "Troc",
  "Teoc",
  "OSEM",
] as const satisfies readonly AbbreviationName[];

export const optionalFigureAbbreviations = [
  "Ph",
  "Tr",
  "Bz",
] as const satisfies readonly AbbreviationName[];

// SMARTS and attachment-facing labels from RDKit GetDefaultAbbreviations().
const rdkitAbbreviations: Partial<
  Record<AbbreviationName, readonly [string, string, string]>
> = {
  CO2Et: [
    "[!#0][C&D3&R0](=[O&D1&R0])[O&D2&R0][C&D2&R0][C&D1&R0]",
    "CO<sub>2</sub>Et",
    "EtO<sub>2</sub>C",
  ],
  tBu: ["[!#0][C&D4&R0]([C&D1&R0])([C&D1&R0])[C&D1&R0]", "tBu", "tBu"],
  nBu: ["[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]", "nBu", "nBu"],
  iPr: ["[!#0][C&D3&R0]([C&D1&R0])[C&D1&R0]", "iPr", "iPr"],
  Et: ["[!#0][C&D2&R0][C&D1&R0]", "Et", "Et"],
  CF3: [
    "[!#0][C&D4&R0]([F&D1&R0])([F&D1&R0])[F&D1&R0]",
    "CF<sub>3</sub>",
    "F<sub>3</sub>C",
  ],
  CCl3: [
    "[!#0][C&D4&R0]([Cl&D1&R0])([Cl&D1&R0])[Cl&D1&R0]",
    "CCl<sub>3</sub>",
    "Cl<sub>3</sub>C",
  ],
  CN: ["[!#0][C&D2&R0]#[N&D1&R0]", "CN", "NC"],
  NO2: [
    "[!#0][N&+&D3&R0](=[O&D1&R0])[O&-&D1&R0]",
    "NO<sub>2</sub>",
    "O<sub>2</sub>N",
  ],
  SO3H: [
    "[!#0][S&D4&R0](=[O&D1&R0])(=[O&D1&R0])[O&H1&D1&R0]",
    "SO<sub>3</sub>H",
    "HO<sub>3</sub>S",
  ],
  CO2H: [
    "[!#0][C&D3&R0](=[O&D1&R0])[O&H1&D1&R0]",
    "CO<sub>2</sub>H",
    "HO<sub>2</sub>C",
  ],
  OEt: ["[!#0][O&D2&R0][C&D2&R0][C&D1&R0]", "OEt", "EtO"],
  OAc: ["[!#0][O&D2&R0][C&D3&R0](=[O&D1&R0])[C&D1&R0]", "OAc", "AcO"],
  NHAc: ["[!#0][N&D2&R0][C&D3&R0](=[O&D1&R0])[C&D1&R0]", "NHAc", "AcNH"],
  Ac: ["[!#0][C&D3&R0](=[O&D1&R0])[C&D1&R0]", "Ac", "Ac"],
  CHO: ["[!#0][C&D2&R0]=[O&D1&R0]", "CHO", "OHC"],
  NMe: ["[!#0][N&D2&R0][C&D1&R0]", "NMe", "MeN"],
  SMe: ["[!#0][S&D2&R0][C&D1&R0]", "SMe", "MeS"],
  OMe: ["[!#0][O&D2&R0][C&D1&R0]", "OMe", "MeO"],
  nDec: [
    "[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]",
    "nDec",
    "nDec",
  ],
  nNon: [
    "[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]",
    "nNon",
    "nNon",
  ],
  nOct: [
    "[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]",
    "nOct",
    "nOct",
  ],
  nHept: [
    "[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]",
    "nHept",
    "nHept",
  ],
  nHex: [
    "[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]",
    "nHex",
    "nHex",
  ],
  nPent: [
    "[!#0][C&D2&R0][C&D2&R0][C&D2&R0][C&D2&R0][C&D1&R0]",
    "nPent",
    "nPent",
  ],
  nPr: ["[!#0][C&D2&R0][C&D2&R0][C&D1&R0]", "nPr", "nPr"],
  "N(OH)CH3": [
    "[!#0][N&D3&R0]([O&H1&D1&R0])[C&D1&R0]",
    "N(OH)CH<sub>3</sub>",
    "CH<sub>3</sub>(OH)N",
  ],
  "CO2-": [
    "[!#0][C&D3&R0](=[O&D1&R0])[O&-&D1&R0]",
    "COO<sup>-</sup>",
    "<sup>-</sup>OOC",
  ],
};

const customQueries: Partial<Record<AbbreviationName, string>> = {
  N3: "*[$([N]=[N+]=[N-]),$([N-][N+]#N)]~[N+]~[N-,N]",
  PPh3: "*~[P,P+](c1ccccc1)(c1ccccc1)c1ccccc1",
};

export function validateAbbreviations(
  value: unknown,
  where: string,
): asserts value is MoleculeAbbreviation[] | undefined {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.some((selection) => {
      if (typeof selection === "string")
        return !Object.hasOwn(abbreviationFragments, selection);
      return (
        !isObject(selection) ||
        typeof selection.name !== "string" ||
        !Object.hasOwn(abbreviationFragments, selection.name) ||
        typeof selection.atom !== "number" ||
        !Number.isInteger(selection.atom) ||
        selection.atom < 0
      );
    })
  )
    throw new Error(
      `${where}: abbreviations must list shared whitelist names or {name, atom} selections`,
    );
}

export interface AbbreviatedGroup {
  name: AbbreviationName;
  attachment: number;
  bond: number;
  /** All original atom indices, including the atom replaced by the label. */
  atoms: number[];
  /** Original bond indices internal to the group. */
  bonds: number[];
}

/** Resolve once against the original graph; drawing and publication use the same matches. */
function findGroups(
  toolkit: ChemistryToolkit,
  mol: MoleculeHandle,
  selections: readonly MoleculeAbbreviation[] = [],
  where = "molecule",
  automatic = false,
): AbbreviatedGroup[] {
  validateAbbreviations(selections, where);
  if (!selections.length) return [];
  const graph: { molecules: { bonds: { atoms: [number, number] }[] }[] } =
    JSON.parse(mol.get_json());
  const edges = graph.molecules[0].bonds;
  const candidates: AbbreviatedGroup[] = [];
  for (const name of new Set(
    selections.map((selection) =>
      typeof selection === "string" ? selection : selection.name,
    ),
  )) {
    const all = selections.includes(name);
    const roots = new Set(
      selections.flatMap((selection) =>
        typeof selection !== "string" && selection.name === name
          ? [selection.atom]
          : [],
      ),
    );
    // Match the historical acetyl orientation when selecting figure defaults.
    // Explicit selections use RDKit's terminal-methyl constraint.
    const query = toolkit.get_qmol(
      automatic && name === "Ac"
        ? abbreviationFragments.Ac
        : (rdkitAbbreviations[name]?.[0] ??
            customQueries[name] ??
            abbreviationFragments[name]),
    );
    if (!query) throw new Error(`Invalid abbreviation query: ${name}`);
    try {
      const matches: { atoms: number[] }[] = JSON.parse(
        mol.get_substruct_matches(query, all ? "{}" : '{"uniquify":false}'),
      );
      for (const match of Array.isArray(matches) ? matches : []) {
        const atoms = match.atoms.slice(1);
        if (!all && !roots.has(atoms[0])) continue;
        const set = new Set(atoms);
        const internal: number[] = [],
          external: number[] = [];
        edges.forEach(({ atoms: [a, b] }, i) => {
          if (set.has(a) && set.has(b)) internal.push(i);
          else if (set.has(a) !== set.has(b)) external.push(i);
        });
        if (external.length !== 1) continue;
        const bond = edges[external[0]].atoms;
        if (!bond.includes(match.atoms[0]) || !bond.includes(atoms[0]))
          continue;
        candidates.push({
          name,
          attachment: match.atoms[0],
          bond: external[0],
          atoms,
          bonds: internal,
        });
      }
    } finally {
      query.delete();
    }
  }
  // A declared larger group owns its atoms before any nested substituent.
  candidates.sort((a, b) => b.atoms.length - a.atoms.length);
  const folded = new Set<number>(),
    groups: AbbreviatedGroup[] = [];
  for (const group of candidates) {
    if (group.atoms.some((i) => folded.has(i))) continue;
    group.atoms.forEach((i) => folded.add(i));
    groups.push(group);
  }
  return groups;
}

export function matchingAbbreviations(
  toolkit: ChemistryToolkit,
  mol: MoleculeHandle,
  names: readonly AbbreviationName[],
  automatic = false,
) {
  return findGroups(toolkit, mol, names, "molecule", automatic);
}

export function abbreviatedGroups(
  toolkit: ChemistryToolkit,
  mol: MoleculeHandle,
  selections: readonly MoleculeAbbreviation[] = [],
  where = "molecule",
) {
  const groups = findGroups(toolkit, mol, selections, where);
  for (const selection of selections) {
    const { name, atom } =
      typeof selection === "string"
        ? { name: selection, atom: undefined }
        : selection;
    if (
      !groups.some(
        (group) =>
          group.name === name &&
          (atom === undefined || group.atoms[0] === atom),
      )
    )
      throw new Error(
        `${where}: abbreviation ${name}${atom === undefined ? "" : ` at atom ${atom}`} has no non-overlapping terminal group in SMILES`,
      );
  }
  return groups;
}

/** RDKit anchors the first glyph for steep terminal bonds, even when they point left. */
export function abbreviationFacesLeft(root: Point, attachment: Point) {
  const dx = attachment.x - root.x;
  return (
    dx > 0 &&
    Math.abs(attachment.y - root.y) <= dx * Math.tan((70 * Math.PI) / 180)
  );
}

/** The renderer selects the attachment-facing spelling after applying placement transforms. */
export function abbreviationLabel(
  name: AbbreviationName,
  left: boolean,
  attachmentIsCarbon: boolean,
) {
  if (name === "Boc" && attachmentIsCarbon) name = "CO₂tBu";
  const standard = rdkitAbbreviations[name];
  if (standard) return standard[left ? 2 : 1];
  const labels: Partial<Record<AbbreviationName, [string, string]>> = {
    OTBS: ["OTBS", "TBSO"],
    OTBDPS: ["OTBDPS", "TBDPSO"],
    OTES: ["OTES", "TESO"],
    OTIPS: ["OTIPS", "TIPSO"],
    OPMB: ["OPMB", "PMBO"],
    OBn: ["OBn", "BnO"],
    OPiv: ["OPiv", "PivO"],
    OBz: ["OBz", "BzO"],
    OMOM: ["OMOM", "MOMO"],
    OTs: ["OTs", "TsO"],
    OMs: ["OMs", "MsO"],
    OTf: ["OTf", "TfO"],
    NHBoc: ["NHBoc", "BocHN"],
    "CO₂Me": ["CO<sub>2</sub>Me", "MeO<sub>2</sub>C"],
    "CO₂tBu": ["CO<sub>2</sub>t-Bu", "t-BuO<sub>2</sub>C"],
    SCH2Ph: ["SCH<sub>2</sub>Ph", "PhCH<sub>2</sub>S"],
    PPh3: ["PPh<sub>3</sub>", "Ph<sub>3</sub>P"],
    N3: ["N<sub>3</sub>", "N<sub>3</sub>"],
    COCl: ["COCl", "ClOC"],
    CONH2: ["CONH<sub>2</sub>", "H<sub>2</sub>NOC"],
    NMe2: ["NMe<sub>2</sub>", "Me<sub>2</sub>N"],
    NEt2: ["NEt<sub>2</sub>", "Et<sub>2</sub>N"],
    SO2Me: ["SO<sub>2</sub>Me", "MeO<sub>2</sub>S"],
    SO2Ph: ["SO<sub>2</sub>Ph", "PhO<sub>2</sub>S"],
    OPh: ["OPh", "PhO"],
    OTHP: ["OTHP", "THPO"],
    OSEM: ["OSEM", "SEMO"],
    CO2Bn: ["CO<sub>2</sub>Bn", "BnO<sub>2</sub>C"],
    CO2iPr: ["CO<sub>2</sub>iPr", "iPrO<sub>2</sub>C"],
    Bpin: ["B(pin)", "(pin)B"],
    SnBu3: ["SnBu<sub>3</sub>", "Bu<sub>3</sub>Sn"],
    "PO(OEt)2": ["PO(OEt)<sub>2</sub>", "(EtO)<sub>2</sub>OP"],
    OCF3: ["OCF<sub>3</sub>", "F<sub>3</sub>CO"],
    OCHF2: ["OCHF<sub>2</sub>", "F<sub>2</sub>HCO"],
    NHFmoc: ["NHFmoc", "FmocHN"],
    NHTs: ["NHTs", "TsHN"],
    SPh: ["SPh", "PhS"],
    CHF2: ["CHF<sub>2</sub>", "F<sub>2</sub>HC"],
    CH2F: ["CH<sub>2</sub>F", "FH<sub>2</sub>C"],
    CH2Cl: ["CH<sub>2</sub>Cl", "ClH<sub>2</sub>C"],
    C2F5: ["C<sub>2</sub>F<sub>5</sub>", "F<sub>5</sub>C<sub>2</sub>"],
    OBoc: ["OBoc", "BocO"],
    CO2Ph: ["CO<sub>2</sub>Ph", "PhO<sub>2</sub>C"],
    CH2OH: ["CH<sub>2</sub>OH", "HOH<sub>2</sub>C"],
    CH2OBn: ["CH<sub>2</sub>OBn", "BnOH<sub>2</sub>C"],
    SO2NH2: ["SO<sub>2</sub>NH<sub>2</sub>", "H<sub>2</sub>NO<sub>2</sub>S"],
    NH2: ["NH<sub>2</sub>", "H<sub>2</sub>N"],
  };
  return labels[name]?.[left ? 1 : 0] ?? name;
}

/** Reject references to collapsed atoms, and to bonds with a collapsed endpoint. */
export function validateAbbreviatedReferences(
  mol: MoleculeHandle,
  groups: readonly AbbreviatedGroup[],
  context: Record<string, unknown>,
  where: string,
) {
  if (!groups.length) return;
  const folded = new Set(groups.flatMap((group) => group.atoms));
  const graph: { molecules: { bonds: { atoms: number[] }[] }[] } = JSON.parse(
    mol.get_json(),
  );
  const bonds = graph.molecules[0].bonds;
  const check = (value: unknown, kind: "atoms" | "bonds", path: string) => {
    if (!Array.isArray(value)) return;
    for (const index of value)
      if (
        typeof index === "number" &&
        (kind === "atoms"
          ? folded.has(index)
          : bonds[index]?.atoms.some((i) => folded.has(i)))
      )
        throw new Error(
          `${where}.${path}: ${kind} index ${index} references an abbreviated atom`,
        );
  };
  check(context.highlightAtoms, "atoms", "highlightAtoms");
  check(context.highlightBonds, "bonds", "highlightBonds");
  check(context.anchorAtoms, "atoms", "anchorAtoms");
  check(context.selectable, "atoms", "selectable");
  if (context.labels && typeof context.labels === "object")
    check(Object.keys(context.labels).map(Number), "atoms", "labels");
  if (["atoms", "bonds", "atom-set"].includes(String(context.kind)))
    check(
      context.answer,
      context.kind === "bonds" ? "bonds" : "atoms",
      "answer",
    );
  if (Array.isArray(context.groups))
    context.groups.forEach((group, i) => check(group, "atoms", `groups[${i}]`));
  if (
    context.kind === "arrows" &&
    context.answer &&
    typeof context.answer === "object"
  )
    check(Object.values(context.answer), "atoms", "answer");
  if (Array.isArray(context.arrows))
    context.arrows.forEach((arrow, i) => {
      for (const side of ["from", "to"])
        if (arrow?.[side]) {
          check([arrow[side].atom], "atoms", `arrows[${i}].${side}`);
          check([arrow[side].bond], "bonds", `arrows[${i}].${side}`);
        }
    });
}

/** Complete small reagents, written with the arrow-bearing atom in the label. */
export const reagentAbbreviations = [
  { smiles: "C[O-]", label: "MeO", atom: 8 },
  { smiles: "CC[O-]", label: "EtO", atom: 8 },
  { smiles: "CC(C)(C)[O-]", label: "t-BuO", atom: 8 },
  { smiles: "[OH-]", label: "HO", atom: 8 },
  { smiles: "CO", label: "MeOH", atom: 8 },
  { smiles: "CCO", label: "EtOH", atom: 8 },
  { smiles: "O", label: "H<sub>2</sub>O", atom: 8 },
  { smiles: "[OH3+]", label: "H<sub>3</sub>O", atom: 8 },
  { smiles: "N", label: "NH<sub>3</sub>", atom: 7 },
  { smiles: "[C-]#N", label: "CN", atom: 6, secondGlyph: 7 },
  { smiles: "[N-]=[N+]=[N-]", label: "N<sub>3</sub>", atom: 7 },
  { smiles: "C[S-]", label: "MeS", atom: 16 },
  { smiles: "CC(=O)[O-]", label: "AcO", atom: 8 },
  { smiles: "CC(=O)O", label: "AcOH", atom: 8 },
  { smiles: "CCN(CC)CC", label: "Et<sub>3</sub>N", atom: 7 },
] as const;
