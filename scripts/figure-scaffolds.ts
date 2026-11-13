import type { ChemicalMolecule as Mol } from "../shared/chemical-toolkit.ts";
import type { PythonToolkit as MainModule } from "./chemical-toolkit.ts";
import { scaffolds } from "./figure-template-data.ts";
import { graphOf, openMolecule } from "../shared/chemical-library/chemistry.ts";
import type {
  Compound,
  CompoundLayout,
} from "../shared/chemical-library/types.ts";

type XYZ = [number, number, number];
type XY = [number, number];
const minus = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const norm = (v: number[]) => Math.hypot(...v);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b),
    n = s.length;
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const neighbours = (mol: Mol) => {
  const graph = graphOf(mol),
    out = graph.atoms.map(() => [] as number[]);
  for (const {
    atoms: [a, b],
  } of graph.bonds) {
    out[a].push(b);
    out[b].push(a);
  }
  return out;
};
const outward = (p: number[], others: number[][]) =>
  p.map(
    (_, i) =>
      -others.reduce((s, q) => s + (q[i] - p[i]) / norm(minus(q, p)), 0),
  );
export function matchingScaffold(rd: MainModule, mol: Mol) {
  for (const data of scaffolds) {
    const query = rd.get_qmol(data.smarts)!;
    try {
      const matches: { atoms: number[] }[] = JSON.parse(
        mol.get_substruct_matches(
          query,
          JSON.stringify({ uniquify: false, maxMatches: 1000 }),
        ),
      );
      if (matches.length) return { data, matches: matches.map((m) => m.atoms) };
    } finally {
      query.delete();
    }
  }
}
function compatible(rd: MainModule, mol: Mol, match: number[], xyz: XYZ[]) {
  const graph = graphOf(mol),
    adj = neighbours(mol),
    positions = new Map(match.map((a, i) => [a, xyz[i]])),
    centres = match.filter(
      (a) =>
        adj[a].filter((n) => positions.has(n)).length >= 3 &&
        graph.atoms[a].stereo &&
        graph.atoms[a].stereo !== "unspecified",
    );
  if (!centres.length) return true;
  for (const a of centres) {
    const inside = adj[a].filter((n) => positions.has(n)),
      v = outward(
        positions.get(a)!,
        inside.map((n) => positions.get(n)!),
      );
    for (const n of adj[a].filter((n) => !positions.has(n)))
      positions.set(n, positions.get(a)!.map((p, i) => p + v[i]) as XYZ);
  }
  const lines = mol.get_v2Kmolblock().split("\n"),
    n = mol.get_num_atoms();
  lines[1] = lines[1].slice(0, 20).padEnd(20) + "3D";
  for (let i = 0; i < n; i++) {
    const p = positions.get(i) ?? [0, 0, 0];
    lines[4 + i] =
      p.map((v) => v.toFixed(4).padStart(10)).join("") +
      lines[4 + i].slice(30, 39) +
      "  0" +
      lines[4 + i].slice(42);
  }
  for (let i = 4 + n; i < 4 + n + graph.bonds.length; i++)
    lines[i] = lines[i].slice(0, 9) + "  0" + lines[i].slice(12);
  const probe = openMolecule(rd, lines.join("\n"));
  try {
    const actual = graphOf(probe);
    return centres.every(
      (i) => actual.atoms[i].stereo === graph.atoms[i].stereo,
    );
  } finally {
    probe.delete();
  }
}
/** Native coordinate pins constrain the saved scaffold without changing atom identity. */
function constrain(rd: MainModule, mol: Mol, positions: Map<number, XY>) {
  return rd.constrain(
    mol,
    [...positions].map(([atom, [x, y]]) => [atom, x, y]),
  );
}

