import { loadChemistry } from "../chemistry/rdkit.ts";
import {
  drawingMolecule,
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
  return element(
    "text",
    {
      x: at.x,
      y: at.y,
      "font-size": size,
      "text-anchor": anchor,
      "dominant-baseline": "central",
      fill: "var(--chemical-ink)",
      "font-family": "Arial, Helvetica, sans-serif",
    },
    text,
  );
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
      const coords = placedCoordinates(c, layout, rotate, mirror);
      const mol = drawingMolecule(toolkit, c, coords);
      try {
        const graph = graphOf(mol),
          groups = abbreviatedGroups(toolkit, mol, layout.abbreviations),
          folded = new Set(groups.flatMap((g) => g.atoms)),
          hiddenBonds = new Set(groups.flatMap((g) => g.bonds));
        const atomLabels: Record<number, string> = {};
        for (const g of groups) for (const i of g.atoms) atomLabels[i] = "";
        for (const t of c.template ?? [])
          atomLabels[c.atomIds.indexOf(t.atom)] = t.label;
        const xs = coords.map((p) => p.x),
          ys = coords.map((p) => p.y);
        const markup = mol.get_svg_with_highlights(
          JSON.stringify({
            width: Math.ceil((Math.max(...xs) - Math.min(...xs)) * B + 100),
            height: Math.ceil((Math.max(...ys) - Math.min(...ys)) * B + 100),
            scalingFactor: B / 1.5,
            fixedBondLength: B / 1.5,
            bondLineWidth: token("--chemical-line"),
            scaleBondWidth: false,
            fixedFontSize: token("--chemical-font"),
            noFreetype: true,
            atomColourPalette: "bw",
            addStereoAnnotation: layout.stereoAnnotations ?? false,
            annotationFontScale: 0.65,
            atomLabels,
            atoms: c.atomIds.map((_, i) => i),
            bonds: [],
            highlightRadius: 0.1,
            atomHighlightsAreCircles: true,
            prepareMolsBeforeDrawing: true,
            addChiralHs: false,
          }),
        );
        const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
        if (doc.querySelector("parsererror"))
          throw new Error(`${c.id}: depiction failed`);
        const positions = c.atomIds.map((_, i) => {
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
        g.dataset.bondLengths = JSON.stringify(
          graph.bonds
            .filter((_, i) => !hiddenBonds.has(i))
            .map(({ atoms: [a, b] }) =>
              Math.hypot(
                positions[a].x - positions[b].x,
                positions[a].y - positions[b].y,
              ),
            ),
        );
        parent.append(g);
        positions.forEach((p, i) => {
          atomPoints[key({ molecule: id, atom: c.atomIds[i] })] = plus(
            p,
            shift,
          );
        });
        const f = focusKeys(focus);
        for (const node of [...doc.documentElement.children]) {
          if (node.tagName === "rect" || node.tagName === "ellipse") continue;
          const cls = node.getAttribute("class") ?? "";
          const bi = /bond-(\d+)/.exec(cls),
            ai = [...cls.matchAll(/atom-(\d+)/g)].map((m) => Number(m[1]));
          if (bi && hiddenBonds.has(Number(bi[1]))) continue;
          if (!bi && ai.some((i) => folded.has(i))) continue;
          const e = document.importNode(node, true);
          if (!(e instanceof SVGGraphicsElement)) continue;
          if (e.tagName === "path") {
            if (!bi) continue;
            const index = Number(bi[1]);
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
                : "var(--chemical-ink)";
            e.style.strokeWidth = primary
              ? "var(--chemical-focus-line)"
              : supporting
                ? "var(--chemical-support-line)"
                : "var(--chemical-line)";
            if (e.style.fill && e.style.fill !== "none")
              e.style.fill = e.style.stroke;
            e.setAttribute("data-bond", `${id}:b${index}`);
            e.setAttribute("data-atoms", ids.join(" "));
          } else if (e.tagName === "text") {
            const aid = ai.length
              ? key({
                  molecule: id,
                  atom:
                    c.atomIds[ai[0]] ?? `hydrogen-${ai[0] - c.atomIds.length}`,
                })
              : "";
            e.setAttribute("data-label", aid || `${id}:annotation`);
            e.style.fontFamily = "Arial, Helvetica, sans-serif";
            if (parseFloat(e.style.fontSize) < 14) {
              e.style.fontSize = "var(--chemical-script-font)";
              e.setAttribute("data-script", "true");
            }
            const charge = graph.atoms[ai[0]]?.chg;
            if (charge && (e.textContent === "-" || e.textContent === "+")) {
              g.append(e);
              const box = e.getBBox();
              const center = {
                x: box.x + box.width / 2 + 5,
                y: box.y + box.height / 2 - 4,
              };
              e.remove();
              const sign = element("g", {
                "data-label": `${aid}:charge`,
                "data-charge-owner": aid,
              });
              const ink = f.atoms.has(aid)
                ? "var(--chemical-focus)"
                : "var(--chemical-ink)";
              sign.append(
                stroke(
                  element("circle", { cx: center.x, cy: center.y, r: 4.5 }),
                  ink,
                  "1",
                ),
              );
              sign.append(
                stroke(
                  element("path", {
                    d: `M${center.x - 2.5} ${center.y}H${center.x + 2.5}${charge > 0 ? `M${center.x} ${center.y - 2.5}V${center.y + 2.5}` : ""}`,
                  }),
                  ink,
                  "1",
                ),
              );
              g.append(sign);
              continue;
            }
            e.style.fill = f.atoms.has(aid)
              ? "var(--chemical-focus)"
              : f.support.has(aid)
                ? "var(--chemical-support)"
                : "var(--chemical-ink)";
            if (f.atoms.has(aid) || f.support.has(aid))
              e.style.fontWeight = "600";
            const offset = layout.labels?.[c.atomIds[ai[0]]];
            if (offset)
              e.setAttribute(
                "transform",
                `translate(${offset.x * B} ${offset.y * B})`,
              );
          }
          g.append(e);
        }
        for (const group of groups) {
          const p = positions[group.atoms[0]],
            a = positions[group.attachment];
          const anchor = p.x < a.x ? "end" : "start";
          const e = label(p, group.name, "var(--chemical-font)", anchor);
          e.setAttribute(
            "data-label",
            key({ molecule: id, atom: c.atomIds[group.atoms[0]] }),
          );
          g.append(e);
        }
        const number = reference.numbers?.[id];
        if (number) {
          const maxY = Math.max(
            ...positions.filter((_, i) => !folded.has(i)).map((p) => p.y),
          );
          const e = label(
            { x: at.x * B - shift.x, y: maxY + 24 },
            number,
            "var(--chemical-caption-font)",
          );
          e.style.fontWeight = "600";
          e.setAttribute("data-label", `${id}:number`);
          g.append(e);
        }
      } finally {
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
      for (const l of s.labels ?? []) {
        const p = plus(atom(l.at), mul(l.offset, B));
        if (l.kind === "charge")
          parent
            .querySelector(
              `[data-charge-owner="${CSS.escape(key({ molecule: prefix + l.at.molecule, atom: l.at.atom }))}"]`,
            )
            ?.remove();
        positions.set(l.id, p);
        const g = element("g", {
          "data-label": prefix + l.id,
          "data-owner": key(l.at),
        });
        parent.append(g);
        if (l.kind === "lonePair") {
          for (const dx of [-1.7, 1.7])
            g.append(
              element("circle", {
                cx: p.x + dx,
                cy: p.y,
                r: 0.9,
                fill: "var(--chemical-ink)",
              }),
            );
        } else g.append(label(p, l.text ?? ""));
      }
      function anchor(a: Anchor): Point {
        if (a.kind === "atom") return atom(a.at);
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
        if (a.kind === "bond") {
          if (a.atoms[0].molecule !== a.atoms[1].molecule)
            throw new Error("Bond anchor crosses molecules");
          const placement = s.molecules.find(
            (p) => p.id === a.atoms[0].molecule,
          )!;
          const c = library[placement.compound];
          if (c?.kind !== "compound")
            throw new Error("Missing anchor compound");
          const m = toolkit.get_mol(c.smiles)!;
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
        return {
          x: p.x + (q.x - p.x) * fraction,
          y: p.y + (q.y - p.y) * fraction,
        };
      }
      const focused = focusKeys(f);
      for (const a of s.arrows ?? []) {
        let p0 = anchor(a.from),
          p3 = anchor(a.to);
        const c1 = a.curve.control1
          ? mul(a.curve.control1, B)
          : toward(a.curve.exitAngle, a.curve.reach[0] * B);
        const c2 = a.curve.control2
          ? mul(a.curve.control2, B)
          : toward(a.curve.entryAngle + 180, a.curve.reach[1] * B);
        // Atom/charge anchors stop at their visible label boundary. Bond and lone-pair anchors retain their semantic position.
        const clearance = (anchor: Anchor, origin: Point, angle: number) => {
          if (anchor.kind === "charge") return 7;
          if (anchor.kind !== "atom") return 2.5;
          const id = key({
            molecule: prefix + anchor.at.molecule,
            atom: anchor.at.atom,
          });
          const direction = toward(angle, 1);
          let distance = 2.5;
          for (const text of parent.querySelectorAll<SVGGraphicsElement>(
            "[data-label]",
          )) {
            if (text.getAttribute("data-label") !== id) continue;
            const box = text.getBBox();
            const matrix = parent.getCTM()!.inverse().multiply(text.getCTM()!);
            const low = new DOMPoint(box.x, box.y).matrixTransform(matrix);
            const high = new DOMPoint(
              box.x + box.width,
              box.y + box.height,
            ).matrixTransform(matrix);
            let enter = -Infinity,
              exit = Infinity;
            for (const [start, delta, min, max] of [
              [origin.x, direction.x, low.x - 2.5, high.x + 2.5],
              [origin.y, direction.y, low.y - 2.5, high.y + 2.5],
            ]) {
              if (Math.abs(delta) < 1e-8) {
                if (start < min || start > max) {
                  enter = Infinity;
                  break;
                }
              } else {
                const v1 = (min - start) / delta,
                  v2 = (max - start) / delta;
                enter = Math.max(enter, Math.min(v1, v2));
                exit = Math.min(exit, Math.max(v1, v2));
              }
            }
            if (exit >= Math.max(enter, 0)) distance = Math.max(distance, exit);
          }
          return distance;
        };
        p0 = plus(
          p0,
          toward(a.curve.exitAngle, clearance(a.from, p0, a.curve.exitAngle)),
        );
        p3 = plus(
          p3,
          toward(
            a.curve.entryAngle + 180,
            clearance(a.to, p3, a.curve.entryAngle + 180),
          ),
        );
        const p1 = plus(p0, c1),
          p2 = plus(p3, c2);
        const path = stroke(
          element("path", {
            d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`,
            "data-electron-arrow": prefix + a.id,
            "data-prefix": prefix,
            "data-from": JSON.stringify(a.from),
            "data-to": JSON.stringify(a.to),
          }),
          focused.arrows.has(prefix + a.id)
            ? "var(--chemical-focus)"
            : focused.supportArrows.has(prefix + a.id)
              ? "var(--chemical-support)"
              : "var(--chemical-ink)",
          "var(--chemical-arrow-line)",
        );
        parent.append(path);
        const angle = Math.atan2(p3.y - p2.y, p3.x - p2.x),
          back = {
            x: p3.x - 5.6 * Math.cos(angle),
            y: p3.y - 5.6 * Math.sin(angle),
          },
          left = {
            x: back.x + 1.7 * Math.sin(angle),
            y: back.y - 1.7 * Math.cos(angle),
          },
          right = {
            x: back.x - 1.7 * Math.sin(angle),
            y: back.y + 1.7 * Math.cos(angle),
          };
        parent.append(
          stroke(
            element("path", {
              d: `M ${left.x} ${left.y} L ${p3.x} ${p3.y}${a.electrons === 2 ? ` L ${right.x} ${right.y}` : ""}`,
              "data-arrow-head": prefix + a.id,
            }),
            focused.arrows.has(prefix + a.id)
              ? "var(--chemical-focus)"
              : focused.supportArrows.has(prefix + a.id)
                ? "var(--chemical-support)"
                : "var(--chemical-ink)",
            "var(--chemical-arrow-line)",
          ),
        );
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
      parent.append(
        stroke(
          element("path", {
            d: `M${a.x} ${a.y}L${b.x} ${b.y}`,
            "data-reaction-arrow": prefix + id,
            "data-reaction-id": id,
            role: "button",
            tabindex: 0,
            "aria-label": r.title,
            "pointer-events": "bounding-box",
          }),
        ),
      );
      parent.append(
        element("path", {
          d: `M${b.x - 7} ${b.y - 3}L${b.x} ${b.y}L${b.x - 7} ${b.y + 3}Z`,
          fill: "var(--chemical-ink)",
        }),
      );
      const center = (a.x + b.x) / 2;
      const reactants = r.reactants.map((p) =>
        r.scene.molecules.find((m) => m.id === p.id)!,
      );
      for (let i = 1; i < reactants.length; i++) {
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
          let line = "";
          for (const char of text) {
            probe.textContent = line + char;
            if (line && probe.getComputedTextLength() > textWidth) {
              result.push(line.trim());
              line = char;
            } else line += char;
          }
          if (line) result.push(line.trim());
        }
        probe.remove();
        return result;
      }
      for (const [lines, sign] of [
        [wrap(r.reagents), -1],
        [wrap(r.conditions), 1],
      ] as const)
        lines.forEach((text, i) => {
          const e = label(
            { x: center, y: a.y + sign * (18 + i * 18) },
            text,
            "var(--chemical-caption-font)",
          );
          e.setAttribute("data-label", `${prefix}${id}:condition:${sign}:${i}`);
          parent.append(e);
        });
      for (const p of [...r.reactants, ...r.products]) {
        const m = r.scene.molecules.find((m) => m.id === p.id)!;
        const parts = [
          p.equivalents !== undefined ? `${p.equivalents} eq` : "",
          p.yield !== undefined ? `${Number((p.yield * 100).toFixed(2))}%` : "",
          p.fraction !== undefined
            ? `${Number((p.fraction * 100).toFixed(2))}%`
            : "",
        ].filter(Boolean);
        if (parts.length) {
          const e = label(
            { x: m.at.x * B, y: r.scene.height * B - 14 },
            parts.join(" · "),
            "var(--chemical-caption-font)",
          );
          e.setAttribute("data-label", `${prefix}${p.id}:quantity`);
          parent.append(e);
        }
      }
    }
    if (entry.kind === "compound") {
      const l = reference.variant
        ? entry.variants?.[reference.variant]
        : entry.layout;
      if (!l) throw new Error("Unknown layout variant");
      const ps = Object.keys(l.coords).map(
        (id) => l.pins?.[id] ?? l.coords[id],
      );
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
      const minX = Math.min(...ps.map((p) => p.x)),
        maxX = Math.max(...ps.map((p) => p.x)),
        minY = Math.min(...ps.map((p) => p.y)),
        maxY = Math.max(...ps.map((p) => p.y));
      width = (maxX - minX + 3) * B;
      height = (maxY - minY + 3) * B;
      await molecule(
        entry,
        l,
        "compound",
        { x: 1.5 - minX, y: 1.5 - minY },
        0,
        false,
        reference.focus,
      );
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
        const vertical = Math.abs(rb.y - ra.y) > Math.abs(rb.x - ra.x);
        const p = vertical
          ? { x: ra.x, y: rb.y > ra.y ? ra.bottom + 8 : ra.top - 8 }
          : { x: rb.x > ra.x ? ra.right + 8 : ra.left - 8, y: ra.y };
        const q = vertical
          ? { x: rb.x, y: rb.y > ra.y ? rb.top - 8 : rb.bottom + 8 }
          : { x: rb.x > ra.x ? rb.left - 8 : rb.right + 8, y: rb.y };
        const middle = vertical
          ? `L${p.x} ${(p.y + q.y) / 2}L${q.x} ${(p.y + q.y) / 2}`
          : `L${(p.x + q.x) / 2} ${p.y}L${(p.x + q.x) / 2} ${q.y}`;
        svg.append(
          stroke(
            element("path", {
              d: `M${p.x} ${p.y}${middle}L${q.x} ${q.y}`,
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
