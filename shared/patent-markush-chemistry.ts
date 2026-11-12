import type { MainModule, Mol } from "@rdkit/rdkit";
import { mappedDummies } from "./reaction-chemistry.ts";
import {
  validateMarkush,
  type Alternative,
  type Markush,
  type MarkushMatch,
  type MatchStatus,
  type GroupMatch,
} from "./patent-markush.ts";

type Toolkit = Pick<MainModule, "get_mol" | "get_qmol">;
interface Atom {
  z?: number;
  impHs?: number;
  chg?: number;
  isotope?: number;
  stereo?: string;
  [key: string]: unknown;
}
interface Bond {
  atoms: number[];
  bo?: number;
  stereo?: string;
  stereoAtoms?: number[];
}
interface Graph {
  atoms: Atom[];
  bonds: Bond[];
}
function parse(t: Toolkit, text: string, query = false) {
  const mol = query ? t.get_qmol(text) : t.get_mol(text);
  if (!mol) throw new Error(`Invalid ${query ? "SMARTS" : "SMILES"}`);
  return mol;
}
function graph(mol: Mol): Graph {
  return JSON.parse(mol.get_json()).molecules[0];
}
function neighbors(g: Graph, atom: number) {
  return g.bonds
    .filter((b) => b.atoms.includes(atom))
    .map((b) => b.atoms.find((i) => i !== atom)!);
}
/** Retain atom and bond order (including stereo), replacing boundary atoms by dummies. */
function slice(
  t: Toolkit,
  mol: Mol,
  keep: Set<number>,
  boundary = new Set<number>(),
) {
  const lines = mol.get_v3Kmolblock().split("\n");
  const atoms = lines.slice(
    lines.indexOf("M  V30 BEGIN ATOM") + 1,
    lines.indexOf("M  V30 END ATOM"),
  );
  const bonds = lines.slice(
    lines.indexOf("M  V30 BEGIN BOND") + 1,
    lines.indexOf("M  V30 END BOND"),
  );
  const retained = atoms
    .map((_, i) => i)
    .filter((i) => keep.has(i) || boundary.has(i));
  const index = new Map(retained.map((old, i) => [old, i + 1]));
  const atomLines = retained.map((old) => {
    const fields = atoms[old].trim().split(/\s+/);
    fields[2] = String(index.get(old));
    fields[7] = "0";
    if (boundary.has(old)) {
      fields[3] = "*";
      fields.splice(8);
    }
    return fields.join(" ").replace(/^M V30/, "M  V30");
  });
  const bondLines = bonds
    .flatMap((line) => {
      const fields = line.trim().split(/\s+/),
        a = Number(fields[4]) - 1,
        b = Number(fields[5]) - 1;
      if (!index.has(a) || !index.has(b) || (!keep.has(a) && !keep.has(b)))
        return [];
      fields[4] = String(index.get(a));
      fields[5] = String(index.get(b));
      return [fields];
    })
    .map((fields, i) => {
      fields[2] = String(i + 1);
      return fields.join(" ").replace(/^M V30/, "M  V30");
    });
  const block = [
    "",
    "     RDKit",
    "",
    "  0  0  0  0  0  0  0  0  0  0999 V3000",
    "M  V30 BEGIN CTAB",
    `M  V30 COUNTS ${atomLines.length} ${bondLines.length} 0 0 0`,
    "M  V30 BEGIN ATOM",
    ...atomLines,
    "M  V30 END ATOM",
    "M  V30 BEGIN BOND",
    ...bondLines,
    "M  V30 END BOND",
    "M  V30 END CTAB",
    "M  END",
  ].join("\n");
  return { mol: parse(t, block), indices: retained };
}
function matches(mol: Mol, query: Mol): number[][] {
  const result = JSON.parse(
    mol.get_substruct_matches(
      query,
      JSON.stringify({ uniquify: false, useChirality: true }),
    ),
  );
  return Array.isArray(result)
    ? result.map((m: { atoms: number[] }) => m.atoms)
    : [];
}
function attachments(mol: Mol, expected?: number[]) {
  const d = mappedDummies(mol),
    g = graph(mol);
  if (
    !d.length ||
    d.some(
      (a) =>
        neighbors(g, a.atom).length !== 1 ||
        g.bonds.some((b) => b.atoms.includes(a.atom) && (b.bo ?? 1) !== 1),
    )
  )
    throw new Error("Needs terminal single-bond attachments");
  if (
    expected &&
    JSON.stringify(d.map((a) => a.map).sort()) !==
      JSON.stringify([...expected].sort())
  )
    throw new Error("Attachment labels differ from R definitions");
  return d;
}
function single(t: Toolkit, smiles: string) {
  const mol = parse(t, smiles);
  try {
    if (attachments(mol).length !== 1 || mol.get_smiles().includes("."))
      throw new Error("Fragment needs one attachment");
  } catch (e) {
    mol.delete();
    throw e;
  }
  return mol;
}
function same(t: Toolkit, a: Mol, b: Mol) {
  const ag = graph(a),
    bg = graph(b),
    q = parse(t, b.get_smarts(), true);
  try {
    return (
      ag.atoms.length === bg.atoms.length &&
      ag.bonds.length === bg.bonds.length &&
      matches(a, q).some((mapping) =>
        mapping.every((target, i) => {
          const actual = ag.atoms[target],
            expected = bg.atoms[i];
          return (
            (actual.z ?? 6) === (expected.z ?? 6) &&
            (actual.chg ?? 0) === (expected.chg ?? 0) &&
            (actual.isotope ?? 0) === (expected.isotope ?? 0) &&
            (actual.impHs ?? 0) === (expected.impHs ?? 0)
          );
        }),
      )
    );
  } finally {
    q.delete();
  }
}

