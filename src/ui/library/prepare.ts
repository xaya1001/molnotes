import type {
  FigureGeometry,
  FigureNode,
  FigureRect,
} from "../../../shared/chemical-library/geometry.ts";
import type { ChemistryToolkit } from "../chemistry/rdkit.ts";
import type { FigureFontResolver } from "./font-geometry.ts";
import {
  createFigureScene,
  type FigureStyle,
  type FigureGroup,
} from "./scene-geometry.ts";
import { routeGeometryArrow } from "./geometry-arrows.ts";
import { nativeDepictionGeometry } from "./native-geometry.ts";
import { transformPoint, rectangle } from "./geometry-math.ts";
import {
  pathMetrics,
  pathContours,
  inkIntersectsBox,
} from "./path-geometry.ts";
import { refreshGeometry } from "./geometry-tree.ts";
import { wrapFigureText, figureLabelLines } from "./text-runs.ts";
import { solidArrow } from "./arrow-layout.ts";

import {
  bondTraces,
  contains,
  inkBox,
  labelBoxes,
  overlap,
  spaceChiralHydrogens,
  spaceAtomNumber,
} from "./geometry-spacing.ts";
import {
  drawingMolecule,
  atomNumberDrawing,
  abbreviatedDrawing,
  compoundAbbreviations,
  graphOf,
  placedCoordinates,
  validateCompound,
  validateSceneChemistry,
} from "../../../shared/chemical-library/chemistry.ts";
import { abbreviationLabel } from "../../../shared/molecule-abbreviations.ts";
import { routeMetrics } from "../../../shared/chemical-library/routes.ts";
import type {
  Anchor,
  AtomRef,
  Compound,
  CompoundLayout,
  FigureReference,
  Focus,
  Library,
  Point,
  Route,
  Scene,
} from "../../../shared/chemical-library/types.ts";

