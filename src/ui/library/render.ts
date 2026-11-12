import {
  routeElectronArrow,
  solidArrow,
  routeConnection,
} from "./arrow-layout.ts";
import { loadChemistry } from "../chemistry/rdkit.ts";
import {
  bondTraces,
  contains,
  inkBox,
  labelBoxes,
  overlap,
  spaceChiralHydrogens,
} from "./depiction-spacing.ts";
import {
  drawingMolecule,
  abbreviatedDrawing,
  graphOf,
  placedCoordinates,
  validateCompound,
  validateSceneChemistry,
} from "../../../shared/chemical-library/chemistry.ts";
import { abbreviatedGroups } from "../../../shared/molecule-abbreviations.ts";
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
  Scene,
} from "../../../shared/chemical-library/types.ts";

const NS = "http://www.w3.org/2000/svg";
function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}
const key = (a: AtomRef) => `${a.molecule}:${a.atom}`;
const plus = (a: Point, b: Point) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (p: Point, s: number) => ({ x: p.x * s, y: p.y * s });
const radians = (n: number) => (n * Math.PI) / 180;
const toward = (angle: number, r: number) => ({
  x: Math.cos(radians(angle)) * r,
  y: Math.sin(radians(angle)) * r,
});
function stroke(
  e: SVGElement,
  color = "var(--chemical-ink)",
  width = "var(--chemical-line)",
) {
  e.style.stroke = color;
  e.style.strokeWidth = width;
  e.style.fill = "none";
  return e;
}
function label(
  at: Point,
  text: string,
  size = "var(--chemical-font)",
  anchor = "middle",
) {
  const e = element("text", {
    x: at.x,
    y: at.y,
    "font-size": size,
    "text-anchor": anchor,
    "dominant-baseline": "central",
    fill: "var(--chemical-ink)",
    "font-family": "Arial, Helvetica, sans-serif",
  });
  for (const part of text.split(/([₀₁₂₃₄₅₆₇₈₉]+)/)) {
    if (/^[₀₁₂₃₄₅₆₇₈₉]+$/.test(part))
      e.append(
        element(
          "tspan",
          { "font-size": "0.8em", "baseline-shift": "sub" },
          [...part].map((ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch))).join(""),
        ),
      );
    else e.append(document.createTextNode(part));
  }
  return e;
}
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
export interface RenderedFigure {
  svg: SVGSVGElement;
  width: number;
  height: number;
  minimumScale: number;
  atomPoints: Record<string, Point>;
}
export async function renderFigure(
  library: Library,
  reference: FigureReference,
): Promise<RenderedFigure> {
  const entry = library[reference.ref];
  if (!entry) throw new Error(`Unknown figure ${reference.ref}`);
  const figureNumbers: Record<string, string> = {};
  const numbering = (
    reaction: import("../../../shared/chemical-library/types.ts").Reaction,
    prefix = "",
  ) => {
    for (const p of [...reaction.reactants, ...reaction.products])
      if (p.number !== undefined || p.name)
        figureNumbers[prefix + p.id] = [p.number, p.name]
          .filter(Boolean)
          .join(" · ");
  };
  if (entry.kind === "reaction") numbering(entry);
  if (entry.kind === "route")
    for (const step of entry.steps) {
      const reaction = library[step.reaction];
      if (reaction?.kind === "reaction") numbering(reaction, step.id + "/");
    }
  const svg = element("svg", {
    xmlns: NS,
    role: entry.kind === "reaction" || entry.kind === "route" ? "group" : "img",
    "aria-label": entry.title,
    "data-figure": entry.id,
  });
  svg.style.overflow = "visible";
  svg.style.fontFamily = "Arial, Helvetica, sans-serif";
  if (entry.kind === "image") {
    const href = `/library/assets/${entry.asset}`;
    const image = new Image();
    image.src = href;
    await image.decode();
    let intrinsicWidth = image.naturalWidth,
      intrinsicHeight = image.naturalHeight;
    if (entry.mime === "image/svg+xml") {
      const source = new DOMParser().parseFromString(
        await (await fetch(href)).text(),
        "image/svg+xml",
      ).documentElement;
      const box = source
        .getAttribute("viewBox")
        ?.trim()
        .split(/[ ,]+/)
        .map(Number);
      if (box?.length === 4) {
        intrinsicWidth = box[2];
        intrinsicHeight = box[3];
      }
    }
    if (intrinsicWidth !== entry.width || intrinsicHeight !== entry.height)
      throw new Error(`${entry.id}: image dimensions differ from metadata`);
    const crop = entry.crop ?? {
      x: 0,
      y: 0,
      width: entry.width,
      height: entry.height,
    };
    svg.append(
      element("image", {
        href,
        x: -crop.x,
        y: -crop.y,
        width: entry.width,
        height: entry.height,
      }),
    );
    svg.style.overflow = "hidden";
    svg.setAttribute("viewBox", `0 0 ${crop.width} ${crop.height}`);
    svg.setAttribute("width", String(crop.width));
    svg.setAttribute("height", String(crop.height));
    return {
      svg,
      width: crop.width,
      height: crop.height,
      atomPoints: {},
      minimumScale: 0,
    };
  }
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => {
    const value = parseFloat(style.getPropertyValue(name));
    if (!Number.isFinite(value))
      throw new Error(`Missing chemical style token ${name}`);
    return value;
  };
  const B = token("--chemical-bond");
  const toolkit = await loadChemistry();
  const measuring = document.createElement("div");
  measuring.style.cssText =
    "position:absolute;left:-100000px;top:0;visibility:hidden";
  measuring.append(svg);
  document.body.append(measuring);
  try {
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
      parent: SVGGraphicsElement = svg,
    ) {
      validateCompound(toolkit, c);
      const coords = placedCoordinates(toolkit, c, layout, rotate, mirror);
      const mol = drawingMolecule(toolkit, c, coords, layout, rotate, mirror);
      let depiction = mol;
      try {
        const graph = graphOf(mol),
          groups = abbreviatedGroups(toolkit, mol, layout.abbreviations).filter(
            (g) =>
              !layout.abbreviationAtoms ||
              layout.abbreviationAtoms.includes(c.atomIds[g.atoms[0]]),
          ),
          folded = new Set(groups.flatMap((g) => g.atoms)),
          hiddenBonds = new Set(groups.flatMap((g) => g.bonds));
        const drawn = abbreviatedDrawing(toolkit, mol, hiddenBonds);
        depiction = drawn.mol;
        const atomLabels: Record<number, string> = {};
        for (const g of groups) {
          for (const i of g.atoms) atomLabels[i] = "";
          const root = coords[g.atoms[0]],
            outside = coords[g.attachment];
          atomLabels[g.atoms[0]] =
            g.name === "PPh3"
              ? outside.x > root.x
                ? "Ph<sub>3</sub>P"
                : "PPh<sub>3</sub>"
              : g.name === "CCl3"
                ? "CCl<sub>3</sub>"
                : g.name;
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
        const draw = (count: number): Document =>
          new DOMParser().parseFromString(
            depiction.get_svg_with_highlights(
              JSON.stringify({
                width: Math.ceil((Math.max(...xs) - Math.min(...xs)) * B + 100),
                height: Math.ceil(
                  (Math.max(...ys) - Math.min(...ys)) * B + 100,
                ),
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
                addStereoAnnotation: layout.stereoAnnotations ?? false,
                annotationFontScale: 0.65,
                atomLabels,
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
            "image/svg+xml",
          );
        let doc = draw(graph.atoms.length);
        // Native preparation adds drawing-only H atoms for fused stereocentres.
        // Include their highlight centres so bond-size diagnostics measure them too.
        const count = Math.max(
          graph.atoms.length,
          ...[...doc.querySelectorAll("[class]")].flatMap((e) =>
            [...(e.getAttribute("class") ?? "").matchAll(/atom-(\d+)/g)].map(
              (m) => Number(m[1]) + 1,
            ),
          ),
        );
        if (count > graph.atoms.length) doc = draw(count);
        if (doc.querySelector("parsererror"))
          throw new Error(`${c.id}: depiction failed`);
        const positions = Array.from({ length: count }, (_, i) => {
          const e = doc.querySelector(`ellipse.atom-${i}`);
          if (!e) throw new Error(`${c.id}: missing atom position ${i}`);
          return {
            x: Number(e.getAttribute("cx")),
            y: Number(e.getAttribute("cy")),
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
        for (const e of doc.querySelectorAll("path[class*='bond-']")) {
          const cls = e.getAttribute("class")!;
          const i = Number(/bond-(\d+)/.exec(cls)![1]);
          const atoms = [...cls.matchAll(/atom-(\d+)/g)].map((m) =>
            Number(m[1]),
          );
          if (i >= drawn.bonds.length && atoms.length === 2)
            nativeBonds.set(i, [atoms[0], atoms[1]]);
        }
        g.dataset.bondLengths = JSON.stringify(
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
        );
        parent.append(g);
        const f = focusKeys(focus);
        const ink = [f.atoms, f.bonds, f.support, f.supportBonds].some(
          (set) => set.size,
        )
          ? "var(--chemical-muted)"
          : "var(--chemical-ink)";
        for (const node of [...doc.documentElement.children]) {
          if (node.tagName === "rect" || node.tagName === "ellipse") continue;
          const cls = node.getAttribute("class") ?? "";
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
            ai.some(
              (i) => folded.has(i) && !groups.some((g) => g.atoms[0] === i),
            )
          )
            continue;
          const e = document.importNode(node, true);
          if (!(e instanceof SVGGraphicsElement)) continue;
          if (e.tagName === "path" && !bi && !ai.length) continue;
          if (e.tagName === "path" && bi) {
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
            e.style.stroke = primary
              ? "var(--chemical-focus)"
              : supporting
                ? "var(--chemical-support)"
                : ink;
            e.style.strokeWidth = primary
              ? "var(--chemical-focus-line)"
              : supporting
                ? "var(--chemical-support-line)"
                : "var(--chemical-line)";
            if (e.style.fill && e.style.fill !== "none") {
              // RDKit solid wedges are filled triangles. An added miter stroke
              // extends their narrow tip beyond the stereocenter.
              e.style.fill = e.style.stroke;
              e.style.stroke = "none";
              e.style.strokeWidth = "0";
            }
            e.setAttribute("data-bond", `${id}:b${index}`);
            e.setAttribute("data-atoms", ids.join(" "));
          } else if (
            e.tagName === "text" ||
            (e.tagName === "path" && ai.length)
          ) {
            const aid = ai.length
              ? key({
                  molecule: id,
                  atom:
                    c.atomIds[ai[0]] ?? `hydrogen-${ai[0] - c.atomIds.length}`,
                })
              : "";
            e.setAttribute("data-label", aid || `${id}:annotation`);
            if (atomLabels[ai[0]])
              e.setAttribute("data-label-text", atomLabels[ai[0]]);
            e.style.fontFamily = "Arial, Helvetica, sans-serif";
            if (parseFloat(e.style.fontSize) < token("--chemical-font"))
              e.setAttribute("data-script", "true");
            if (
              graph.atoms[ai[0]]?.chg &&
              /^[+−-]$/.test(e.textContent ?? "")
            ) {
              e.setAttribute("data-label", `${aid}:charge`);
              e.setAttribute("data-charge-owner", aid);
            }
            e.style.fill = f.atoms.has(aid)
              ? "var(--chemical-focus)"
              : f.support.has(aid)
                ? "var(--chemical-support)"
                : ink;
          }
          g.append(e);
        }
        spaceChiralHydrogens(
          g,
          positions,
          graph.atoms.length,
          nativeBonds,
          graph.bonds,
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
        g.dataset.atomPoints = JSON.stringify(localPoints);
        if (layout.compact) {
          const idx = c.atomIds.indexOf(layout.compact.atom);
          const glyphs = [
            ...g.querySelectorAll<SVGGraphicsElement>(
              `[data-label="${CSS.escape(key({ molecule: id, atom: layout.compact.atom }))}"]`,
            ),
          ];
          const glyph =
            layout.compact.anchor === "last" ? glyphs.at(-1)! : glyphs[0];
          const box = glyph.getBBox(),
            p = positions[idx];
          const dx = p.x - box.x - box.width / 2,
            dy = p.y - box.y - box.height / 2;
          for (const e of glyphs)
            e.setAttribute("transform", `translate(${dx} ${dy})`);
        }
        for (const [i, atom] of graph.atoms.entries()) {
          if (
            !atom.chg ||
            (folded.has(i) && !groups.some((g) => g.atoms[0] === i))
          )
            continue;
          const aid = key({ molecule: id, atom: c.atomIds[i] });
          const labels = [
            ...g.querySelectorAll<SVGGraphicsElement>(
              `[data-label="${CSS.escape(aid)}"]`,
            ),
          ];
          let boxes = labels.map((e) => inkBox(e, g));
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
              const gap =
                (bondAngles[k + 1] ?? bondAngles[0] + 2 * Math.PI) - a;
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
          const otherLabels = labelBoxes(g),
            traces = bondTraces(g);
          const candidates = angles.map((angle) => {
            const center = centerAt(angle);
            const marker = new DOMRect(
              center.x - r,
              center.y - r,
              2 * r,
              2 * r,
            );
            const combined = new DOMRect(
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
          charge.append(
            stroke(element("circle", { cx: center.x, cy: center.y, r }), color),
          );
          const arm = r * 0.5;
          charge.append(
            stroke(
              element("path", {
                d: `M${center.x - arm} ${center.y}H${center.x + arm}${atom.chg > 0 ? `M${center.x} ${center.y - arm}V${center.y + arm}` : ""}`,
              }),
              color,
            ),
          );
          g.append(charge);
        }
        const number = reference.numbers?.[id] ?? figureNumbers[id];
        if (number) {
          const bounds = g.getBBox();
          const e = label(
            {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height + B * 0.55,
            },
            number,
            "var(--chemical-caption-font)",
          );
          e.style.fontWeight = "600";
          e.setAttribute("data-label", `${id}:number`);
          g.append(e);
        }
      } finally {
        if (depiction !== mol) depiction.delete();
        mol.delete();
      }
    }
    async function scene(
      s: Scene,
      prefix = "",
      parent: SVGGraphicsElement = svg,
      override?: Focus,
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
          ...parent.querySelectorAll<SVGGraphicsElement>(
            `[data-label="${CSS.escape(id)}"]`,
          ),
        ].map((e) => {
          const b = e.getBBox(),
            m = parent.getCTM()!.inverse().multiply(e.getCTM()!);
          const p = new DOMPoint(b.x, b.y).matrixTransform(m),
            q = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
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
          p = plus(
            origin,
            toward(angle, labelClearance(l.at, angle, B * 0.075)),
          );
          dotAngle = angle + 90;
        }
        // Formal graph charges own their displayed circled signs. A scene
        // declaration names the existing anchor without redrawing it.
        if (l.kind === "charge") {
          const native = parent.querySelector<SVGGraphicsElement>(
            `[data-charge-owner="${CSS.escape(key({ molecule: prefix + l.at.molecule, atom: l.at.atom }))}"]`,
          );
          if (!native) throw new Error(`No displayed charge at ${key(l.at)}`);
          const box = native.getBBox();
          const matrix = parent.getCTM()!.inverse().multiply(native.getCTM()!);
          positions.set(
            l.id,
            new DOMPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ).matrixTransform(matrix),
          );
          continue;
        }
        positions.set(l.id, p);
        if (l.kind === "radical") positions.set("radical:" + key(l.at), p);
        const g = element("g", {
          "data-label": prefix + l.id,
          "data-owner": key(l.at),
        });
        parent.append(g);
        if (l.kind === "lonePair" || l.kind === "radical") {
          for (const dx of l.kind === "radical" ? [0] : [-B * 0.053, B * 0.053])
            g.append(
              element("circle", {
                cx: p.x + dx * Math.cos(radians(dotAngle)),
                cy: p.y + dx * Math.sin(radians(dotAngle)),
                r: B * 0.03,
                fill: "var(--chemical-ink)",
              }),
            );
        } else g.append(label(p, l.text ?? ""));
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
          const charge = parent.querySelector<SVGGElement>(
            `[data-charge-owner="${CSS.escape(owner)}"]`,
          );
          if (!charge) throw new Error(`No displayed charge at ${owner}`);
          const box = charge.getBBox(),
            matrix = parent.getCTM()!.inverse().multiply(charge.getCTM()!);
          return new DOMPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ).matrixTransform(matrix);
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
          if (c?.kind !== "compound")
            throw new Error("Missing anchor compound");
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
            ...parent.querySelectorAll<SVGPathElement>("[data-bond]"),
          ]
            .filter((el) =>
              names.every((name) =>
                (el.dataset.atoms ?? "").split(" ").includes(name),
              ),
            )
            .map((el) =>
              el
                .getPointAtLength(el.getTotalLength() * fraction)
                .matrixTransform(
                  parent.getCTM()!.inverse().multiply(el.getCTM()!),
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
          a.from.kind === "radical" || a.to.kind === "radical"
            ? 1
            : a.electrons;
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
          toward(
            curve.entryAngle + 180,
            clearance(a.to, curve.entryAngle + 180),
          ),
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
        parent.append(
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
          parent.append(
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
          parent.append(
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
        ] as const)
          lines.forEach((text, i) => {
            const e = label(
              {
                x: (p.x + q.x) / 2,
                y: (p.y + q.y) / 2 + sign * (B * 0.65 + i * B * 0.58),
              },
              text,
              "var(--chemical-caption-font)",
            );
            e.style.fill = ink;
            e.dataset.label = prefix + a.id + ":" + sign + ":" + i;
            parent.append(e);
          });
      }
      for (const [i, c] of (s.captions ?? []).entries()) {
        const e = label(
          mul(c.at, B),
          c.text,
          "var(--chemical-caption-font)",
          c.align ?? "middle",
        );
        e.dataset.label = prefix + "caption:" + i;
        if (s.comparison && c.tone === "comparison")
          e.style.fill = "var(--chemical-comparison)";
        parent.append(e);
      }
      for (const b of s.partialBonds ?? []) {
        const p = atom(b.atoms[0]),
          q = atom(b.atoms[1]);
        parent.append(
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
        parent.append(
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
      parent: SVGGraphicsElement = svg,
    ) {
      const r = library[id];
      if (r?.kind !== "reaction") throw new Error(`Missing reaction ${id}`);
      await scene(r.scene, prefix, parent, reference.focus);
      const a = mul(r.arrow.from, B),
        b = mul(r.arrow.to, B);
      const overhead = [...r.reactants, ...r.products]
        .filter(
          (p) => p.position === "above-arrow" || p.position === "below-arrow",
        )
        .map((p) => {
          const group = parent.querySelector<SVGGElement>(
            `[data-molecule="${CSS.escape(prefix + p.id)}"]`,
          )!;
          const box = group.getBBox();
          const shift = group.transform.baseVal.consolidate()?.matrix;
          const bounds = {
            x: box.x + (shift?.e ?? 0),
            y: box.y + (shift?.f ?? 0),
            width: box.width,
            height: box.height,
          };
          a.x = Math.min(a.x, bounds.x - B * 0.4);
          b.x = Math.max(b.x, bounds.x + bounds.width + B * 0.4);
          return { position: p.position, bounds };
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
      for (const path of parent.querySelectorAll<SVGElement>(
        `[data-reaction-arrow="${CSS.escape(prefix + id)}"]`,
      )) {
        path.dataset.reactionId = id;
        path.setAttribute("role", "button");
        path.setAttribute("tabindex", "0");
        path.setAttribute("aria-label", r.title);
        path.setAttribute("pointer-events", "bounding-box");
      }
      const center = (a.x + b.x) / 2;
      const reactants = r.reactants
        .filter((p) => !p.position || p.position === "inline")
        .map((p) => r.scene.molecules.find((m) => m.id === p.id)!);
      for (let i = 1; r.showPlus !== false && i < reactants.length; i++) {
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
        );
        mark.setAttribute("data-label", `${prefix}${id}:plus:${i}`);
        parent.append(mark);
      }
      const textWidth = r.arrow.textWidth * B;
      function wrap(lines: string[]) {
        const probe = label({ x: 0, y: 0 }, "", "var(--chemical-caption-font)");
        parent.append(probe);
        const result: string[] = [];
        for (const text of lines) {
          const tokens: string[] = [];
          for (const part of text.trim().match(/.*?(?:[；，、/;\s]+|$)/gu) ??
            []) {
            if (!part) continue;
            const previous = tokens.at(-1);
            // A quantity and its following unit share one line, including
            // temperature ranges such as −20–25 °C.
            if (
              previous &&
              /\d\s+$/u.test(previous) &&
              /^(?:°|\p{L})/u.test(part)
            )
              tokens[tokens.length - 1] += part;
            else tokens.push(part);
          }
          let line = "";
          for (const token of tokens) {
            probe.textContent = line + token;
            if (line && probe.getComputedTextLength() > textWidth) {
              result.push(line.trim());
              line = token;
            } else line += token;
          }
          if (line) result.push(line.trim());
        }
        probe.remove();
        return result;
      }
      const reagentsBelow = r.reagentPosition === "below-arrow";
      for (const [lines, sign] of [
        [reagentsBelow ? [] : wrap(r.reagents), -1],
        [
          [...(reagentsBelow ? wrap(r.reagents) : []), ...wrap(r.conditions)],
          1,
        ],
      ] as const) {
        const occupied = overhead.filter(
          (p) => p.position === (sign < 0 ? "above-arrow" : "below-arrow"),
        );
        const edge =
          sign < 0
            ? Math.min(
                a.y,
                b.y,
                ...arrowShape.vertices.map((p) => p.y),
                ...occupied.map((p) => p.bounds.y),
              )
            : Math.max(
                a.y,
                b.y,
                ...arrowShape.vertices.map((p) => p.y),
                ...occupied.map((p) => p.bounds.y + p.bounds.height),
              );
        const gap = token("--chemical-caption-font") / 4;
        let cursor = edge;
        lines.forEach((text, i) => {
          const e = label(
            { x: center, y: 0 },
            text,
            "var(--chemical-caption-font)",
          );
          e.setAttribute("data-label", `${prefix}${id}:condition:${sign}:${i}`);
          parent.append(e);
          const bounds = e.getBBox();
          const y =
            sign < 0
              ? cursor - gap - bounds.y - bounds.height
              : cursor + gap - bounds.y;
          if (Math.abs(a.y - b.y) > Math.abs(a.x - b.x)) {
            const side = r.arrow.side === "left" ? -1 : 1;
            e.setAttribute("x", String(center + side * (B + bounds.width / 2)));
            e.setAttribute(
              "y",
              String(
                (a.y + b.y) / 2 +
                  (i + (sign > 0 ? r.reagents.length : 0)) * B * 0.6,
              ),
            );
          } else e.setAttribute("y", String(y));
          cursor = y + bounds.y + (sign > 0 ? bounds.height : 0);
        });
      }
      for (const p of [...r.reactants, ...r.products]) {
        if (p.position === "text" || p.position === "none") continue;
        const parts = [
          p.equivalents !== undefined ? `${p.equivalents} eq` : "",
          p.yield ?? "",
          p.ratio ?? "",
          p.fraction !== undefined
            ? `${Number((p.fraction * 100).toFixed(2))}%`
            : "",
        ].filter(Boolean);
        if (parts.length) {
          const group = parent.querySelector<SVGGElement>(
            `[data-molecule="${CSS.escape(prefix + p.id)}"]`,
          )!;
          const number = group.querySelector<SVGGraphicsElement>(
            `[data-label="${CSS.escape(prefix + p.id + ":number")}"]`,
          );
          const box = (number ?? group).getBBox();
          const e = label(
            {
              x: box.x + box.width / 2,
              y: box.y + box.height + B * 0.42,
            },
            parts.join(" · "),
            "var(--chemical-caption-font)",
          );
          e.setAttribute("data-label", `${prefix}${p.id}:quantity`);
          group.append(e);
        }
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
      svg.append(group);
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
      const box = group.getBBox();
      const dx = 1.5 * B - box.x,
        dy = 1.5 * B - box.y;
      group.setAttribute("transform", `translate(${dx} ${dy})`);
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
        svg.append(group);
        await reaction(s.reaction, s.id + "/", group);
        for (const [id, p] of Object.entries(atomPoints))
          if (id.startsWith(s.id + "/")) atomPoints[id] = plus(p, mul(s.at, B));
      }
      for (const edge of entry.edges) {
        const from = entry.steps.find((s) => s.id === edge.from)!,
          to = entry.steps.find((s) => s.id === edge.to)!;
        const targetReaction = library[to.reaction];
        if (
          targetReaction.kind === "reaction" &&
          targetReaction.reactants.some(
            (p) =>
              p.id === edge.reactant &&
              (p.position === "text" || p.position === "none"),
          )
        )
          continue;
        const a = svg.querySelector<SVGGElement>(
          `[data-molecule="${CSS.escape(edge.from + "/" + edge.product)}"]`,
        )!;
        const b = svg.querySelector<SVGGElement>(
          `[data-molecule="${CSS.escape(edge.to + "/" + edge.reactant)}"]`,
        )!;
        const bounds = (g: SVGGElement) => {
          const box = g.getBBox(),
            matrix = svg.getCTM()!.inverse().multiply(g.getCTM()!);
          const p = new DOMPoint(box.x, box.y).matrixTransform(matrix),
            q = new DOMPoint(
              box.x + box.width,
              box.y + box.height,
            ).matrixTransform(matrix);
          return {
            left: p.x,
            top: p.y,
            right: q.x,
            bottom: q.y,
            x: (p.x + q.x) / 2,
            y: (p.y + q.y) / 2,
          };
        };
        const ra = bounds(a),
          rb = bounds(b);
        const source = library[from.reaction],
          target = library[to.reaction];
        if (source.kind !== "reaction" || target.kind !== "reaction")
          throw new Error("Invalid route reaction");
        const pa = source.scene.molecules.find((m) => m.id === edge.product)!,
          pb = target.scene.molecules.find((m) => m.id === edge.reactant)!;
        if (
          Math.hypot(
            from.at.x + pa.at.x - to.at.x - pb.at.x,
            from.at.y + pa.at.y - to.at.y - pb.at.y,
          ) < 0.001 &&
          pa.variant === pb.variant &&
          pa.rotate === pb.rotate &&
          pa.mirror === pb.mirror
        ) {
          b.remove();
          continue;
        }
        const rowY = (step: typeof from, reaction: typeof source) =>
          step.at.y + (reaction.arrow.from.y + reaction.arrow.to.y) / 2;
        const vertical =
          Math.abs(rowY(from, source) - rowY(to, target)) > 0.001;
        const fromRow = bounds(a.closest<SVGGElement>("[data-step]")!),
          toRow = bounds(b.closest<SVGGElement>("[data-step]")!);
        const points = routeConnection(ra, rb, fromRow, toRow, vertical);
        svg.append(
          stroke(
            element("path", {
              d: points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(""),
              "data-route-edge": `${edge.from}/${edge.product}->${edge.to}/${edge.reactant}`,
            }),
          ),
        );
      }
    }
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const minimumScale = Math.max(
      token("--chemical-min-bond") / B,
      ...[...svg.querySelectorAll<SVGGElement>("[data-bond-lengths]")].flatMap(
        (molecule) => {
          const lengths: number[] = JSON.parse(molecule.dataset.bondLengths!);
          return lengths.length
            ? [token("--chemical-min-bond") / Math.min(...lengths)]
            : [];
        },
      ),
      ...[...svg.querySelectorAll("text")].map(
        (e) =>
          token(
            e.hasAttribute("data-script")
              ? "--chemical-min-script"
              : "--chemical-min-text",
          ) / parseFloat(getComputedStyle(e).fontSize),
      ),
    );
    return { svg, width, height, minimumScale, atomPoints };
  } finally {
    measuring.remove();
  }
}