/** Join labeled termini through graph substitution, retaining RDKit's stereo serialization. */
function join(t: Toolkit, left: string, right: string) {
  const a = parse(t, left),
    b = single(t, right);
  try {
    const aj = JSON.parse(a.get_json()),
      ag: Graph = aj.molecules[0],
      bg = graph(b);
    const da = mappedDummies(a).find((d) => d.map === 2)!,
      db = attachments(b)[0];
    const na = neighbors(ag, da.atom)[0],
      nb = neighbors(bg, db.atom)[0];
    const offset = ag.atoms.length;
    const allAtoms = [...ag.atoms, ...bg.atoms];
    const retained = allAtoms
      .map((_, i) => i)
      .filter((i) => i !== da.atom && i !== db.atom + offset);
    const remap = new Map(retained.map((old, i) => [old, i]));
    const bonds = [
      ...ag.bonds,
      ...bg.bonds.map((x) => ({
        ...x,
        atoms: x.atoms.map((i) => i + offset),
        stereoAtoms: x.stereoAtoms?.map((i) => i + offset),
      })),
    ].filter(
      (x) => !x.atoms.includes(da.atom) && !x.atoms.includes(db.atom + offset),
    );
    bonds.push({ atoms: [na, nb + offset] });
    aj.molecules = [
      {
        atoms: retained.map((i) => allAtoms[i]),
        bonds: bonds.map((x) => ({
          ...x,
          atoms: x.atoms.map((i) => remap.get(i)!),
          ...(x.stereoAtoms
            ? { stereoAtoms: x.stereoAtoms.map((i) => remap.get(i)!) }
            : {}),
        })),
      },
    ];
    const result = parse(t, JSON.stringify(aj));
    try {
      // JSON does not preserve atom maps; restore the remaining left terminus.
      const dummy = graph(result).atoms.findIndex((x) => x.z === 0);
      const block = result.get_v3Kmolblock().split("\n");
      const at = block.indexOf("M  V30 BEGIN ATOM") + 1 + dummy;
      const f = block[at].trim().split(/\s+/);
      f[7] = "2";
      block[at] = f.join(" ").replace(/^M V30/, "M  V30");
      const mapped = parse(t, block.join("\n"));
      try {
        return mapped.get_smiles();
      } finally {
        mapped.delete();
      }
    } finally {
      result.delete();
    }
  } finally {
    a.delete();
    b.delete();
  }
}
function repeat(
  t: Toolkit,
  a: Extract<Alternative, { type: "repeat" }>,
  n: number,
) {
  let value = a.end;
  for (let i = 0; i < n; i++) {
    // Prepend one unit, joining its output (2) to the chain terminus.
    value = join(t, a.unit, value);
  }
  return value;
}
export function validateMarkushChemistry(
  t: Toolkit,
  model: Markush,
  where: string,
) {
  validateMarkush(model, where);
  try {
    const core = parse(t, model.core);
    try {
      const dummies = mappedDummies(core),
        g = graph(core);
      const keys = [...new Set(dummies.map((d) => String(d.map)))].sort();
      if (
        dummies.length &&
        (dummies.length !== keys.length ||
          dummies.some((d) => !Object.hasOwn(model.groups, String(d.map))))
      )
        throw new Error("Undefined or duplicate core attachment");
      if (dummies.length) attachments(core);
      if (dummies.length === g.atoms.length || core.get_smiles().includes("."))
        throw new Error("Core must be connected and nonempty");
      for (const [key, group] of Object.entries(model.groups)) {
        const reachable =
          dummies.some((d) => String(d.map) === key) ||
          Object.values(model.groups).some((g) =>
            g.alternatives.some(
              (a) => a.type === "substituted" && a.group === key,
            ),
          );
        if (!reachable) throw new Error("Unused R definition");
        if (
          group.positions?.some(
            (i) =>
              !dummies.some((d) => String(d.map) === key) ||
              i >= g.atoms.length ||
              dummies.some((d) => d.atom === i),
          )
        )
          throw new Error("Invalid variable position");
        for (const a of group.alternatives) {
          if (a.type === "fragment" || a.type === "substituted")
            single(t, a.type === "fragment" ? a.smiles : a.core).delete();
          if (a.type === "class" || a.type === "count") {
            const q = parse(
              t,
              a.type === "class" ? a.smarts : a.atomSmarts,
              true,
            );
            try {
              if (a.type === "count" && q.get_num_atoms() !== 1)
                throw new Error("atomSmarts must match one atom");
            } finally {
              q.delete();
            }
          }
          if (a.type === "repeat") {
            const unit = parse(t, a.unit);
            try {
              attachments(unit, [1, 2]);
              if (unit.get_smiles().includes("."))
                throw new Error("Repeat unit must be connected");
            } finally {
              unit.delete();
            }
            single(t, a.end).delete();
            single(t, repeat(t, a, a.min)).delete();
            single(t, repeat(t, a, a.max)).delete();
          }
        }
      }
    } finally {
      core.delete();
    }
    for (const e of model.exclusions ?? [])
      parse(t, "smarts" in e ? e.smarts : e.smiles, "smarts" in e).delete();
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
}
interface Piece {
  atoms: Set<number>;
  links: { core: number; outside: number }[];
}
function pieces(g: Graph, core: Set<number>): Piece[] {
  const remaining = new Set(
      g.atoms.map((_, i) => i).filter((i) => !core.has(i)),
    ),
    result: Piece[] = [];
  for (const start of remaining) {
    const atoms = new Set<number>(),
      queue = [start],
      links: Piece["links"] = [];
    remaining.delete(start);
    while (queue.length) {
      const atom = queue.pop()!;
      atoms.add(atom);
      for (const n of neighbors(g, atom))
        if (core.has(n)) links.push({ core: n, outside: atom });
        else if (remaining.delete(n)) queue.push(n);
    }
    result.push({ atoms, links });
  }
  return result;
}
function verdict(statuses: MatchStatus[]): MatchStatus {
  return statuses.includes("not-matched")
    ? "not-matched"
    : statuses.includes("unmodeled")
      ? "unmodeled"
      : "matched";
}
type GroupResult = { status: MatchStatus; alternatives: string[] };
function checkGroup(
  t: Toolkit,
  model: Markush,
  key: string,
  fragment: Mol,
  cache: Map<string, GroupResult>,
): GroupResult {
  const cacheKey = `${key}:${fragment.get_smiles()}`;
  const found = cache.get(cacheKey);
  if (found) return found;
  const result = evaluateGroup(t, model, key, fragment, cache);
  cache.set(cacheKey, result);
  return result;
}
function evaluateGroup(
  t: Toolkit,
  model: Markush,
  key: string,
  fragment: Mol,
  cache: Map<string, GroupResult>,
): GroupResult {
  const group = model.groups[key],
    hits: string[] = [];
  let unknown = !!group.unmodeled;
  for (const a of group.alternatives) {
    let status: MatchStatus = "not-matched";
    if (a.type === "fragment") {
      const expected = single(t, a.smiles);
      try {
        status = same(t, fragment, expected) ? "matched" : "not-matched";
      } finally {
        expected.delete();
      }
    }
    if (a.type === "class") {
      const q = parse(t, a.smarts, true);
      try {
        status = matches(fragment, q).some(
          (m) => m.length === fragment.get_num_atoms(),
        )
          ? "matched"
          : "not-matched";
      } finally {
        q.delete();
      }
    }
    if (a.type === "count") {
      const g = graph(fragment),
        q = parse(t, a.atomSmarts, true);
      try {
        const accepted = new Set(matches(fragment, q).map((m) => m[0])),
          real = g.atoms.filter((x) => x.z !== 0);
        const count =
          a.element === 1
            ? real.reduce((n, x) => n + (x.z === 1 ? 1 : (x.impHs ?? 0)), 0)
            : real.filter((x) => (x.z ?? 6) === a.element).length;
        status =
          count >= a.min &&
          count <= a.max &&
          g.atoms.every((x, i) => x.z === 0 || accepted.has(i)) &&
          g.bonds.every((b) => (b.bo ?? 1) === 1)
            ? "matched"
            : "not-matched";
      } finally {
        q.delete();
      }
    }
    if (a.type === "repeat") {
      for (let n = a.min; n <= a.max; n++) {
        const expected = single(t, repeat(t, a, n));
        try {
          if (same(t, fragment, expected)) status = "matched";
        } finally {
          expected.delete();
        }
        if (status === "matched") break;
      }
    }
    if (a.type === "substituted") {
      const base = single(t, a.core),
        q = parse(t, base.get_smarts(), true),
        fg = graph(fragment),
        bg = graph(base);
      try {
        for (const mapping of matches(fragment, q)) {
          if (
            !mapping.every(
              (target, i) =>
                (fg.atoms[target].z === 0) === (bg.atoms[i].z === 0),
            )
          )
            continue;
          const sides = pieces(fg, new Set(mapping));
          if (sides.length < a.min || sides.length > a.max) continue;
          const statuses = sides.map((p) => {
            if (p.links.length !== 1) return "unmodeled" as const;
            const side = slice(
              t,
              fragment,
              p.atoms,
              new Set([p.links[0].core]),
            ).mol;
            try {
              return checkGroup(t, model, a.group, side, cache).status;
            } finally {
              side.delete();
            }
          });
          const result = verdict(statuses);
          if (result === "matched") {
            status = result;
            break;
          }
          if (result === "unmodeled") status = result;
        }
      } finally {
        base.delete();
        q.delete();
      }
    }
    if (status === "matched") hits.push(a.id);
    if (status === "unmodeled") unknown = true;
  }
  return {
    status: hits.length ? "matched" : unknown ? "unmodeled" : "not-matched",
    alternatives: hits,
  };
}
export function matchMarkush(
  t: Toolkit,
  smiles: string,
  model?: Markush,
): MarkushMatch {
  return evaluateMarkush(t, smiles, model, new Map());
}
function evaluateMarkush(
  t: Toolkit,
  smiles: string,
  model: Markush | undefined,
  cache: Map<string, GroupResult>,
): MarkushMatch {
  const target = parse(t, smiles);
  try {
    if (!model) return { status: "unmodeled", reason: "unmodeled", groups: [] };
    for (const e of model.exclusions ?? []) {
      const q = parse(t, "smarts" in e ? e.smarts : e.smiles, "smarts" in e);
      try {
        const hit =
          "smarts" in e
            ? matches(target, q).length > 0
            : target.get_smiles() === q.get_smiles();
        if (hit)
          return {
            status: "not-matched",
            reason: "excluded",
            exclusion: e.id,
            groups: [],
          };
      } finally {
        q.delete();
      }
    }
    const core = parse(t, model.core);
    try {
      const cg = graph(core),
        tg = graph(target),
        dummies = mappedDummies(core);
      const stripped = slice(
        t,
        core,
        new Set(
          cg.atoms
            .map((_, i) => i)
            .filter((i) => !dummies.some((d) => d.atom === i)),
        ),
      );
      const query = parse(t, stripped.mol.get_smarts(), true);
      try {
        const mappings = matches(target, query);
        if (!mappings.length)
          return { status: "not-matched", reason: "core", groups: [] };
        if (!dummies.length)
          return {
            status: model.unmodeled ? "unmodeled" : "matched",
            reason: model.unmodeled ? "unmodeled" : "within",
            groups: [],
          };
        let best: MarkushMatch | undefined;
        for (const mapping of mappings) {
          const sides = pieces(tg, new Set(mapping));
          const sites = dummies.map((d) => ({
            key: String(d.map),
            atoms: (
              model.groups[String(d.map)].positions ?? [
                neighbors(cg, d.atom)[0],
              ]
            ).map((i) => mapping[stripped.indices.indexOf(i)]),
          }));
          const groups: GroupMatch[] = [];
          function assign(
            index: number,
            used: Set<Piece>,
            hydrogens = new Map<number, number>(),
          ) {
            if (index === sites.length) {
              const extras = sides.filter((p) => !used.has(p));
              const status = verdict([
                ...groups.map((g) => g.status),
                ...(extras.length ? ["not-matched" as const] : []),
                ...(model.unmodeled ? ["unmodeled" as const] : []),
              ]);
              const result: MarkushMatch = {
                status,
                reason:
                  status === "matched"
                    ? "within"
                    : status === "unmodeled"
                      ? "unmodeled"
                      : "groups",
                groups: [...groups],
                outside: [
                  ...groups
                    .filter((g) => g.status === "not-matched")
                    .map((g) => g.key),
                  ...(extras.length ? ["core"] : []),
                ],
              };
              const rank = { matched: 2, unmodeled: 1, "not-matched": 0 };
              const matched = (r: MarkushMatch) =>
                r.groups.filter((g) => g.status === "matched").length;
              const preference = !best
                ? 1
                : rank[result.status] - rank[best.status] ||
                  Number(best.outside?.includes("core")) -
                    Number(result.outside?.includes("core")) ||
                  matched(result) - matched(best);
              if (preference > 0) best = result;
              return;
            }
            const site = sites[index],
              group = model.groups[site.key];
            const candidates = sides.filter(
              (p) =>
                (!used.has(p) || p.links.length > 1) &&
                p.links.some((l) => site.atoms.includes(l.core)),
            );
            // Hydrogen is a real option even when another R shares this anchor.
            const options: (Piece | undefined)[] = [...candidates, undefined];
            for (const p of options) {
              const anchor =
                p?.links[0].core ??
                site.atoms.find(
                  (atom) =>
                    (tg.atoms[atom].impHs ?? 0) > (hydrogens.get(atom) ?? 0),
                );
              if (!p && anchor === undefined) continue;
              let fragment: Mol | undefined;
              try {
                fragment = p
                  ? slice(
                      t,
                      target,
                      p.atoms,
                      new Set(p.links.map((l) => l.core)),
                    ).mol
                  : single(t, "*[H]");
                const check =
                  p && p.links.length !== 1
                    ? { status: "unmodeled" as const, alternatives: [] }
                    : checkGroup(t, model, site.key, fragment, cache);
                groups.push({
                  key: site.key,
                  label: group.label,
                  fragment: fragment.get_smiles(),
                  ...check,
                  note: group.unmodeled,
                });
                const nextH = new Map(hydrogens);
                if (!p) nextH.set(anchor!, (nextH.get(anchor!) ?? 0) + 1);
                assign(index + 1, p ? new Set(used).add(p) : used, nextH);
                groups.pop();
              } finally {
                fragment?.delete();
              }
            }
          }
          assign(0, new Set());
          if (best?.status === "matched") break;
        }
        return (
          best ?? {
            status: "not-matched",
            reason: "groups",
            groups: [],
            outside: dummies.map((d) => String(d.map)),
          }
        );
      } finally {
        query.delete();
        stripped.mol.delete();
      }
    } finally {
      core.delete();
    }
  } finally {
    target.delete();
  }
}
export async function markushCoverage(
  t: Toolkit,
  model: Markush,
  rows: { id: string | number; smiles: string }[],
) {
  const results: { id: string | number; result: MarkushMatch }[] = [],
    cache = new Map<string, GroupResult>();
  for (const row of rows) {
    results.push({
      id: row.id,
      result: row.smiles
        ? evaluateMarkush(t, row.smiles, model, cache)
        : { status: "unmodeled", reason: "unmodeled", groups: [] },
    });
    // Let the browser paint progress and keep navigation responsive during a collection query.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    results,
    groups: Object.entries(model.groups)
      .filter(([key]) => {
        const core = parse(t, model.core);
        try {
          return mappedDummies(core).some((d) => String(d.map) === key);
        } finally {
          core.delete();
        }
      })
      .map(([key, group]) => ({
        key,
        label: group.label,
        alternatives: group.alternatives.map((a) => ({
          id: a.id,
          label: a.label,
          examples: results
            .filter((r) =>
              r.result.groups.some(
                (g) => g.key === key && g.alternatives.includes(a.id),
              ),
            )
            .map((r) => r.id),
        })),
        outside: results.flatMap((r) =>
          r.result.groups
            .filter((g) => g.key === key && g.status === "not-matched")
            .map((g) => ({ id: r.id, fragment: g.fragment })),
        ),
        unmodeled: results
          .filter(
            (r) =>
              r.result.status === "unmodeled" &&
              (!r.result.groups.length ||
                r.result.groups.some(
                  (g) => g.key === key && g.status === "unmodeled",
                )),
          )
          .map((r) => r.id),
      })),
  };
}