const key = (a: AtomRef) => `${a.molecule}:${a.atom}`;
const plus = (a: Point, b: Point) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (p: Point, s: number) => ({ x: p.x * s, y: p.y * s });
const radians = (n: number) => (n * Math.PI) / 180;
const toward = (angle: number, r: number) => ({
  x: Math.cos(radians(angle)) * r,
  y: Math.sin(radians(angle)) * r,
});
function focusKeys(f?: Focus) {
  return {
    atoms: new Set(f?.primary?.atoms?.map(key)),
    bonds: new Set(
      f?.primary?.bonds?.map(([a, b]) => [key(a), key(b)].sort().join("/")),
    ),
    arrows: new Set(f?.primary?.arrows),
    support: new Set(f?.supporting?.flatMap((g) => g.atoms?.map(key) ?? [])),
    supportBonds: new Set(
      f?.supporting?.flatMap(
        (g) =>
          g.bonds?.map(([a, b]) => [key(a), key(b)].sort().join("/")) ?? [],
      ),
    ),
    supportArrows: new Set(f?.supporting?.flatMap((g) => g.arrows ?? [])),
  };
}
function prefixedFocus(
  f: Focus | undefined,
  prefix: string,
): Focus | undefined {
  if (!f || !prefix) return f;
  const atom = (a: AtomRef) => ({ ...a, molecule: prefix + a.molecule });
  const group = (g: NonNullable<Focus["primary"]>) => ({
    ...g,
    atoms: g.atoms?.map(atom),
    bonds: g.bonds?.map(([a, b]): [AtomRef, AtomRef] => [atom(a), atom(b)]),
    arrows: g.arrows?.map((id) => prefix + id),
  });
  return {
    primary: f.primary ? group(f.primary) : undefined,
    supporting: f.supporting?.map(group),
  };
}
export async function prepareFigure(
  library: Library,
  reference: FigureReference,
  options: {
    toolkit: ChemistryToolkit;
    fonts: FigureFontResolver;
    style: FigureStyle;
  },
): Promise<FigureGeometry> {
  const ctx = createFigureScene(options.style, options.fonts);
  const { element, label, token } = ctx;
  const stroke = (
    node: FigureNode,
    color = "var(--chemical-ink)",
    width = "var(--chemical-line)",
  ) => {
    ctx.setStyle(node, "stroke", color);
    ctx.setStyle(node, "strokeWidth", width);
    ctx.setStyle(node, "fill", "none");
    return node;
  };
  const routeElectronArrow = (
    from: Point,
    to: Point,
    B: number,
    parent: FigureGroup,
    clearance: Parameters<typeof routeGeometryArrow>[5],
    bend?: "left" | "right",
    directions?: Parameters<typeof routeGeometryArrow>[7],
  ) =>
    routeGeometryArrow(from, to, B, parent, ctx, clearance, bend, directions);
  const entry = library[reference.ref];
  if (!entry) throw new Error(`Unknown figure ${reference.ref}`);
  const figureNumbers: Record<string, string[]> = {};
  const numbering = (
    reaction: import("../../../shared/chemical-library/types.ts").Reaction,
    prefix = "",
  ) => {
    for (const p of [...reaction.reactants, ...reaction.products])
      if (p.number !== undefined || p.name)
        figureNumbers[prefix + p.id] = figureLabelLines(p.number, p.name);
  };
  if (entry.kind === "reaction") numbering(entry);
  if (entry.kind === "route")
    for (const step of entry.steps) {
      const reaction = library[step.reaction];
      if (reaction?.kind === "reaction") numbering(reaction, step.id + "/");
    }
  const svg = element("g", {
    role: entry.kind === "reaction" || entry.kind === "route" ? "group" : "img",
    "aria-label": entry.title,
    "data-figure": entry.id,
  });
  if (entry.kind === "image" || entry.kind === "process")
    throw new Error(`Expected a chemical figure: ${entry.id}`);
  const B = token("--chemical-bond");
  const toolkit = options.toolkit;
  const atomPoints: Record<string, Point> = {};
  let width = 0,
    height = 0;
  async function molecule(
    c: Compound,
    layout: CompoundLayout,
    id: string,
    at: Point,
    rotate = 0,
    mirror = false,
    focus?: Focus,
    parent: FigureGroup = svg,
    bracket?: boolean | "ts",
  ) {
    validateCompound(toolkit, c);
    const coords = placedCoordinates(toolkit, c, layout, rotate, mirror);
    const mol = drawingMolecule(toolkit, c, coords, layout, rotate, mirror);
    let depiction = mol;
    try {
      const graph = graphOf(mol),
        groups = compoundAbbreviations(toolkit, c, layout),
        folded = new Set(groups.flatMap((g) => g.atoms)),
        hiddenBonds = new Set(groups.flatMap((g) => g.bonds));
      const drawn = abbreviatedDrawing(toolkit, mol, hiddenBonds);
      depiction = drawn.mol;
      const atomLabels: Record<number, string> = {};
      for (const g of groups) {
        for (const i of g.atoms) atomLabels[i] = "";
        const root = coords[g.atoms[0]],
          outside = coords[g.attachment];
        atomLabels[g.atoms[0]] = abbreviationLabel(
          g.name,
          outside.x - root.x > 0.2 / 1.5,
          (graph.atoms[g.attachment].z ?? 6) === 6,
        );
      }
      // Spell small, separate methyl fragments using the existing Me label.
      // Their atom positions and semantic arrow anchors remain unchanged.
      if (graph.atoms.length > 2 && layout.methylLabels === undefined) {
        const neighbours = graph.atoms.map((): number[] => []);
        for (const {
          atoms: [a, b],
        } of graph.bonds) {
          neighbours[a].push(b);
          neighbours[b].push(a);
        }
        for (const [i, atom] of graph.atoms.entries()) {
          if (
            (atom.z ?? 6) !== 6 ||
            atom.impHs !== 3 ||
            atom.chg ||
            atom.isotope ||
            neighbours[i].length !== 1 ||
            folded.has(i)
          )
            continue;
          const j = neighbours[i][0];
          if (
            neighbours[j].length === 1 &&
            !graph.atoms[j].chg &&
            !folded.has(j)
          )
            atomLabels[i] = "Me";
        }
      }
      if (layout.compact) {
        for (const i of graph.atoms.keys()) atomLabels[i] = "";
        atomLabels[c.atomIds.indexOf(layout.compact.atom)] =
          layout.compact.text;
      }
      for (const id of layout.methylLabels ?? [])
        atomLabels[c.atomIds.indexOf(id)] = "Me";
      for (const [i, atom] of graph.atoms.entries()) {
        if (!atom.chg || atomLabels[i]) continue;
        const symbol =
          "* H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(
            " ",
          )[atom.z ?? 6];
        if (!symbol) continue;
        const h = atom.impHs
          ? `H${atom.impHs > 1 ? `<sub>${atom.impHs}</sub>` : ""}`
          : "";
        const isolated = !graph.bonds.some((b) => b.atoms.includes(i));
        atomLabels[i] =
          isolated && [8, 16].includes(atom.z ?? 6) ? h + symbol : symbol + h;
      }
      for (const t of c.template ?? [])
        atomLabels[c.atomIds.indexOf(t.atom)] = t.label;
      const xs = coords.map((p) => p.x),
        ys = coords.map((p) => p.y);
      const draw = (
        count: number,
        handle = depiction,
        atomNotes = false,
        indices?: number[],
      ) =>
        nativeDepictionGeometry(
          handle.get_svg_with_highlights(
            JSON.stringify({
              width: Math.ceil((Math.max(...xs) - Math.min(...xs)) * B + 100),
              height: Math.ceil((Math.max(...ys) - Math.min(...ys)) * B + 100),
              scalingFactor: B / 1.5,
              fixedBondLength: B / 1.5,
              bondLineWidth: token("--chemical-line"),
              scaleBondWidth: false,
              additionalAtomLabelPadding: 0.066,
              fixedFontSize: token("--chemical-font"),
              noFreetype: false,
              fontFile: "BuiltinRobotoRegular",
              atomColourPalette: "bw",
              atomLabelDeuteriumTritium: true,
              addStereoAnnotation: atomNotes
                ? false
                : (layout.stereoAnnotations ?? false),
              annotationFontScale: atomNotes
                ? token("--chemical-atom-note-scale")
                : 0.65,
              atomLabels: indices
                ? Object.fromEntries(
                    indices.flatMap((original, i) =>
                      atomLabels[original] === undefined
                        ? []
                        : [[i, atomLabels[original]]],
                    ),
                  )
                : atomLabels,
              atoms: Array.from({ length: count }, (_, i) => i),
              bonds: [],
              highlightRadius: 0.1,
              atomHighlightsAreCircles: true,
              prepareMolsBeforeDrawing: true,
              addChiralHs: true,
              useMolBlockWedging: !!layout.wedgeBonds?.length,
              wedgeBonds: !layout.wedgeBonds?.length,
            }),
          ),
        );
      let doc = draw(graph.atoms.length);
      // Native preparation adds drawing-only H atoms for fused stereocentres.
      // Include their highlight centres so bond-size diagnostics measure them too.
      const count = Math.max(
        graph.atoms.length,
        ...[
          ...ctx.nodes(doc, (node) => node.attributes.class !== undefined),
        ].flatMap((e) =>
          [...(ctx.get(e, "class") ?? "").matchAll(/atom-(\d+)/g)].map(
            (m) => Number(m[1]) + 1,
          ),
        ),
      );
      if (count > graph.atoms.length) doc = draw(count);
      const positions = Array.from({ length: count }, (_, i) => {
        const e = ctx
          .nodes(doc)
          .filter((node) => node.kind === "ellipse")
          .filter((node) =>
            (node.attributes.class ?? "").split(" ").includes(`atom-${i}`),
          )[0];
        if (!e) throw new Error(`${c.id}: missing atom position ${i}`);
        return {
          x: Number(ctx.get(e, "cx")),
          y: Number(ctx.get(e, "cy")),
        };
      });
      const shift = {
        x: at.x * B + coords[0].x * B - positions[0].x,
        y: at.y * B + coords[0].y * B - positions[0].y,
      };
      const g = element("g", {
        transform: `translate(${shift.x} ${shift.y})`,
        "data-molecule": id,
        "data-compound": c.id,
      });
      const nativeBonds = new Map<number, [number, number]>();
      for (const e of ctx
        .nodes(doc)
        .filter((node) => node.kind === "path")
        .filter((node) => (node.attributes.class ?? "").includes("bond-"))) {
        const cls = ctx.get(e, "class")!;
        const i = Number(/bond-(\d+)/.exec(cls)![1]);
        const atoms = [...cls.matchAll(/atom-(\d+)/g)].map((m) => Number(m[1]));
        if (i >= drawn.bonds.length && atoms.length === 2)
          nativeBonds.set(i, [atoms[0], atoms[1]]);
      }
      ctx.setData(
        g,
        "bondLengths",
        JSON.stringify(
          [
            ...graph.bonds
              .filter((_, i) => !hiddenBonds.has(i))
              .map(({ atoms }) => atoms),
            ...nativeBonds.values(),
          ].map(([a, b]) =>
            Math.hypot(
              positions[a].x - positions[b].x,
              positions[a].y - positions[b].y,
            ),
          ),
        ),
      );
      ctx.append(parent, g);
      const f = focusKeys(focus);
      const ink = [f.atoms, f.bonds, f.support, f.supportBonds].some(
        (set) => set.size,
      )
        ? "var(--chemical-muted)"
        : "var(--chemical-ink)";
      for (const node of [...doc.children]) {
        if (node.kind === "rect" || node.kind === "ellipse") continue;
        const cls = ctx.get(node, "class") ?? "";
        const bi = /bond-(\d+)/.exec(cls),
          ai = [...cls.matchAll(/atom-(\d+)/g)].map((m) => Number(m[1]));
        if (
          bi &&
          (layout.compact || hiddenBonds.has(drawn.bonds[Number(bi[1])]))
        )
          continue;
        if (
          !bi &&
          layout.compact &&
          ai.some((i) => c.atomIds[i] !== layout.compact!.atom)
        )
          continue;
        if (
          !bi &&
          ai.some((i) => folded.has(i) && !groups.some((g) => g.atoms[0] === i))
        )
          continue;
        const e = node;
        if (e.kind === "path" && !bi && !ai.length) continue;
        if (e.kind === "path" && bi) {
          const drawnIndex = Number(bi[1]);
          const index =
            drawn.bonds[drawnIndex] ??
            graph.bonds.length + drawnIndex - drawn.bonds.length;
          const ids = ai.map((i) =>
            key({
              molecule: id,
              atom: c.atomIds[i] ?? `hydrogen-${i - c.atomIds.length}`,
            }),
          );
          const primary = f.bonds.has([...ids].sort().join("/"));
          const supporting = f.supportBonds.has([...ids].sort().join("/"));
          ctx.setStyle(
            e,
            "stroke",
            primary
              ? "var(--chemical-focus)"
              : supporting
                ? "var(--chemical-support)"
                : ink,
          );
          ctx.setStyle(
            e,
            "strokeWidth",
            primary
              ? "var(--chemical-focus-line)"
              : supporting
                ? "var(--chemical-support-line)"
                : "var(--chemical-line)",
          );
          if (e.paint.fill && e.paint.fill !== "none") {
            // RDKit solid wedges are filled triangles. An added miter stroke
            // extends their narrow tip beyond the stereocenter.
            ctx.setStyle(e, "fill", e.paint.stroke);
            ctx.setStyle(e, "stroke", "none");
            ctx.setStyle(e, "strokeWidth", "0");
          }
          ctx.set(e, "data-bond", `${id}:b${index}`);
          ctx.set(e, "data-atoms", ids.join(" "));
        } else if (e.kind === "text" || (e.kind === "path" && ai.length)) {
          const aid = ai.length
            ? key({
                molecule: id,
                atom:
                  c.atomIds[ai[0]] ?? `hydrogen-${ai[0] - c.atomIds.length}`,
              })
            : "";
          ctx.set(e, "data-label", aid || `${id}:annotation`);
          if (atomLabels[ai[0]])
            ctx.set(e, "data-label-text", atomLabels[ai[0]]);
          if (groups.some((group) => group.atoms[0] === ai[0]))
            ctx.set(e, "data-abbreviation", aid);
          if (
            graph.atoms[ai[0]]?.chg &&
            /^[+−-]$/.test(e.kind === "text" ? e.text : "")
          ) {
            ctx.set(e, "data-label", `${aid}:charge`);
            ctx.set(e, "data-charge-owner", aid);
          }
          ctx.setStyle(
            e,
            "fill",
            f.atoms.has(aid)
              ? "var(--chemical-focus)"
              : f.support.has(aid)
                ? "var(--chemical-support)"
                : ink,
          );
        }
        ctx.append(g, e);
      }
      spaceChiralHydrogens(
        g,
        positions,
        graph.atoms.length,
        nativeBonds,
        graph.bonds,
        ctx,
      );
      const localPoints: Record<string, Point> = {};
      positions.forEach((p, i) => {
        const atom = key({
          molecule: id,
          atom: c.atomIds[i] ?? `hydrogen-${i - c.atomIds.length}`,
        });
        localPoints[atom] = p;
        atomPoints[atom] = plus(p, shift);
      });
      ctx.setData(g, "atomPoints", JSON.stringify(localPoints));
      const rings: number[][] =
        JSON.parse(mol.get_json()).molecules[0].extensions?.find(
          (extension: { name: string }) =>
            extension.name === "rdkitRepresentation",
        )?.atomRings ?? [];
      ctx.setData(
        g,
        "atomRings",
        JSON.stringify(
          rings
            .filter((ring) => ring.every((atom) => !folded.has(atom)))
            .map((ring) =>
              ring.map((atom) => key({ molecule: id, atom: c.atomIds[atom] })),
            ),
        ),
      );
      if (layout.compact) {
        const compact = layout.compact;
        const idx = c.atomIds.indexOf(layout.compact.atom);
        const glyphs = [
          ...ctx.nodes(
            g,
            (node) =>
              ctx.data(node, "label") ===
              key({ molecule: id, atom: compact.atom }),
          ),
        ];
        const glyph =
          layout.compact.anchor === "last" ? glyphs.at(-1)! : glyphs[0];
        const box = ctx.box(glyph),
          p = positions[idx];
        const dx = p.x - box.x - box.width / 2,
          dy = p.y - box.y - box.height / 2;
        for (const e of glyphs)
          ctx.set(e, "transform", `translate(${dx} ${dy})`);
      }
      for (const [i, atom] of graph.atoms.entries()) {
        const group = groups.find((g) => g.atoms[0] === i);
        const chargeValue = group
          ? group.atoms.reduce((sum, a) => sum + (graph.atoms[a].chg ?? 0), 0)
          : atom.chg;
        if (!chargeValue || (folded.has(i) && !group)) continue;
        const aid = key({ molecule: id, atom: c.atomIds[i] });
        const labels = [
          ...ctx.nodes(g, (node) => ctx.data(node, "label") === aid),
        ];
        let boxes = labels.map((e) => inkBox(e, g, ctx));
        if (groups.some((g) => g.name === "PPh3" && g.atoms[0] === i)) {
          boxes.sort(
            (a, b) =>
              Math.hypot(
                a.x + a.width / 2 - positions[i].x,
                a.y + a.height / 2 - positions[i].y,
              ) -
              Math.hypot(
                b.x + b.width / 2 - positions[i].x,
                b.y + b.height / 2 - positions[i].y,
              ),
          );
          boxes = boxes.slice(0, 1);
        }
        const left = Math.min(...boxes.map((b) => b.x)),
          right = Math.max(...boxes.map((b) => b.x + b.width));
        const top = Math.min(...boxes.map((b) => b.y)),
          bottom = Math.max(...boxes.map((b) => b.y + b.height));
        const chargeAngle = layout.chargeAngles?.[c.atomIds[i]];
        const bondAngles = graph.bonds
          .flatMap(({ atoms: [a, b] }, index) => {
            if (hiddenBonds.has(index) || (a !== i && b !== i)) return [];
            const p = positions[a === i ? b : a],
              origin = positions[i];
            return [
              (Math.atan2(p.y - origin.y, p.x - origin.x) + 2 * Math.PI) %
                (2 * Math.PI),
            ];
          })
          .sort((a, b) => a - b);
        const gaps = bondAngles
          .map((a, k) => {
            const gap = (bondAngles[k + 1] ?? bondAngles[0] + 2 * Math.PI) - a;
            const middle = a + gap / 2;
            return { gap, middle };
          })
          .sort((a, b) =>
            Math.abs(a.gap - b.gap) > 1e-6
              ? b.gap - a.gap
              : Math.cos(b.middle + Math.PI / 4) -
                Math.cos(a.middle + Math.PI / 4),
          );
        const r = B * 0.19;
        const centerAt = (angle: number) => {
          const ux = Math.cos(angle),
            uy = Math.sin(angle);
          const distance =
            Math.min(
              Math.abs(ux) < 1e-5
                ? Infinity
                : (right - left) / 2 / Math.abs(ux),
              Math.abs(uy) < 1e-5
                ? Infinity
                : (bottom - top) / 2 / Math.abs(uy),
            ) +
            r +
            B * 0.09;
          return {
            x: (left + right) / 2 + ux * distance,
            y: (top + bottom) / 2 + uy * distance,
          };
        };
        const angles =
          chargeAngle === undefined
            ? [
                -Math.PI / 4,
                ...gaps.map((g) => g.middle),
                ...Array.from({ length: 24 }, (_, i) => (i * Math.PI) / 12),
              ]
            : [radians(chargeAngle)];
        const otherLabels = labelBoxes(g, ctx),
          traces = bondTraces(g, ctx);
        const candidates = angles.map((angle) => {
          const center = centerAt(angle);
          const marker = rectangle(center.x - r, center.y - r, 2 * r, 2 * r);
          const combined = rectangle(
            Math.min(left, marker.left),
            Math.min(top, marker.top),
            Math.max(right, marker.right) - Math.min(left, marker.left),
            Math.max(bottom, marker.bottom) - Math.min(top, marker.top),
          );
          let cost = 0;
          for (const [other, box] of otherLabels)
            if (other !== aid) cost += overlap(combined, box);
          for (const trace of traces)
            cost += trace.points.filter((p) => contains(marker, p)).length;
          return { center, cost };
        });
        candidates.sort((a, b) => a.cost - b.cost);
        const { center } = candidates[0];
        const charge = element("g", {
          "data-label": `${aid}:charge`,
          "data-charge-owner": aid,
        });
        const color = f.atoms.has(aid)
          ? "var(--chemical-focus)"
          : "var(--chemical-ink)";
        ctx.append(
          charge,
          stroke(element("circle", { cx: center.x, cy: center.y, r }), color),
        );
        const arm = r * 0.5;
        ctx.append(
          charge,
          stroke(
            element("path", {
              d: `M${center.x - arm} ${center.y}H${center.x + arm}${chargeValue > 0 ? `M${center.x} ${center.y - arm}V${center.y + arm}` : ""}`,
            }),
            color,
          ),
        );
        ctx.append(g, charge);
      }
      for (const [atom, number] of Object.entries(layout.atomNumbers ?? {})) {
        const index = c.atomIds.indexOf(atom);
        if (groups.some((group) => group.atoms.slice(1).includes(index)))
          continue;
        const { mol: annotated, indices } = atomNumberDrawing(
          toolkit,
          depiction,
          index,
          number,
        );
        try {
          const notes = draw(
            annotated.get_num_atoms(),
            annotated,
            true,
            indices,
          );
          const origin = ctx.nodes(
            notes,
            (node) =>
              node.kind === "ellipse" &&
              (node.attributes.class ?? "").split(" ").includes("atom-0"),
          )[0];
          const mark = element("g", {
            transform: `translate(${positions[indices[0]].x - Number(ctx.get(origin, "cx"))} ${positions[indices[0]].y - Number(ctx.get(origin, "cy"))})`,
            "data-label": `${id}:atom-number:${atom}`,
            "data-atom-number": number,
          });
          for (const path of ctx.nodes(
            notes,
            (node) =>
              node.kind === "path" &&
              (node.attributes.class ?? "").split(" ").includes("note"),
          ))
            ctx.append(mark, path);
          ctx.append(g, mark);
          spaceAtomNumber(mark, g, positions[index], ctx);
        } finally {
          annotated.delete();
        }
      }
      for (const [index, unit] of (layout.repeatUnits ?? []).entries()) {
        const inside = new Set(
          unit.atoms.map((atom) => c.atomIds.indexOf(atom)),
        );
        const center = [...inside].reduce(
          (sum, i) => ({
            x: sum.x + positions[i].x / inside.size,
            y: sum.y + positions[i].y / inside.size,
          }),
          { x: 0, y: 0 },
        );
        let last: Point | undefined;
        for (const {
          atoms: [a, b],
        } of graph.bonds) {
          if (inside.has(a) === inside.has(b)) continue;
          const p = positions[a],
            q = positions[b],
            mx = (p.x + q.x) / 2,
            my = (p.y + q.y) / 2,
            dx = q.x - p.x,
            dy = q.y - p.y,
            length = Math.hypot(dx, dy),
            ox = (-dy / length) * B * 0.42,
            oy = (dx / length) * B * 0.42,
            sign = (center.x - mx) * dx + (center.y - my) * dy > 0 ? 1 : -1,
            tx = ((sign * dx) / length) * B * 0.16,
            ty = ((sign * dy) / length) * B * 0.16;
          ctx.append(
            g,
            stroke(
              element("path", {
                d: `M${mx - ox + tx} ${my - oy + ty}L${mx - ox} ${my - oy}L${mx + ox} ${my + oy}L${mx + ox + tx} ${my + oy + ty}`,
                "data-repeat-bracket": `${id}:${index}`,
              }),
            ),
          );
          const low =
            oy > 0 ? { x: mx + ox, y: my + oy } : { x: mx - ox, y: my - oy };
          if (!last || low.x > last.x) last = { x: low.x - tx * 2.2, y: low.y };
        }
        if (last) {
          const mark = label(
            { x: last.x, y: last.y + token("--chemical-font") * 0.85 * 0.75 },
            unit.label,
            `${token("--chemical-font") * 0.85}px`,
          );
          ctx.setData(mark, "label", `${id}:repeat:${index}`);
          ctx.append(g, mark);
        }
      }
      if (bracket) {
        const bounds = ctx.box(g),
          pad = B * 0.3,
          arm = B * 0.4,
          left = bounds.x - pad * 2,
          right = bounds.x + bounds.width + pad * 2,
          top = bounds.y - pad,
          bottom = bounds.y + bounds.height + pad;
        ctx.append(
          g,
          stroke(
            element("path", {
              d: `M${left + arm} ${top}H${left}V${bottom}H${left + arm} M${right - arm} ${top}H${right}V${bottom}H${right - arm}`,
              "data-bracket": id,
            }),
          ),
        );
        if (bracket === "ts") {
          const mark = label(
            { x: right + B * 0.3, y: top - B * 0.15 },
            "‡",
            "var(--chemical-script-font)",
          );
          ctx.setData(mark, "label", `${id}:transition-state`);
          ctx.append(g, mark);
        }
      }
      const local = reference.numbers?.[id];
      const numbers = local ? figureLabelLines(local) : figureNumbers[id];
      if (numbers?.length) {
        const bounds = ctx.box(g);
        const group = element("g", { "data-number": `${id}:number` });
        ctx.append(g, group);
        let bottom = bounds.y + bounds.height + B * 0.55;
        for (const [index, number] of numbers.entries()) {
          const e = label(
            {
              x: bounds.x + bounds.width / 2,
              y: bottom,
            },
            number,
            "var(--chemical-number-font)",
          );
          ctx.set(e, "data-label", `${id}:number:${index}`);
          ctx.append(group, e);
          bottom += ctx.box(e).height + B * 0.15;
        }
      }
    } finally {
      if (depiction !== mol) depiction.delete();
      mol.delete();
    }
  }
  async function scene(
    s: Scene,
    prefix = "",
    parent: FigureGroup = svg,
    override?: Focus,
    hidden = new Set<string>(),
  ) {
    const f = override ?? prefixedFocus(s.focus, prefix);
    validateSceneChemistry(toolkit, library, s, entry.id);
    if (override) {
      const group = (g: NonNullable<Focus["primary"]>) => ({
        atoms: g.atoms
          ?.filter((a) => a.molecule.startsWith(prefix))
          .map((a) => ({ ...a, molecule: a.molecule.slice(prefix.length) })),
        bonds: g.bonds
          ?.filter((pair) => pair.every((a) => a.molecule.startsWith(prefix)))
          .map(
            (pair) =>
              pair.map((a) => ({
                ...a,
                molecule: a.molecule.slice(prefix.length),
              })) as [AtomRef, AtomRef],
          ),
      });
      validateSceneChemistry(
        toolkit,
        library,
        {
          ...s,
          focus: {
            primary: override.primary && group(override.primary),
            supporting: override.supporting?.map(group),
          },
        },
        entry.id,
      );
    }
    const positions = new Map<string, Point>();
    for (const p of s.molecules) {
      const c = library[p.compound];
      if (c?.kind !== "compound")
        throw new Error(`Missing compound ${p.compound}`);
      const layout = p.variant ? c.variants?.[p.variant] : c.layout;
      if (!layout) throw new Error(`Missing variant ${p.variant}`);
      await molecule(
        c,
        layout,
        prefix + p.id,
        p.at,
        p.rotate,
        p.mirror,
        f,
        parent,
        p.bracket,
      );
    }
    const atom = (a: AtomRef) => {
      const p =
        atomPoints[key({ molecule: prefix + a.molecule, atom: a.atom })];
      if (!p) throw new Error(`Unknown atom ${key(a)}`);
      return p;
    };
    const glyphBoxes = (at: AtomRef) => {
      const id = key({ molecule: prefix + at.molecule, atom: at.atom });
      return [
        ...ctx.nodes(parent, (node) => ctx.data(node, "label") === id),
      ].map((e) => {
        const b = ctx.box(e),
          m = ctx.relativeMatrix(e, parent);
        const p = transformPoint({ x: b.x, y: b.y }, m),
          q = transformPoint({ x: b.x + b.width, y: b.y + b.height }, m);
        return { left: p.x, top: p.y, right: q.x, bottom: q.y };
      });
    };
    const labelClearance = (at: AtomRef, angle: number, gap = B * 0.1) => {
      const origin = atom(at),
        direction = toward(angle, 1);
      let distance = gap;
      for (const box of glyphBoxes(at)) {
        let enter = -Infinity,
          exit = Infinity;
        for (const [start, delta, min, max] of [
          [origin.x, direction.x, box.left, box.right],
          [origin.y, direction.y, box.top, box.bottom],
        ]) {
          if (Math.abs(delta) < 1e-8) {
            if (start < min || start > max) {
              enter = Infinity;
              break;
            }
          } else {
            const a = (min - start) / delta,
              b = (max - start) / delta;
            enter = Math.max(enter, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
          }
        }
        if (exit >= Math.max(enter, 0))
          distance = Math.max(distance, exit + gap);
      }
      return distance;
    };
    const location = (a: Anchor): Point => {
      if (a.kind === "lonePair")
        return atom(s.labels!.find((l) => l.id === a.label)!.at);
      if ("at" in a) return atom(a.at);
      const p = atom(a.atoms[0]),
        q = atom(a.atoms[1]);
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    };
    for (const l of s.labels ?? []) {
      if (hidden.has(l.at.molecule)) continue;
      if (l.kind === "radical") {
        // Reuse RDKit's radical dot when it is already part of the native label.
        const dots = glyphBoxes(l.at).filter(
          (b) => Math.max(b.right - b.left, b.bottom - b.top) <= B * 0.1,
        );
        if (dots.length) {
          const b = dots[0],
            p = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
          positions.set(l.id, p);
          positions.set("radical:" + key(l.at), p);
          continue;
        }
      }
      let p = plus(atom(l.at), mul(l.offset, B));
      let dotAngle = l.angle ?? 0;
      if (
        (l.kind === "lonePair" || l.kind === "radical") &&
        !l.offset.x &&
        !l.offset.y
      ) {
        const arrow = s.arrows?.find((a) =>
          a.from.kind === "lonePair"
            ? a.from.label === l.id
            : a.from.kind === "radical" && key(a.from.at) === key(l.at),
        );
        const origin = atom(l.at),
          target = arrow
            ? location(arrow.to)
            : { x: origin.x + B, y: origin.y };
        const angle =
          (Math.atan2(target.y - origin.y, target.x - origin.x) * 180) /
          Math.PI;
        p = plus(origin, toward(angle, labelClearance(l.at, angle, B * 0.075)));
        dotAngle = angle + 90;
        if (l.kind === "lonePair") {
          const radius = Math.hypot(p.x - origin.x, p.y - origin.y),
            labels = [...labelBoxes(parent, ctx).values()],
            bonds = ctx
              .nodes(parent)
              .filter((node) => node.kind === "path")
              .filter((node) => ctx.data(node, "bond") !== undefined)
              .map((node) => {
                const matrix = ctx.relativeMatrix(node, parent);
                return {
                  contours: pathContours(node.d, matrix),
                  paint: node.paint,
                  scale: Math.hypot(matrix[0], matrix[1]),
                };
              });
          const clear = (degrees: number) => {
            const centre = plus(origin, toward(degrees, radius)),
              dx =
                B * 0.053 * Math.abs(Math.cos(radians(degrees + 90))) +
                B * 0.03,
              dy =
                B * 0.053 * Math.abs(Math.sin(radians(degrees + 90))) +
                B * 0.03,
              box = rectangle(centre.x - dx, centre.y - dy, 2 * dx, 2 * dy);
            return (
              !labels.some(
                (other) =>
                  box.left <= other.right &&
                  box.right >= other.left &&
                  box.top <= other.bottom &&
                  box.bottom >= other.top,
              ) &&
              !bonds.some((bond) =>
                inkIntersectsBox(
                  bond.contours,
                  box,
                  bond.paint.stroke === "none"
                    ? 0
                    : bond.paint.strokeWidth * bond.scale,
                  bond.paint.fill !== "none",
                ),
              )
            );
          };
          if (!clear(angle)) {
            search: for (let turn = 10; turn <= 180; turn += 10)
              for (const sign of [1, -1]) {
                const candidate = angle + sign * turn;
                if (!clear(candidate)) continue;
                p = plus(origin, toward(candidate, radius));
                dotAngle = candidate + 90;
                break search;
              }
          }
        }
      }
      // Formal graph charges own their displayed circled signs. A scene
      // declaration names the existing anchor without redrawing it.
      if (l.kind === "charge") {
        const native = ctx.nodes(
          parent,
          (node) =>
            ctx.data(node, "chargeOwner") ===
            key({ molecule: prefix + l.at.molecule, atom: l.at.atom }),
        )[0];
        if (!native) throw new Error(`No displayed charge at ${key(l.at)}`);
        const box = ctx.box(native);
        const matrix = ctx.relativeMatrix(native, parent);
        positions.set(
          l.id,
          transformPoint(
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            matrix,
          ),
        );
        continue;
      }
      positions.set(l.id, p);
      if (l.kind === "radical") positions.set("radical:" + key(l.at), p);
      const g = element("g", {
        "data-label": prefix + l.id,
        "data-owner": key(l.at),
      });
      ctx.append(parent, g);
      if (l.kind === "lonePair" || l.kind === "radical") {
        for (const dx of l.kind === "radical" ? [0] : [-B * 0.053, B * 0.053])
          ctx.append(
            g,
            element("circle", {
              cx: p.x + dx * Math.cos(radians(dotAngle)),
              cy: p.y + dx * Math.sin(radians(dotAngle)),
              r: B * 0.03,
              fill: "var(--chemical-ink)",
            }),
          );
      } else ctx.append(g, label(p, l.text ?? ""));
    }
    function anchor(a: Anchor): Point {
      if (a.kind === "atom") return atom(a.at);
      if (a.kind === "radical") return positions.get("radical:" + key(a.at))!;
      if (a.kind === "charge") {
        const declared = s.labels?.find(
          (l) =>
            l.kind === "charge" &&
            l.at.molecule === a.at.molecule &&
            l.at.atom === a.at.atom,
        );
        if (declared) return positions.get(declared.id)!;
        const owner = key({
          molecule: prefix + a.at.molecule,
          atom: a.at.atom,
        });
        const charge = ctx
          .nodes(parent, (node) => ctx.data(node, "chargeOwner") === owner)
          .filter((node) => node.kind === "group")[0];
        if (!charge) throw new Error(`No displayed charge at ${owner}`);
        const box = ctx.box(charge),
          matrix = ctx.relativeMatrix(charge, parent);
        return transformPoint(
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          matrix,
        );
      }
      if (a.kind === "lonePair") {
        const p = positions.get(a.label);
        if (!p) throw new Error(`Unknown lone pair ${a.label}`);
        return p;
      }
      const p = atom(a.atoms[0]),
        q = atom(a.atoms[1]);
      if (a.kind === "bond" || a.kind === "pi") {
        if (a.atoms[0].molecule !== a.atoms[1].molecule)
          throw new Error("Bond anchor crosses molecules");
        const placement = s.molecules.find(
          (p) => p.id === a.atoms[0].molecule,
        )!;
        const c = library[placement.compound];
        if (c?.kind !== "compound") throw new Error("Missing anchor compound");
        const m = toolkit.get_mol(
          c.smiles,
          JSON.stringify({ removeHs: false }),
        )!;
        try {
          if (
            !graphOf(m).bonds.some((b) =>
              b.atoms.every((i) =>
                a.atoms.some((a) => a.atom === c.atomIds[i]),
              ),
            )
          )
            throw new Error("Unknown bond anchor");
        } finally {
          m.delete();
        }
      }
      const fraction = a.fraction ?? 0.5;
      if (a.kind === "formingBond") {
        // The second atom is the acceptor. Clearance and the incoming tangent
        // place the tip just outside that atom, independent of donor distance.
        const d = Math.hypot(q.x - p.x, q.y - p.y),
          angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
        if (
          d <=
          labelClearance(a.atoms[0], angle) +
            labelClearance(a.atoms[1], angle + 180)
        )
          throw new Error("New bond endpoints need more separation");
        return q;
      }
      if ((a.kind === "bond" && a.side) || a.kind === "pi") {
        const names = a.atoms.map((v) =>
          key({ molecule: prefix + v.molecule, atom: v.atom }),
        );
        const lines = [
          ...ctx
            .nodes(parent, (node) => ctx.data(node, "bond") !== undefined)
            .filter((node) => node.kind === "path"),
        ]
          .filter((el) =>
            names.every((name) =>
              (ctx.data(el, "atoms") ?? "").split(" ").includes(name),
            ),
          )
          .map((el) =>
            transformPoint(
              pathMetrics(el.d).pointAt(pathMetrics(el.d).length * fraction),
              ctx.relativeMatrix(el, parent),
            ),
          );
        const nx = -(q.y - p.y),
          ny = q.x - p.x;
        lines.sort(
          (aPoint, bPoint) =>
            (a.side ?? 1) *
            ((bPoint.x - aPoint.x) * nx + (bPoint.y - aPoint.y) * ny),
        );
        if (lines.length) return lines[0];
      }
      return {
        x: p.x + (q.x - p.x) * fraction,
        y: p.y + (q.y - p.y) * fraction,
      };
    }
    const focused = focusKeys(f);
    for (const authored of s.arrows ?? []) {
      const refs = (a: Anchor): AtomRef[] =>
        a.kind === "lonePair"
          ? [s.labels!.find((l) => l.id === a.label)!.at]
          : "at" in a
            ? [a.at]
            : a.atoms;
      if (
        [...refs(authored.from), ...refs(authored.to)].every((a) =>
          hidden.has(a.molecule),
        )
      )
        continue;
      let from = authored.from;
      if (
        from.kind === "pi" &&
        from.side === undefined &&
        authored.to.kind === "bond"
      ) {
        const p = atom(from.atoms[0]),
          q = atom(from.atoms[1]),
          destination = location(authored.to);
        const projection =
          -(q.y - p.y) * (destination.x - (p.x + q.x) / 2) +
          (q.x - p.x) * (destination.y - (p.y + q.y) / 2);
        from = { ...from, side: projection < 0 ? -1 : 1 };
      }
      const a = { ...authored, from };
      const electrons =
        a.from.kind === "radical" || a.to.kind === "radical" ? 1 : a.electrons;
      let p0 = anchor(a.from),
        p3 = anchor(a.to);
      // Atom/charge anchors stop at their visible label boundary. Bond and lone-pair anchors retain their semantic position.
      const clearance = (anchor: Anchor, angle: number) => {
        if (anchor.kind === "charge") return B * 0.19 * Math.SQRT2 + 1;
        if (anchor.kind === "lonePair" || anchor.kind === "radical")
          return B * 0.1;
        const target =
          anchor.kind === "formingBond"
            ? anchor.atoms[1]
            : anchor.kind === "atom"
              ? anchor.at
              : undefined;
        if (!target)
          return anchor === a.to && anchor.kind === "bond" ? B * 0.12 : 0;
        return glyphBoxes(target).length
          ? labelClearance(target, angle, B * 0.1)
          : B * 0.18;
      };
      const tangentDirections = (
        end: Anchor,
        source: boolean,
      ): number[] | undefined => {
        if (
          end.kind === "bond" ||
          end.kind === "pi" ||
          end.kind === "formingBond"
        ) {
          const p = atom(end.atoms[0]),
            q = atom(end.atoms[1]);
          const theta = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
          if (end.kind === "formingBond")
            return [theta - 60, theta - 35, theta + 35, theta + 60];
          const normals =
            source && (end.kind === "pi" || end.side)
              ? [theta + (end.side ?? 1) * 90]
              : [theta - 90, theta + 90];
          const spread =
            Math.hypot(p3.x - p0.x, p3.y - p0.y) < B * 1.5
              ? [0, -25, 25, -45, 45]
              : [0];
          return normals.flatMap((angle) =>
            spread.map((offset) => angle + offset + (source ? 0 : 180)),
          );
        }
        return undefined;
      };
      const curve =
        a.curve ??
        routeElectronArrow(
          p0,
          p3,
          B,
          parent,
          (end, angle) => clearance(end === "from" ? a.from : a.to, angle),
          a.bend,
          {
            half: electrons === 1,
            from: tangentDirections(a.from, true),
            to: tangentDirections(a.to, false),
            compact:
              (a.from.kind === "bond" || a.from.kind === "pi") &&
              a.to.kind === "bond",
          },
        );
      const c1 = curve.control1
        ? mul(curve.control1, B)
        : toward(curve.exitAngle, curve.reach[0] * B);
      const c2 =
        a.to.kind === "atom" || a.to.kind === "formingBond"
          ? toward(
              curve.entryAngle + 180,
              (curve.control2
                ? Math.hypot(curve.control2.x, curve.control2.y)
                : curve.reach[1]) * B,
            )
          : curve.control2
            ? mul(curve.control2, B)
            : toward(curve.entryAngle + 180, curve.reach[1] * B);
      p0 = plus(
        p0,
        toward(curve.exitAngle, clearance(a.from, curve.exitAngle)),
      );
      p3 = plus(
        p3,
        toward(curve.entryAngle + 180, clearance(a.to, curve.entryAngle + 180)),
      );
      const p1 = plus(p0, c1),
        p2 = plus(p3, c2);
      const shape = solidArrow(p0, p3, B, [p1, p2], electrons === 1);
      const ink =
        s.comparison && a.tone === "comparison"
          ? "var(--chemical-comparison)"
          : focused.arrows.has(prefix + a.id)
            ? "var(--chemical-focus)"
            : focused.supportArrows.has(prefix + a.id)
              ? "var(--chemical-support)"
              : "var(--chemical-ink)";
      const path = stroke(
        element("path", {
          d: shape.shaft,
          "data-curve-points": JSON.stringify(shape.points),
          "stroke-linecap": "butt",
          "data-electron-arrow": prefix + a.id,
          "data-prefix": prefix,
          "data-from": JSON.stringify(a.from),
          "data-to": JSON.stringify(a.to),
          "data-electrons": electrons,
        }),
        ink,
        "var(--chemical-arrow-line)",
      );
      ctx.append(
        parent,
        path,
        element("path", {
          d: shape.head,
          "data-head-points": JSON.stringify(shape.vertices),
          fill: ink,
          stroke: "none",
          "data-arrow-head": prefix + a.id,
        }),
      );
    }
    for (const a of s.reactionArrows ?? []) {
      if (a.kind === "none") continue;
      const p = mul(a.from, B),
        q = mul(a.to, B);
      const ink =
        s.comparison && a.tone === "comparison"
          ? "var(--chemical-comparison)"
          : "var(--chemical-ink)";
      const draw = (
        start: Point,
        end: Point,
        controls?: Point[],
        half = false,
      ) => {
        const shape = solidArrow(start, end, B, controls, half);
        ctx.append(
          parent,
          stroke(
            element("path", {
              d: shape.shaft,
              "data-curve-points": JSON.stringify(shape.points),
              "stroke-linecap": "butt",
              "data-reaction-arrow": prefix + a.id,
            }),
            ink,
          ),
          element("path", {
            d: shape.head,
            fill: ink,
            stroke: "none",
            "data-head-points": JSON.stringify(shape.vertices),
            "data-reaction-head": prefix + a.id,
          }),
        );
      };
      const theta = Math.atan2(q.y - p.y, q.x - p.x);
      if (a.kind === "equilibrium") {
        const off = {
          x: Math.sin(theta) * B * 0.08,
          y: -Math.cos(theta) * B * 0.08,
        };
        for (const direction of [1, -1]) {
          const start = direction === 1 ? p : q,
            end = direction === 1 ? q : p;
          const p0 = plus(start, mul(off, direction)),
            p1 = plus(end, mul(off, direction));
          draw(p0, p1, undefined, true);
        }
      } else if (a.kind === "retro") {
        const n = {
          x: -Math.sin(theta) * B * 0.1,
          y: Math.cos(theta) * B * 0.1,
        };
        const base = {
          x: q.x - Math.cos(theta) * B * 0.3,
          y: q.y - Math.sin(theta) * B * 0.3,
        };
        ctx.append(
          parent,
          stroke(
            element("path", {
              d: `M${p.x + n.x} ${p.y + n.y}L${base.x + n.x} ${base.y + n.y} M${p.x - n.x} ${p.y - n.y}L${base.x - n.x} ${base.y - n.y} M${base.x + 2 * n.x} ${base.y + 2 * n.y}L${q.x} ${q.y}L${base.x - 2 * n.x} ${base.y - 2 * n.y}`,
              "data-reaction-arrow": prefix + a.id,
            }),
            ink,
          ),
        );
      } else {
        draw(
          p,
          q,
          a.controls?.map((v) => mul(v, B)),
        );
        if (a.kind === "resonance") draw(q, p);
      }
      for (const [lines, sign] of [
        [a.above ?? [], -1],
        [a.below ?? [], 1],
      ] as const) {
        let previous: FigureRect | undefined;
        lines.forEach((text, i) => {
          const y = (p.y + q.y) / 2 + sign * B * 0.65;
          const e = label(
            {
              x: (p.x + q.x) / 2,
              y,
            },
            text,
            "var(--chemical-caption-font)",
          );
          if (previous) {
            const bounds = ctx.box(e);
            ctx.set(
              e,
              "y",
              y +
                (sign < 0
                  ? previous.y - B * 0.15 - bounds.y - bounds.height
                  : previous.y + previous.height + B * 0.15 - bounds.y),
            );
          }
          previous = ctx.box(e);
          ctx.setStyle(e, "fill", ink);
          ctx.setData(e, "label", prefix + a.id + ":" + sign + ":" + i);
          ctx.append(parent, e);
        });
      }
    }
    for (const [i, c] of (s.captions ?? []).entries()) {
      const e = label(
        mul(c.at, B),
        c.text,
        c.text === "+"
          ? "var(--chemical-plus-font)"
          : "var(--chemical-caption-font)",
        c.align ?? "middle",
      );
      ctx.setData(e, "label", prefix + "caption:" + i);
      if (s.comparison && c.tone === "comparison")
        ctx.setStyle(e, "fill", "var(--chemical-comparison)");
      ctx.append(parent, e);
    }
    for (const b of s.partialBonds ?? []) {
      const p = atom(b.atoms[0]),
        q = atom(b.atoms[1]);
      ctx.append(
        parent,
        stroke(
          element("path", {
            d: `M${p.x} ${p.y}L${q.x} ${q.y}`,
            "stroke-dasharray": "4 3",
            "data-partial-bond": "true",
          }),
        ),
      );
    }
    if (s.transitionState) {
      ctx.append(
        parent,
        stroke(
          element("path", {
            d: `M14 12H7V${s.height * B - 12}H14 M${s.width * B - 14} 12H${s.width * B - 7}V${s.height * B - 12}H${s.width * B - 14}`,
          }),
        ),
        label({ x: s.width * B - 10, y: 5 }, "‡"),
      );
    }
  }
  async function reaction(
    id: string,
    prefix = "",
    parent: FigureGroup = svg,
    view?: Route["steps"][number],
  ) {
    const source = library[id];
    if (source?.kind !== "reaction") throw new Error(`Missing reaction ${id}`);
    const r = view?.placements
      ? {
          ...source,
          reagents: view.reagents ?? source.reagents,
          conditions: view.conditions ?? source.conditions,
          reagentPosition: "above-arrow" as const,
          reactants: source.reactants.map((p) =>
            view.boxes?.includes(p.id)
              ? { ...p, position: "above-arrow" as const }
              : p,
          ),
          arrow: view.arrow ?? source.arrow,
          scene: {
            ...source.scene,
            molecules: source.scene.molecules.map((m) => ({
              ...m,
              at: view.placements![m.id] ?? m.at,
            })),
            captions: source.scene.captions?.filter((c) => c.text !== "+"),
          },
        }
      : source;
    const hidden = new Set(
      Object.entries(view?.display ?? {})
        .filter(([, display]) => display === "hidden")
        .map(([id]) => id),
    );
    await scene(r.scene, prefix, parent, reference.focus, hidden);
    const routePoints = [r.arrow.from, ...(r.arrow.via ?? []), r.arrow.to];
    const a = mul(routePoints.at(-2)!, B),
      b = mul(r.arrow.to, B);
    const overhead = [...r.reactants, ...r.products]
      .filter(
        (p) => p.position === "above-arrow" || p.position === "below-arrow",
      )
      .map((p) => {
        const group = ctx
          .nodes(parent, (node) => ctx.data(node, "molecule") === prefix + p.id)
          .filter((node) => node.kind === "group")[0]!;
        const box = ctx.box(group);
        const shift = group.transform;
        const bounds = {
          x: box.x + shift[4],
          y: box.y + shift[5],
          width: box.width,
          height: box.height,
        };
        const pad = B * 0.35;
        ctx.append(
          parent,
          stroke(
            element("path", {
              d: `M${bounds.x - pad} ${bounds.y - pad}H${bounds.x + bounds.width + pad}V${bounds.y + bounds.height + pad}H${bounds.x - pad}Z`,
              "data-overhead-box": prefix + p.id,
            }),
          ),
        );
        return {
          position: p.position,
          bounds: {
            x: bounds.x - pad,
            y: bounds.y - pad,
            width: bounds.width + 2 * pad,
            height: bounds.height + 2 * pad,
          },
        };
      });
    const arrowShape = solidArrow(a, b, B);
    await scene(
      {
        width: r.scene.width,
        height: r.scene.height,
        molecules: [],
        reactionArrows: [
          {
            id,
            from: { x: a.x / B, y: a.y / B },
            to: { x: b.x / B, y: b.y / B },
            kind: r.arrow.kind,
          },
        ],
      },
      prefix,
      parent,
    );
    if (routePoints.length > 2 && r.arrow.kind !== "none")
      ctx.append(
        parent,
        stroke(
          element("path", {
            d: routePoints
              .slice(0, -1)
              .map((p, i) => `${i ? "L" : "M"}${p.x * B} ${p.y * B}`)
              .join(""),
            "data-reaction-arrow": prefix + id,
          }),
        ),
      );
    for (const path of ctx.nodes(
      parent,
      (node) => ctx.data(node, "reactionArrow") === prefix + id,
    )) {
      ctx.setData(path, "reactionId", id);
      ctx.set(path, "role", "button");
      ctx.set(path, "tabindex", "0");
      ctx.set(path, "aria-label", r.title);
      ctx.set(path, "pointer-events", "bounding-box");
    }
    const center = (a.x + b.x) / 2;
    const reactants = r.reactants
      .filter((p) => !p.position || p.position === "inline")
      .map((p) => r.scene.molecules.find((m) => m.id === p.id)!);
    for (
      let i = 1;
      !view?.display && r.showPlus !== false && i < reactants.length;
      i++
    ) {
      const left = reactants[i - 1].at,
        right = reactants[i].at;
      const mark = label(
        mul(
          r.plusAt?.[i - 1] ?? {
            x: (left.x + right.x) / 2,
            y: (left.y + right.y) / 2,
          },
          B,
        ),
        "+",
        "var(--chemical-plus-font)",
      );
      ctx.set(mark, "data-label", `${prefix}${id}:plus:${i}`);
      ctx.append(parent, mark);
    }
    const textWidth = r.arrow.textWidth * B;
    const wrap = (lines: string[]) =>
      wrapFigureText(lines, textWidth, (text) =>
        ctx.textWidth(text, "var(--chemical-caption-font)"),
      );
    let verticalCursor = Math.max(
      Math.min(a.y, b.y) + B * 0.3,
      ...overhead.map((p) => p.bounds.y + p.bounds.height + B * 0.3),
    );
    const reagentsBelow = r.reagentPosition === "below-arrow";
    for (const [lines, sign] of [
      [reagentsBelow ? [] : wrap(r.reagents), -1],
      [[...(reagentsBelow ? wrap(r.reagents) : []), ...wrap(r.conditions)], 1],
    ] as const) {
      const occupied = overhead.filter(
        (p) => p.position === (sign < 0 ? "above-arrow" : "below-arrow"),
      );
      const edge =
        sign < 0
          ? Math.min(a.y, b.y, ...arrowShape.vertices.map((p) => p.y))
          : Math.max(
              a.y,
              b.y,
              ...arrowShape.vertices.map((p) => p.y),
              ...occupied.map((p) => p.bounds.y + p.bounds.height),
            );
      const gap = token("--chemical-caption-font") / 4;
      let cursor = edge;
      const vertical = Math.abs(a.y - b.y) > Math.abs(a.x - b.x);
      const upward = sign < 0 && !vertical;
      (upward ? [...lines].reverse() : lines).forEach((text, index) => {
        const i = upward ? lines.length - 1 - index : index;
        const e = label(
          { x: center, y: 0 },
          text,
          "var(--chemical-caption-font)",
        );
        ctx.set(e, "data-label", `${prefix}${id}:condition:${sign}:${i}`);
        ctx.append(parent, e);
        const bounds = ctx.box(e);
        const y =
          sign < 0
            ? cursor - gap - bounds.y - bounds.height
            : cursor + gap - bounds.y;
        if (vertical) {
          const side = r.arrow.side === "left" ? -1 : 1;
          ctx.set(e, "x", String(center + side * (B * 0.6 + bounds.width / 2)));
          ctx.set(e, "y", String(verticalCursor - bounds.y));
          verticalCursor += bounds.height + gap;
        } else ctx.set(e, "y", String(y));
        cursor = y + bounds.y + (sign > 0 ? bounds.height : 0);
      });
    }
    for (const p of [...r.reactants, ...r.products]) {
      if (p.position === "text" || p.position === "none") continue;
      const parts = [
        p.equivalents !== undefined ? `${p.equivalents} eq` : "",
        p.ratio === undefined ? "" : `(${p.ratio})`,
        p.yield === undefined ? "" : `(${p.yield})`,
        p.fraction !== undefined
          ? `(${Number((p.fraction * 100).toFixed(2))}%)`
          : "",
      ].filter(Boolean);
      if (parts.length) {
        const group = ctx
          .nodes(parent, (node) => ctx.data(node, "molecule") === prefix + p.id)
          .filter((node) => node.kind === "group")[0]!;
        const number = ctx.nodes(
          group,
          (node) => ctx.data(node, "number") === prefix + p.id + ":number",
        )[0];
        const box = ctx.box(number ?? group);
        const quantities = element("g", {
          "data-quantity": `${prefix}${p.id}:quantity`,
        });
        ctx.append(group, quantities);
        let y = box.y + box.height + B * 0.42;
        for (const [index, text] of parts.entries()) {
          const e = label(
            {
              x: box.x + box.width / 2,
              y,
            },
            text,
            "var(--chemical-number-font)",
          );
          ctx.set(e, "data-label", `${prefix}${p.id}:quantity:${index}`);
          ctx.append(quantities, e);
          y += ctx.box(e).height + B * 0.15;
        }
      }
    }
    if (view?.display)
      for (const [pid, display] of Object.entries(view.display)) {
        const group = ctx.groups(parent, "molecule", prefix + pid)[0];
        if (!group) continue;
        if (display === "hidden") ctx.remove(group);
        else if (display === "reference")
          for (const child of [...group.children])
            if (ctx.data(child, "number") !== `${prefix}${pid}:number`)
              ctx.remove(child);
      }
  }
  if (entry.kind === "compound") {
    const l = reference.variant
      ? entry.variants?.[reference.variant]
      : entry.layout;
    if (!l) throw new Error("Unknown layout variant");
    validateSceneChemistry(
      toolkit,
      library,
      {
        width: 1,
        height: 1,
        molecules: [
          {
            id: "compound",
            compound: entry.id,
            variant: reference.variant,
            at: { x: 0, y: 0 },
          },
        ],
        focus: reference.focus,
      },
      entry.id,
    );
    const group = element("g");
    ctx.append(svg, group);
    await molecule(
      entry,
      l,
      "compound",
      { x: 0, y: 0 },
      0,
      false,
      reference.focus,
      group,
    );
    const box = ctx.box(group);
    const dx = 1.5 * B - box.x,
      dy = 1.5 * B - box.y;
    ctx.set(group, "transform", `translate(${dx} ${dy})`);
    width = box.width + 3 * B;
    height = box.height + 3 * B;
    for (const p of Object.values(atomPoints)) {
      p.x += dx;
      p.y += dy;
    }
  } else if (entry.kind === "reaction") {
    width = entry.scene.width * B;
    height = entry.scene.height * B;
    await reaction(entry.id);
  } else if (entry.kind === "mechanism") {
    const frame = reference.frame
      ? entry.frames.find((f) => f.id === reference.frame)
      : entry.frames[0];
    if (!frame) throw new Error("Unknown frame");
    width = frame.scene.width * B;
    height = frame.scene.height * B;
    await scene(frame.scene, "", svg, reference.focus);
  } else if (entry.kind === "route") {
    routeMetrics(entry, library);
    width = entry.width * B;
    height = entry.height * B;
    for (const s of entry.steps) {
      const group = element("g", {
        transform: `translate(${s.at.x * B} ${s.at.y * B})`,
        "data-step": s.id,
      });
      ctx.append(svg, group);
      await reaction(s.reaction, s.id + "/", group, s);
      for (const [id, p] of Object.entries(atomPoints))
        if (id.startsWith(s.id + "/")) atomPoints[id] = plus(p, mul(s.at, B));
    }
    for (const [index, point] of (entry.plusAt ?? []).entries()) {
      const mark = label(mul(point, B), "+", "var(--chemical-plus-font)");
      ctx.setData(mark, "label", `${entry.id}:plus:${index}`);
      ctx.append(svg, mark);
    }
    for (const connection of entry.connections ?? [])
      ctx.append(
        svg,
        stroke(
          element("path", {
            d: connection.points
              .map((p, i) => `${i ? "L" : "M"}${p.x * B} ${p.y * B}`)
              .join(""),
            "data-route-edge": connection.id,
          }),
        ),
      );
  }
  if (entry.footnote) {
    const lines = wrapFigureText(
      entry.footnote.split("\n"),
      width - 3 * B,
      (text) => ctx.textWidth(text, "var(--chemical-caption-font)"),
    );
    let cursor = height + B * 0.4;
    for (const [index, text] of lines.entries()) {
      const note = label(
          { x: B * 1.5, y: 0 },
          text,
          "var(--chemical-caption-font)",
          "start",
        ),
        bounds = ctx.box(note);
      ctx.set(note, "y", String(cursor - bounds.y));
      ctx.setData(note, "label", `${entry.id}:footnote:${index}`);
      ctx.append(svg, note);
      cursor += bounds.height + B * 0.2;
    }
    height = cursor + B * 0.4;
  }
  ctx.set(svg, "viewBox", `0 0 ${width} ${height}`);
  ctx.set(svg, "width", String(width));
  ctx.set(svg, "height", String(height));
  const minimumScale = Math.max(
    token("--chemical-min-bond") / B,
    ...[
      ...ctx
        .nodes(svg, (node) => ctx.data(node, "bondLengths") !== undefined)
        .filter((node) => node.kind === "group"),
    ].flatMap((molecule) => {
      const lengths: number[] = JSON.parse(ctx.data(molecule, "bondLengths")!);
      return lengths.length
        ? [token("--chemical-min-bond") / Math.min(...lengths)]
        : [];
    }),
    ...[...ctx.nodes(svg).filter((node) => node.kind === "text")].map(
      (e) =>
        token(
          ctx.data(e, "script") !== undefined
            ? "--chemical-min-script"
            : "--chemical-min-text",
        ) / e.fontSize,
    ),
  );
  refreshGeometry(svg);
  return { format: 1, root: svg, width, height, minimumScale, atomPoints };
}
