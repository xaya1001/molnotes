import type { Mol } from "@rdkit/rdkit";
import { figureCommonCore } from "./figure-depiction.ts";
import {
  graphOf,
  openMolecule,
  type ChemicalGraph,
  type Toolkit,
} from "../shared/chemical-library/chemistry.ts";
import type {
  AtomRef,
  Compound,
  Library,
  Participant,
  Reaction,
} from "../shared/chemical-library/types.ts";

type Graph = ChemicalGraph & {
  bonds: {
    atoms: [number, number];
    bo?: number;
    stereo?: string;
    stereoAtoms?: number[];
  }[];
  extensions?: { name: string; aromaticBonds?: number[] }[];
};
type Substance = {
  participant: Participant;
  compound: Compound;
  mol: Mol;
  graph: Graph;
  numbers?: Record<string, number>;
};
type Difference = {
  atoms: Set<number>;
  bonds: Set<number>;
  lines: string[];
  uncertain: string[];
  tooMany: boolean;
};
const symbols =
  "* H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(
    " ",
  );
const name = (g: Graph, i: number) => {
  const a = g.atoms[i],
    h = a.impHs ?? 0;
  return `${symbols[a.z ?? 6]}${h ? `H${h > 1 ? h : ""}` : ""}`;
};
const neighbours = (g: Graph, i: number) =>
  g.bonds.flatMap((b) =>
    b.atoms.includes(i) ? [b.atoms[0] === i ? b.atoms[1] : b.atoms[0]] : [],
  );
const bondAt = (g: Graph, i: number, j: number) =>
  g.bonds.find((b) => b.atoms.includes(i) && b.atoms.includes(j));
const ligandOrder = (g: Graph, i: number) => [
  ...neighbours(g, i),
  ...((g.atoms[i].impHs ?? 0) === 1 ? [-1] : []),
];
const parity = (a: number[], b: number[]) =>
  a.reduce(
    (n, v, i) =>
      n + a.slice(i + 1).filter((w) => b.indexOf(v) > b.indexOf(w)).length,
    0,
  ) % 2;
function correspondence(
  a: number[],
  b: number[],
  mapping: Map<number, number>,
) {
  const converted = b.map((i) => (i === -1 ? -1 : mapping.get(i)));
  const missing = converted.flatMap((v, i) =>
    v === undefined || !a.includes(v) ? [i] : [],
  );
  const remaining = a.filter((v) => !converted.includes(v));
  if (missing.length === 1 && remaining.length === 1)
    converted[missing[0]] = remaining[0];
  if (
    a.length !== b.length ||
    converted.some((v) => v === undefined) ||
    new Set(converted).size !== a.length ||
    converted.some((v) => !a.includes(v!))
  )
    return;
  return converted as number[];
}
function matches(mol: Mol, query: Mol) {
  return (
    JSON.parse(
      mol.get_substruct_matches(
        query,
        JSON.stringify({ uniquify: false, maxMatches: 64 }),
      ),
    ) as { atoms: number[] }[]
  ).map((v) => v.atoms);
}
const signature = (d: Difference) =>
  JSON.stringify([
    [...d.atoms].sort((a, b) => a - b),
    [...d.bonds].sort((a, b) => a - b),
    d.uncertain.toSorted(),
  ]);