function extend(mol: Mol, points: XY[], core: Set<number>) {
  const left = new Set(
      graphOf(mol)
        .atoms.map((_, i) => i)
        .filter((i) => !core.has(i)),
    ),
    adj = neighbours(mol);
  while (left.size) {
    const first = left.values().next().value!,
      todo = [first],
      component = [first],
      boundary: [number, number][] = [];
    left.delete(first);
    while (todo.length) {
      const i = todo.pop()!;
      for (const j of adj[i])
        if (core.has(j)) boundary.push([i, j]);
        else if (left.delete(j)) {
          todo.push(j);
          component.push(j);
        }
    }
    if (boundary.length !== 1) continue;
    const [i, j] = boundary[0],
      v = minus(points[i], points[j]),
      factor = 1.5 / norm(v) - 1;
    for (const k of component)
      points[k] = points[k].map((p, a) => p + v[a] * factor) as XY;
  }
}
function tidy(mol: Mol, p: XY[], core: Set<number>) {
  const graph = graphOf(mol),
    adj = neighbours(mol),
    terms = adj.flatMap((n, i) => (n.length === 1 && !core.has(i) ? [i] : []));
  const cross = (a: XY, b: XY, c: XY, d: XY) => {
    const side = (p: XY, q: XY, r: XY) =>
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return (
      side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
    );
  };
  const distance = (a: XY, b: XY, c: XY) => {
    const v = minus(c, b),
      t = Math.max(
        0,
        Math.min(
          1,
          minus(a, b).reduce((s, x, i) => s + x * v[i], 0) / norm(v) ** 2,
        ),
      );
    return norm(
      minus(
        a,
        b.map((x, i) => x + t * v[i]),
      ),
    );
  };
  const score = (i: number) => {
    const j = adj[i][0];
    let cost = 0;
    for (const {
      atoms: [a, b],
    } of graph.bonds) {
      if (
        ![i, j].includes(a) &&
        ![i, j].includes(b) &&
        cross(p[i], p[j], p[a], p[b])
      )
        cost += 100;
      if (a !== i && b !== i)
        cost += 30 * Math.max(0, 0.48 - distance(p[i], p[a], p[b])) ** 2;
    }
    for (const k of adj.keys())
      if (k !== i && k !== j)
        cost +=
          30 *
          Math.max(
            0,
            (graph.atoms[k].z && graph.atoms[k].z !== 6 ? 1.05 : 0.65) -
              norm(minus(p[i], p[k])),
          ) **
            2;
    for (const k of adj[j])
      if (k !== i) {
        const u = minus(p[i], p[j]),
          v = minus(p[k], p[j]),
          angle =
            (Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  u.reduce((s, x, a) => s + x * v[a], 0) / norm(u) / norm(v),
                ),
              ),
            ) *
              180) /
            Math.PI,
          minimum =
            terms.includes(k) &&
            (graph.atoms[i].z ?? 6) === 6 &&
            (graph.atoms[k].z ?? 6) === 6
              ? 100
              : 45;
        cost += 0.03 * Math.max(0, minimum - angle) ** 2;
      }
    return cost;
  };
  for (let pass = 0; pass < 3; pass++)
    for (const i of [...terms].sort((a, b) => score(b) - score(a))) {
      let cost = score(i);
      if (cost < 0.01) continue;
      const old = p[i],
        j = adj[i][0],
        v = minus(old, p[j]);
      let best = old;
      for (const deg of [
        0, 20, -20, 40, -40, 60, -60, 80, -80, 100, -100, 120, -120, 160, -160,
        180,
      ])
        for (const length of [1.5, 1.8]) {
          const a = (deg * Math.PI) / 180;
          p[i] = [
            p[j][0] +
              ((v[0] * Math.cos(a) - v[1] * Math.sin(a)) * length) / norm(v),
            p[j][1] +
              ((v[0] * Math.sin(a) + v[1] * Math.cos(a)) * length) / norm(v),
          ];
          const c = score(i) + Math.abs(deg) * 0.001 + (length - 1.5) * 0.2;
          if (c < cost) {
            cost = c;
            best = p[i];
          }
        }
      p[i] = best;
    }
}
/** Add the prototype's ring stereocentre H before constraining and tidying the scaffold. */
export function ringHydrogens(rd: MainModule, source: Mol) {
  const ringsOf = (mol: Mol): number[][] =>
    JSON.parse(mol.get_json()).molecules[0].extensions?.find(
      (e: { name: string }) => e.name === "rdkitRepresentation",
    )?.atomRings ?? [];
  const ringEdges = (rings: number[][]) =>
    new Set(
      rings.flatMap((r) =>
        r.map((a, i) =>
          [a, r[(i + 1) % r.length]].sort((a, b) => a - b).join("/"),
        ),
      ),
    );
  const graph = graphOf(source),
    rings = ringsOf(source),
    edges = ringEdges(rings),
    adj = neighbours(source);
  const need = new Set(
    graph.atoms.flatMap((a, i) =>
      a.stereo &&
      a.stereo !== "unspecified" &&
      a.impHs === 1 &&
      rings.some((r) => r.includes(i)) &&
      adj[i].every((j) => edges.has([i, j].sort((a, b) => a - b).join("/")))
        ? [i]
        : [],
    ),
  );
  const add = (mol: Mol, selected: Set<number>) => {
    if (!selected.size) return mol;
    const all = openMolecule(rd, mol.get_molblock());
    try {
      const count = all.get_num_atoms(),
        before = graphOf(mol);
      all.add_hs_in_place();
      const data = JSON.parse(all.get_json()),
        g = data.molecules[0],
        neighboursOfAll = neighbours(all);
      const kept: number[] = g.atoms.flatMap((_: unknown, i: number) =>
        i < count || selected.has(neighboursOfAll[i][0]) ? [i] : [],
      );
      const indices = new Map(kept.map((a, i) => [a, i]));
      g.atoms = kept.map((i) => ({
        ...g.atoms[i],
        ...(i < count && !selected.has(i)
          ? { impHs: before.atoms[i].impHs ?? 0 }
          : {}),
      }));
      for (const extension of g.extensions ?? []) {
        delete extension.cipRanks;
        delete extension.cipCodes;
      }
      g.bonds = g.bonds
        .filter((b: { atoms: number[] }) =>
          b.atoms.every((a) => indices.has(a)),
        )
        .map((b: { atoms: number[] }) => ({
          ...b,
          atoms: b.atoms.map((a) => indices.get(a)),
        }));
      delete g.conformers;
      return openMolecule(rd, JSON.stringify(data), false);
    } finally {
      all.delete();
    }
  };
  let mol = add(source, need);
  mol.set_new_coords(false);
  const probeGraph = graphOf(mol),
    atomCount = mol.get_num_atoms(),
    lines = mol.get_v2Kmolblock().split("\n"),
    fused = new Set(
      rings
        .filter((r, i) =>
          rings.some((q, j) => i !== j && r.some((a) => q.includes(a))),
        )
        .flat(),
    ),
    more = new Set<number>();
  for (const line of lines.slice(
    4 + atomCount,
    4 + atomCount + probeGraph.bonds.length,
  )) {
    const a = Number(line.slice(0, 3)) - 1,
      b = Number(line.slice(3, 6)) - 1,
      style = Number(line.slice(9, 12));
    if (
      [1, 6].includes(style) &&
      edges.has([a, b].sort((a, b) => a - b).join("/")) &&
      fused.has(a) &&
      probeGraph.atoms[a].impHs === 1
    )
      more.add(a);
  }
  const complete = add(mol, more);
  if (mol !== source && complete !== mol) mol.delete();
  return complete;
}
function coordinateMolecule(rd: MainModule, mol: Mol, points: XY[]) {
  const data = JSON.parse(mol.get_json());
  data.molecules[0].conformers = [{ dim: 2, coords: [] }];
  return openMolecule(
    rd,
    JSON.stringify(data).replace(
      '"coords":[]',
      '"coords":[' +
        points
          .map(([x, y]) => `[${x.toExponential()},${y.toExponential()}]`)
          .join(",") +
        "]",
    ),
    false,
  );
}
export function scaffoldLayout(
  rd: MainModule,
  compound: Compound,
  drawing: "flat" | "perspective",
): CompoundLayout {
  const original = openMolecule(rd, compound.smiles);
  const mol = ringHydrogens(rd, original);
  try {
    const hit = matchingScaffold(rd, mol);
    if (!hit)
      throw new Error(
        `${compound.id}: no registered scaffold matches drawing: ${drawing}`,
      );
    const { data, matches } = hit,
      core = openMolecule(rd, data.smiles);
    let match = matches[0],
      points: XY[],
      depths: number[] | undefined;
    try {
      if (drawing === "flat" && !data.views.flat.xy) {
        mol.set_new_coords(data.views.flat.engine === "coordgen");
        mol.straighten_depiction();
        points = graphOf(mol).conformers![0].coords;
      } else {
        let xyz: XYZ[] | undefined;
        if (drawing === "perspective") {
          const projected = data.conformer.xyz.map(
            (p) =>
              data.views.perspective.camera.map((row) =>
                row.reduce((s, v, i) => s + v * p[i], 0),
              ) as XYZ,
          );
          outer: for (const sign of [1, -1])
            for (const m of matches) {
              const trial = projected.map(([x, y, z]): XYZ => [x, y, z * sign]);
              if (compatible(rd, mol, m, trial)) {
                match = m;
                xyz = trial;
                break outer;
              }
            }
          if (!xyz)
            throw new Error(
              `${data.id}: no conformer compatible with junction stereochemistry`,
            );
          const scale =
            1.5 /
            median(
              graphOf(core).bonds.map((b) =>
                norm(
                  minus(
                    xyz![b.atoms[0]].slice(0, 2),
                    xyz![b.atoms[1]].slice(0, 2),
                  ),
                ),
              ),
            );
          xyz = xyz.map((p) => p.map((v) => v * scale) as XYZ);
          depths = xyz.map((p) => p[2]);
        }
        const positions = new Map(
            match.map((a, i) => [
              a,
              (xyz ? xyz[i].slice(0, 2) : data.views.flat.xy![i]) as XY,
            ]),
          ),
          adj = neighbours(mol);
        for (const a of match) {
          const inside = adj[a].filter((n) => positions.has(n)),
            outside = adj[a].filter((n) => !positions.has(n));
          let v: number[] | undefined;
          if (xyz && inside.length === 3 && outside.length === 1)
            v = outward(
              xyz[match.indexOf(a)],
              inside.map((n) => xyz![match.indexOf(n)]),
            ).slice(0, 2);
          else if (!xyz && data.views.flat.outward?.[String(match.indexOf(a))])
            v = data.views.flat.outward[String(match.indexOf(a))];
          if (v)
            for (const n of outside)
              positions.set(
                n,
                positions
                  .get(a)!
                  .map((p, i) => p + (v![i] / norm(v!)) * 1.5) as XY,
              );
        }
        points = constrain(rd, mol, positions);
        if (xyz) extend(mol, points, new Set(match));
      }
      if (drawing === "flat") {
        const lengths = graphOf(mol)
          .bonds.map(({ atoms: [a, b] }) => norm(minus(points[a], points[b])))
          .sort((a, b) => a - b);
        const scale = 1.5 / lengths[Math.floor(lengths.length / 2)];
        if (Math.abs(scale - 1) > 0.02)
          points = points.map((p) => [p[0] * scale, p[1] * scale]);
      }
      tidy(mol, points, new Set(match));
      const cx =
          (Math.min(...points.map((p) => p[0])) +
            Math.max(...points.map((p) => p[0]))) /
          2,
        cy =
          (Math.min(...points.map((p) => p[1])) +
            Math.max(...points.map((p) => p[1]))) /
          2;
      const coreBonds = graphOf(core).bonds.map(
        (b) =>
          b.atoms.map((a) => compound.atomIds[match[a]]) as [string, string],
      );
      const scaffold: NonNullable<CompoundLayout["scaffold"]> = {
        id: data.id,
        drawing,
        bonds: coreBonds,
      };
      if (depths) {
        scaffold.depths = Object.fromEntries(
          match.map((a, i) => [compound.atomIds[a], depths![i]]),
        );
        scaffold.depthWidth = data.views.perspective.depth_width;
      }
      if (drawing === "flat" && data.views.flat.overpasses)
        scaffold.overpasses = data.views.flat.overpasses.map(([a, b]) => [
          coreBonds[a],
          coreBonds[b],
        ]);
      const hydrogens: NonNullable<CompoundLayout["hydrogens"]> = {},
        wedgeBonds: NonNullable<CompoundLayout["wedgeBonds"]> = [];
      const g = graphOf(mol),
        count = compound.atomIds.length;
      for (const {
        atoms: [a, b],
      } of g.bonds) {
        const h = a >= count ? a : b >= count ? b : undefined;
        if (h !== undefined)
          hydrogens[compound.atomIds[a === h ? b : a]] = {
            x: (points[h][0] - cx) / 1.5,
            y: -(points[h][1] - cy) / 1.5,
          };
      }
      const drawn = coordinateMolecule(rd, mol, points);
      try {
        const lines = drawn.get_v2Kmolblock().split("\n");
        for (const line of lines.slice(
          4 + mol.get_num_atoms(),
          4 + mol.get_num_atoms() + g.bonds.length,
        )) {
          const a = Number(line.slice(0, 3)) - 1,
            b = Number(line.slice(3, 6)) - 1,
            style = Number(line.slice(9, 12));
          if (style === 1 || style === 6)
            wedgeBonds.push({
              from: compound.atomIds[a],
              to: b >= count ? "H" : compound.atomIds[b],
              style: style === 1 ? "solid" : "hashed",
            });
        }
      } finally {
        drawn.delete();
      }
      return {
        ...structuredClone(compound.layout),
        coords: Object.fromEntries(
          compound.atomIds.map((id, i) => [
            id,
            { x: (points[i][0] - cx) / 1.5, y: -(points[i][1] - cy) / 1.5 },
          ]),
        ),
        scaffold,
        ...(Object.keys(hydrogens).length ? { hydrogens } : {}),
        ...(wedgeBonds.length ? { wedgeBonds } : {}),
      };
    } finally {
      core.delete();
    }
  } finally {
    if (mol !== original) mol.delete();
    original.delete();
  }
}
