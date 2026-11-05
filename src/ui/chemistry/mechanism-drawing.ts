import type { ChemistryToolkit } from "./rdkit.ts";
import { drawMolecule } from "./depiction.ts";
import { abbreviatedGroups } from "../../../shared/molecule-abbreviations.ts";
import { moleculeBondLength } from "./drawing.ts";
import { rGroupLabel } from "../../../shared/reaction-scheme.ts";
import type { MechanismFrame } from "../../../shared/mechanism.ts";
import {
  anchorPoint,
  curvedArrow,
  edgeKey,
  interpolatePoint,
  type Geometry,
  type Point,
} from "../../../shared/mechanism-geometry.ts";

interface Ink {
  markup: string;
  atom?: number;
  edge?: [number, number];
  /** Coordinates in the final stage, used to transform each primitive. */
  points: Point[];
}
export interface MechanismDrawing extends Geometry {
  ink: Ink[];
  frame: MechanismFrame;
  arrows: { path: string; head: string; electrons: number; score: number }[];
  box: { x: number; y: number; width: number; height: number };
  markup: string;
}
const number = (n: number) => Math.round(n * 10000) / 10000;
/** Transform the position-bearing SVG attributes without changing ACS stroke or label size. */
function moveInk(markup: string, transform: (p: Point) => Point) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  );
  for (const node of [...doc.documentElement.children]) {
    if (node.hasAttribute("d"))
      node.setAttribute(
        "d",
        node
          .getAttribute("d")!
          .replace(/(-?[\d.]+)[, ]+(-?[\d.]+)/g, (_, x, y) => {
            const p = transform({ x: Number(x), y: Number(y) });
            return `${number(p.x)},${number(p.y)}`;
          }),
      );
    for (const [x, y] of [
      ["x", "y"],
      ["cx", "cy"],
    ])
      if (node.hasAttribute(x) && node.hasAttribute(y)) {
        const p = transform({
          x: Number(node.getAttribute(x)),
          y: Number(node.getAttribute(y)),
        });
        node.setAttribute(x, String(number(p.x)));
        node.setAttribute(y, String(number(p.y)));
      }
  }
  return [...doc.documentElement.children]
    .map((node) => node.outerHTML)
    .join("");
}
const colour = (source: number) => `var(--mechanism-source-${source % 4})`;
export function drawMechanismFrame(
  toolkit: ChemistryToolkit,
  frame: MechanismFrame,
  sources: Map<number, number>,
  initialBonds: Set<string>,
): MechanismDrawing {
  const atoms: MechanismDrawing["atoms"] = [],
    bonds: MechanismDrawing["bonds"] = [],
    ink: Ink[] = [];
  const scale = moleculeBondLength / 14.4;
  for (const m of frame.molecules) {
    const drawing = drawMolecule(toolkit, m.smiles, m.abbreviations);
    const xs = drawing.atoms.map((p) => p.x),
      ys = drawing.atoms.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const angle = ((m.rotation ?? 0) * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const transform = (p: Point) => ({
      x:
        ((p.x - cx) * c - (p.y - cy) * s) * scale +
        m.position.x * moleculeBondLength,
      y:
        ((p.x - cx) * s + (p.y - cy) * c) * scale +
        m.position.y * moleculeBondLength,
    });
    drawing.atoms.forEach((p, i) =>
      atoms.push({
        ...transform(p),
        map: m.atomMap[i],
        source: sources.get(m.atomMap[i])!,
      }),
    );
    drawing.bonds.forEach(([a, b], i) =>
      bonds.push({
        a: m.atomMap[a],
        b: m.atomMap[b],
        order: drawing.graph.bonds[i].bo ?? 1,
      }),
    );
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${drawing.markup}</svg>`,
      "image/svg+xml",
    );
    for (const node of [...doc.documentElement.children]) {
      const edgeIndex = [...node.classList].find((c) => /^bond-\d+$/.test(c));
      const indices = [...node.classList]
        .filter((c) => /^atom-\d+$/.test(c))
        .map((c) => Number(c.slice(5)));
      const edge: [number, number] | undefined = edgeIndex
        ? (drawing.bonds[Number(edgeIndex.slice(5))].map(
            (i) => m.atomMap[i],
          ) as [number, number])
        : undefined;
      const map = indices.length ? m.atomMap[indices[0]] : undefined;
      // Formal charges have their own circled journal glyphs below.
      if (
        node.tagName === "text" &&
        /^[+−-]+$|^\d+[+−-]$/.test(node.textContent ?? "")
      )
        continue;
      const isPartial =
        edge &&
        frame.partialBonds?.some(
          ([a, b]) => edgeKey(a, b) === edgeKey(...edge),
        );
      if (isPartial) continue;
      const src = map === undefined ? 0 : sources.get(map)!;
      const inkColour =
        edge && !initialBonds.has(edgeKey(...edge))
          ? "var(--accent)"
          : colour(src);
      const el = node as SVGElement;
      if (el.style.stroke && el.style.stroke !== "none")
        el.style.stroke = inkColour;
      if (
        el.style.fill &&
        el.style.fill !== "none" &&
        el.style.fill !== "#FFFFFF"
      )
        el.style.fill = inkColour;
      // Preserve document-unit stroke widths and type sizes when converting positions to screen units.
      if (el.style.strokeWidth)
        el.style.strokeWidth = String(parseFloat(el.style.strokeWidth) * scale);
      if (el.style.fontSize)
        el.style.fontSize = `${parseFloat(el.style.fontSize) * scale}px`;
      if (node.hasAttribute("rx"))
        node.setAttribute(
          "rx",
          String(Number(node.getAttribute("rx")) * scale),
        );
      if (node.hasAttribute("ry"))
        node.setAttribute(
          "ry",
          String(Number(node.getAttribute("ry")) * scale),
        );
      if (map !== undefined) node.setAttribute("data-map", String(map));
      node.setAttribute("data-source", String(src));
      if (edge) node.setAttribute("data-edge", edgeKey(...edge));
      ink.push({
        markup: moveInk(node.outerHTML, transform),
        atom: map,
        edge,
        points: edge
          ? edge.map((id) => atoms.find((a) => a.map === id)!)
          : map
            ? [atoms.find((a) => a.map === map)!]
            : [],
      });
    }
    drawing.graph.atoms.forEach((a: { chg?: number }, i: number) => {
      if (!a.chg || frame.partialCharges?.some((p) => p.atom === m.atomMap[i]))
        return;
      const atom = m.atomMap[i],
        p = atoms.find((a) => a.map === atom)!;
      ink.push({
        atom,
        points: [p],
        markup: `<text data-charge="${atom}" x="${p.x + 16.24}" y="${p.y - 16.24}" text-anchor="middle" dominant-baseline="central" style="font:16px Arial;fill:${colour(sources.get(atom)!)}">${Math.abs(a.chg) > 1 ? Math.abs(a.chg) : ""}${a.chg > 0 ? "⊕" : "⊖"}</text>`,
      });
    });
    for (const label of m.substituents ?? []) {
      const root = m.atomMap.indexOf(label.atoms[0]),
        p = transform(drawing.atoms[root]);
      const hidden = new Set(label.atoms);
      for (let i = ink.length - 1; i >= 0; i--)
        if (
          (ink[i].atom && hidden.has(ink[i].atom!)) ||
          ink[i].edge?.some((id) => hidden.has(id))
        )
          ink.splice(i, 1);
      const attach = atoms.find((a) => a.map === label.attachment)!;
      ink.push({
        edge: [label.attachment, label.atoms[0]],
        points: [attach, p],
        markup: `<path d="M ${attach.x},${attach.y} L ${p.x},${p.y}" style="stroke:${colour(sources.get(label.atoms[0])!)};stroke-width:${0.6 * scale};fill:none"/>`,
      });
      ink.push({
        atom: label.atoms[0],
        points: [p],
        markup: `<text x="${p.x}" y="${p.y + 6}" text-anchor="middle" style="font:19px Arial;fill:${colour(sources.get(label.atoms[0])!)}">${rGroupLabel(label.key)}</text>`,
      });
    }
  }
  const add = (markup: string, atom?: number) =>
    ink.push({
      markup,
      atom,
      points: atom ? [atoms.find((a) => a.map === atom)!] : [],
    });
  for (const lp of frame.lonePairs ?? []) {
    const p = atoms.find((a) => a.map === lp.atom)!,
      angle = (lp.angle * Math.PI) / 180;
    const x = p.x + Math.cos(angle) * moleculeBondLength * 0.48,
      y = p.y + Math.sin(angle) * moleculeBondLength * 0.48;
    add(
      [-1, 1]
        .map(
          (side) =>
            `<circle cx="${x - Math.sin(angle) * side * 2.2}" cy="${y + Math.cos(angle) * side * 2.2}" r="1.25" fill="${colour(p.source)}"/>`,
        )
        .join(""),
      lp.atom,
    );
  }
  for (const pc of frame.partialCharges ?? []) {
    const p = atoms.find((a) => a.map === pc.atom)!,
      angle = ((pc.angle ?? -45) * Math.PI) / 180;
    add(
      `<text data-partial-charge="${pc.atom}" x="${p.x + Math.cos(angle) * 19}" y="${p.y + Math.sin(angle) * 19}" style="font:16px Arial;fill:${colour(p.source)}">δ${pc.charge === "+" ? "+" : "−"}</text>`,
      pc.atom,
    );
  }
  for (const [a, b] of frame.partialBonds ?? []) {
    const p = atoms.find((p) => p.map === a)!,
      q = atoms.find((p) => p.map === b)!;
    ink.push({
      edge: [a, b],
      points: [p, q],
      markup: `<path data-partial-bond="${edgeKey(a, b)}" d="M ${p.x},${p.y} L ${q.x},${q.y}" style="stroke:var(--accent);stroke-width:${0.6 * scale};stroke-dasharray:4 3;fill:none"/>`,
    });
  }
  const geometry = { atoms, bonds };
  const arrows = frame.arrows.map((arrow) => {
    const a = anchorPoint(arrow.from, atoms, frame, moleculeBondLength),
      b = anchorPoint(arrow.to, atoms, frame, moleculeBondLength);
    const curve = curvedArrow(
      a,
      b,
      geometry,
      arrow.bend,
      moleculeBondLength * 0.4,
    );
    const dx = curve.b.x - curve.d.x,
      dy = curve.b.y - curve.d.y,
      length = Math.hypot(dx, dy) || 1;
    const u = { x: dx / length, y: dy / length },
      tip = curve.b,
      size = 6;
    const left = {
      x: tip.x - size * u.x - size * 0.45 * u.y,
      y: tip.y - size * u.y + size * 0.45 * u.x,
    };
    const right = {
      x: tip.x - size * u.x + size * 0.45 * u.y,
      y: tip.y - size * u.y - size * 0.45 * u.x,
    };
    return {
      path: curve.path,
      head:
        arrow.electrons === 1
          ? `M ${left.x} ${left.y} L ${tip.x} ${tip.y}`
          : `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y}`,
      electrons: arrow.electrons,
      score: curve.score,
    };
  });
  const visible = ink.flatMap((i) => i.points);
  const curvePoints = arrows.flatMap((a) =>
    [...a.path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    })),
  );
  const xs = [...visible, ...curvePoints].map((a) => a.x),
    ys = [...visible, ...curvePoints].map((a) => a.y);
  const box = {
    x: Math.min(...xs) - 24,
    y: Math.min(...ys) - 24,
    width: Math.max(...xs) - Math.min(...xs) + 48,
    height: Math.max(...ys) - Math.min(...ys) + 48,
  };
  if (frame.transitionState) {
    const x = box.x + 12,
      y = box.y + 12,
      w = box.width - 24,
      h = box.height - 24;
    add(
      `<path data-transition-bracket="true" d="M ${x + 8},${y} L ${x},${y} L ${x},${y + h} L ${x + 8},${y + h} M ${x + w - 8},${y} L ${x + w},${y} L ${x + w},${y + h} L ${x + w - 8},${y + h}" style="stroke:var(--ink);stroke-width:1.2;fill:none"/><text x="${x + w + 3}" y="${y}" style="font:20px Arial;fill:var(--ink)">‡</text>`,
    );
  }
  return {
    ...geometry,
    ink,
    frame,
    arrows,
    box,
    markup: ink.map((i) => i.markup).join(""),
  };
}
function transformPrimitive(ink: Ink, positions: Map<number, Point>) {
  if (ink.edge) {
    const [a, b] = ink.points,
      [p, q] = ink.edge.map((id) => positions.get(id));
    if (!p || !q) return ink.markup;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = dx * dx + dy * dy || 1;
    return moveInk(ink.markup, (r) => {
      const along = ((r.x - a.x) * dx + (r.y - a.y) * dy) / len,
        across = (-(r.x - a.x) * dy + (r.y - a.y) * dx) / len;
      return {
        x: p.x + along * (q.x - p.x) - across * (q.y - p.y),
        y: p.y + along * (q.y - p.y) + across * (q.x - p.x),
      };
    });
  }
  if (ink.atom) {
    const a = ink.points[0],
      p = positions.get(ink.atom);
    if (p)
      return moveInk(ink.markup, (q) => ({
        x: q.x + p.x - a.x,
        y: q.y + p.y - a.y,
      }));
  }
  return ink.markup;
}
/** Exact endpoint reuse makes the result byte-identical to the target's static drawing. */
export function transitionMarkup(
  a: MechanismDrawing,
  b: MechanismDrawing,
  t: number,
) {
  if (t <= 0) return a.markup;
  if (t >= 1) return b.markup;
  const start = new Map(a.atoms.map((p) => [p.map, p])),
    end = new Map(b.atoms.map((p) => [p.map, p]));
  const positions = new Map<number, Point>();
  for (const id of new Set([...start.keys(), ...end.keys()]))
    positions.set(
      id,
      interpolatePoint(
        start.get(id) ?? end.get(id)!,
        end.get(id) ?? start.get(id)!,
        t,
      ),
    );
  const sourceEdges = new Set(
    a.ink.flatMap((i) => (i.edge ? [edgeKey(...i.edge)] : [])),
  );
  const targetEdges = new Set(
    b.ink.flatMap((i) => (i.edge ? [edgeKey(...i.edge)] : [])),
  );
  const markup: string[] = [];
  for (const ink of a.ink)
    if (
      (ink.edge && !targetEdges.has(edgeKey(...ink.edge))) ||
      (ink.atom && !end.has(ink.atom))
    )
      markup.push(
        `<g opacity="${1 - t}">${transformPrimitive(ink, positions)}</g>`,
      );
  for (const ink of b.ink) {
    const fresh = ink.edge && !sourceEdges.has(edgeKey(...ink.edge));
    if (fresh)
      markup.push(
        `<g opacity="${t}" style="stroke-dasharray:1000;stroke-dashoffset:${(1 - t) * 1000}">${transformPrimitive(ink, positions)}</g>`,
      );
    else
      markup.push(
        `<g opacity="${ink.atom && !start.has(ink.atom) ? t : 1}">${transformPrimitive(ink, positions)}</g>`,
      );
  }
  return markup.join("");
}

/** Cycle intermediates use the shared terminal-group whitelist to keep a ring readable. */
export function compactCycleFrame(
  toolkit: ChemistryToolkit,
  frame: MechanismFrame,
  id: string,
) {
  const original = frame.molecules.find((m) => m.id === id)!;
  const m = {
    ...original,
    position: { x: 0, y: 0 },
    abbreviations: [...(original.abbreviations ?? [])],
  };
  const mol = toolkit.get_mol(m.smiles)!;
  try {
    try {
      if (
        abbreviatedGroups(toolkit, mol, ["Ph"]).length &&
        !m.abbreviations.includes("Ph")
      )
        m.abbreviations.push("Ph");
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !e.message.includes("no non-overlapping terminal group")
      )
        throw e;
    }
  } finally {
    mol.delete();
  }
  const maps = new Set(m.atomMap);
  return {
    ...frame,
    molecules: [m],
    arrows: [],
    lonePairs: frame.lonePairs?.filter((a) => maps.has(a.atom)),
    partialCharges: frame.partialCharges?.filter((a) => maps.has(a.atom)),
    partialBonds: frame.partialBonds?.filter((a) =>
      a.every((id) => maps.has(id)),
    ),
  };
}