function describe(s: Substance, i: number) {
  const ns = neighbours(s.graph, i);
  const carbonyl =
    (s.graph.atoms[i].z ?? 6) === 6 &&
    ns.some(
      (n) =>
        (s.graph.atoms[n].z ?? 6) === 8 &&
        (bondAt(s.graph, i, n)?.bo ?? 1) === 2,
    );
  return `${carbonyl ? "羰基 C" : name(s.graph, i)}（${s.numbers?.[s.compound.atomIds[i]] === undefined ? "" : `源号${s.numbers[s.compound.atomIds[i]]}，`}${s.compound.atomIds[i]}，邻接 ${ns.map((n) => name(s.graph, n)).join("/") || "无"}）`;
}
function compare(
  a: Substance,
  b: Substance,
  toA: Map<number, number>,
  brought: Set<number>,
  broughtBonds: Set<number>,
): Difference {
  const A = a.graph,
    B = b.graph,
    toB = new Map([...toA].map(([p, r]) => [r, p]));
  const fresh = new Set(
    B.atoms.flatMap((_, i) => (!toA.has(i) && !brought.has(i) ? [i] : [])),
  );
  const atoms = new Set(fresh),
    bonds = new Set<number>(),
    lines: string[] = [],
    uncertain: string[] = [];
  const aromatic = (g: Graph, i: number) =>
    g.extensions?.some(
      (e) => e.name === "rdkitRepresentation" && e.aromaticBonds?.includes(i),
    );
  for (const [i, edge] of B.bonds.entries()) {
    const [x, y] = edge.atoms,
      rx = toA.get(x),
      ry = toA.get(y);
    if (broughtBonds.has(i)) continue;
    const old =
      rx === undefined || ry === undefined ? undefined : bondAt(A, rx, ry);
    if (
      !old ||
      ((old.bo ?? 1) !== (edge.bo ?? 1) &&
        !(aromatic(A, A.bonds.indexOf(old)) && aromatic(B, i)))
    ) {
      bonds.add(i);
      lines.push(
        `${describe(b, x)}—${describe(b, y)}：${old ? `键级 ${old.bo ?? 1} → ${edge.bo ?? 1}` : "新键"}`,
      );
    }
  }
  for (const edge of A.bonds) {
    const [x, y] = edge.atoms,
      px = toB.get(x),
      py = toB.get(y);
    if (px !== undefined && py !== undefined && !bondAt(B, px, py)) {
      atoms.add(px);
      atoms.add(py);
      lines.push(`${describe(b, px)}—${describe(b, py)}：断键`);
    }
    if ((px === undefined) !== (py === undefined)) {
      const p = px ?? py!;
      atoms.add(p);
      lines.push(
        `${describe(b, p)}：失去相连的 ${name(A, px === undefined ? x : y)}`,
      );
    }
  }
  for (const i of fresh) lines.push(`${describe(b, i)}：新增原子`);
  for (const [p, r] of toA) {
    const x = A.atoms[r],
      y = B.atoms[p];
    for (const [field, label] of [
      ["chg", "电荷"],
      ["impHs", "H 数"],
      ["isotope", "同位素"],
    ] as const)
      if ((x[field] ?? 0) !== (y[field] ?? 0)) {
        atoms.add(p);
        lines.push(
          `${describe(b, p)}：${label} ${x[field] ?? 0} → ${y[field] ?? 0}`,
        );
      }
    const ta = x.stereo ?? "unspecified",
      tb = y.stereo ?? "unspecified";
    if (ta === "unspecified" && tb !== "unspecified") {
      atoms.add(p);
      lines.push(`${describe(b, p)}：新增立体中心`);
    } else if (ta !== "unspecified" && tb === "unspecified") {
      atoms.add(p);
      if (B.bonds.some((edge) => edge.atoms.includes(p) && (edge.bo ?? 1) > 1))
        lines.push(`${describe(b, p)}：立体中心消失`);
      else uncertain.push(`${describe(b, p)}：产物未指定立体，未比较`);
    } else if (ta !== "unspecified" && tb !== "unspecified") {
      const order = ligandOrder(A, r),
        converted = correspondence(order, ligandOrder(B, p), toA);
      if (!converted)
        uncertain.push(`${describe(b, p)}：替换配体无法唯一对应，立体未比较`);
      else if ((ta === tb) !== (parity(converted, order) === 0)) {
        atoms.add(p);
        lines.push(`${describe(b, p)}：立体翻转`);
      } else lines.push(`${describe(b, p)}：立体保留`);
    }
  }
  for (const [index, edge] of B.bonds.entries()) {
    if ((edge.bo ?? 1) !== 2) continue;
    const [p, q] = edge.atoms,
      r = toA.get(p),
      s = toA.get(q);
    if (r === undefined || s === undefined) continue;
    const old = bondAt(A, r, s);
    if (!old || (old.bo ?? 1) !== 2) continue;
    const specified = (v: string | undefined) => v === "cis" || v === "trans";
    if (!specified(old.stereo) && !specified(edge.stereo)) continue;
    if (!specified(old.stereo) || !specified(edge.stereo)) {
      bonds.add(index);
      lines.push(
        `${describe(b, p)}—${describe(b, q)}：双键立体${specified(edge.stereo) ? "新增" : "未指定，未比较"}`,
      );
      continue;
    }
    let flips = 0,
      valid = true;
    for (const [end, oldEnd] of [
      [p, r],
      [q, s],
    ]) {
      const other = end === p ? q : p,
        oldOther = oldEnd === r ? s : r;
      const order = ligandOrder(A, oldEnd).filter((i) => i !== oldOther);
      const current = ligandOrder(B, end).filter((i) => i !== other);
      const converted = correspondence(order, current, toA);
      const chosen = edge.stereoAtoms?.[edge.atoms.indexOf(end)];
      const prior = old.stereoAtoms?.[old.atoms.indexOf(oldEnd)];
      if (!converted || chosen === undefined || prior === undefined) {
        valid = false;
        break;
      }
      if (converted[current.indexOf(chosen)] !== prior) flips++;
    }
    if (!valid)
      uncertain.push(
        `${describe(b, p)}—${describe(b, q)}：双键配体无法对应，未比较`,
      );
    else if ((old.stereo === edge.stereo) !== (flips % 2 === 0)) {
      bonds.add(index);
      lines.push(`${describe(b, p)}—${describe(b, q)}：双键立体翻转`);
    }
  }
  return {
    atoms,
    bonds,
    lines,
    uncertain,
    tooMany:
      fresh.size +
        [...bonds].filter((i) => B.bonds[i].atoms.every((a) => !fresh.has(a)))
          .length >
      0.4 * B.atoms.length,
  };
}

/** Save product-only drawing marks; the human review stays in compile output. */
export function reactionChanges(
  rd: Toolkit,
  library: Library,
  reaction: Reaction,
  options: {
    enabled?: boolean;
    numbers?: Record<string, Record<string, number>>;
    add?: AtomRef[];
    remove?: AtomRef[];
  } = {},
) {
  const lines: string[] = [],
    atoms: AtomRef[] = [],
    bonds: [AtomRef, AtomRef][] = [];
  if (options.enabled === false) {
    delete reaction.scene.changes;
    return [`${reaction.title}：变化标红关闭`];
  }
  const loaded: Substance[] = [];
  const load = (participant: Participant): Substance => {
    const compound = library[participant.compound];
    if (compound?.kind !== "compound")
      throw new Error(`Missing compound ${participant.compound}`);
    const mol = openMolecule(rd, compound.smiles),
      s = {
        participant,
        compound,
        mol,
        graph: graphOf(mol) as Graph,
        numbers: options.numbers?.[participant.id],
      };
    loaded.push(s);
    return s;
  };
  try {
    const reactants = reaction.reactants.map(load);
    for (const participant of reaction.products) {
      const product = load(participant),
        name = participant.number || participant.sourceKey || participant.id;
      const label = `${reaction.title} → 产物 ${name}`;
      const cores = reactants
        .map((a) => ({
          a,
          core: figureCommonCore(rd, a.mol, product.mol, false),
        }))
        .sort((a, b) => b.core.numAtoms - a.core.numAtoms);
      const best = cores[0];
      let result: Difference | undefined, reason: string | undefined;
      if (!best || best.core.numAtoms < 3) reason = "公共骨架少于 3 个原子";
      else if (best.core.canceled) reason = "公共骨架搜索超时";
      else if (
        cores.some(
          ({ a, core }) =>
            core.numAtoms === best.core.numAtoms &&
            a.compound.graph !== best.a.compound.graph,
        )
      )
        reason = "多个不同反应物具有同样大小的主骨架";
      else {
        const query = rd.get_qmol(best.core.smarts)!;
        try {
          const ma = matches(best.a.mol, query),
            mb = matches(product.mol, query);
          if (ma.length === 64 || mb.length === 64)
            reason = "对称对应超过枚举上限";
          else {
            const contributions = cores.slice(1).map(({ a, core }) => {
              if (core.canceled)
                return { a, matches: [], originals: [], canceled: true };
              if (!core.numAtoms)
                return { a, matches: [], originals: [], canceled: false };
              const q = rd.get_qmol(core.smarts)!;
              try {
                return {
                  a,
                  matches: matches(product.mol, q),
                  originals: matches(a.mol, q),
                  canceled: false,
                };
              } finally {
                q.delete();
              }
            });
            let bestCost = Infinity,
              ambiguous = false;
            outer: for (const pa of ma)
              for (const pb of mb) {
                const mapping = new Map(pb.map((p, i) => [p, pa[i]]));
                const brought = new Set<number>(),
                  broughtBonds = new Set<number>();
                for (const contribution of contributions) {
                  if (
                    contribution.canceled ||
                    contribution.matches.length === 64 ||
                    contribution.originals.length === 64
                  ) {
                    reason = "其他反应物对应未完成";
                    break outer;
                  }
                  const sets = contribution.matches
                    .flatMap((m) =>
                      contribution.originals.map((original) => {
                        const imported = m.filter(
                          (i) => !mapping.has(i) && !brought.has(i),
                        );
                        const unchanged = product.graph.bonds.flatMap(
                          (bond, i) => {
                            if (!bond.atoms.every((v) => imported.includes(v)))
                              return [];
                            const old = bondAt(
                              contribution.a.graph,
                              original[m.indexOf(bond.atoms[0])],
                              original[m.indexOf(bond.atoms[1])],
                            );
                            return old && (old.bo ?? 1) === (bond.bo ?? 1)
                              ? [i]
                              : [];
                          },
                        );
                        return { imported, unchanged };
                      }),
                    )
                    .sort(
                      (a, b) =>
                        b.imported.length - a.imported.length ||
                        b.unchanged.length - a.unchanged.length,
                    );
                  if (sets[0]?.imported.length) {
                    const candidates = sets.filter(
                      (v) =>
                        v.imported.length === sets[0].imported.length &&
                        v.unchanged.length === sets[0].unchanged.length,
                    );
                    if (
                      new Set(
                        candidates.map((v) =>
                          JSON.stringify([
                            v.imported.toSorted((a, b) => a - b),
                            v.unchanged,
                          ]),
                        ),
                      ).size > 1
                    ) {
                      reason = "其他反应物带入位置不唯一";
                      break outer;
                    }
                    sets[0].imported.forEach((i) => brought.add(i));
                    sets[0].unchanged.forEach((i) => broughtBonds.add(i));
                  }
                }
                const next = compare(
                  best.a,
                  product,
                  mapping,
                  brought,
                  broughtBonds,
                );
                const cost =
                  next.atoms.size + next.bonds.size + next.uncertain.length;
                if (cost < bestCost) {
                  bestCost = cost;
                  result = next;
                  ambiguous = false;
                } else if (
                  cost === bestCost &&
                  result &&
                  signature(next) !== signature(result)
                )
                  ambiguous = true;
              }
            if (!reason && ambiguous)
              reason = "最少编辑的骨架对应给出不同反应中心";
          }
        } finally {
          query.delete();
        }
      }
      if (reason || !result) {
        lines.push(`${label}｜未比较：${reason ?? "无对应"}`);
        result = {
          atoms: new Set(),
          bonds: new Set(),
          lines: [],
          uncertain: [],
          tooMany: false,
        };
      } else {
        lines.push(
          ...[...result.lines, ...result.uncertain].map(
            (line) => `${label}｜${line}｜自动`,
          ),
        );
        if (!result.lines.length && !result.uncertain.length)
          lines.push(`${label}｜无变化`);
        if (result.tooMany) {
          result.atoms.clear();
          result.bonds.clear();
          lines.push(`${label}｜变化过多，图上不标红`);
        }
      }
      const manual = (refs: AtomRef[]) =>
        refs
          .filter((a) => a.molecule === participant.id)
          .map((a) => {
            const i = product.compound.atomIds.indexOf(a.atom);
            if (i < 0) throw new Error(`changes: unknown atom ${a.atom}`);
            return i;
          });
      const add = new Set(manual(options.add ?? [])),
        remove = new Set(manual(options.remove ?? []));
      for (const i of add) {
        result.atoms.add(i);
        lines.push(`${label}｜${describe(product, i)}：加标｜手工`);
      }
      for (const i of remove) {
        result.atoms.delete(i);
        lines.push(`${label}｜${describe(product, i)}：去标｜手工`);
      }
      for (const [i, b] of product.graph.bonds.entries()) {
        if (b.atoms.some((a) => remove.has(a))) result.bonds.delete(i);
        else if (
          b.atoms.every((a) => result!.atoms.has(a)) &&
          b.atoms.some((a) => add.has(a))
        )
          result.bonds.add(i);
      }
      const ref = (i: number): AtomRef => ({
        molecule: participant.id,
        atom: product.compound.atomIds[i],
      });
      atoms.push(...[...result.atoms].sort((a, b) => a - b).map(ref));
      bonds.push(
        ...[...result.bonds]
          .sort((a, b) => a - b)
          .map(
            (i) => product.graph.bonds[i].atoms.map(ref) as [AtomRef, AtomRef],
          ),
      );
    }
    reaction.scene.changes = { atoms, bonds };
    return lines;
  } finally {
    loaded.forEach((s) => s.mol.delete());
  }
}
