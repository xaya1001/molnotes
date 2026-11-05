import type { AbbreviatedGroup } from "../../../shared/molecule-abbreviations.ts";
import type { MoleculeHandle } from "./rdkit.ts";
// Draw in ACS document units, then use one screen scale for every consumer.
// This is the one screen-size setting; all ACS proportions follow it.
export const moleculeBondLength = 28;
export const moleculeScreenScale = moleculeBondLength / 14.4;
// Retain the previous arrow-to-bond ratio in the new drawing coordinates.
export const electronArrowLineWidth = 2 * (14.4 / 42);
export const moleculeDrawingOptions = {
  fixedBondLength: 14.4 / 1.5,
  scalingFactor: 14.4 / 1.5,
  bondLineWidth: 0.6,
  scaleBondWidth: false,
  multipleBondOffset: 0.18,
  fixedFontSize: 10,
  noFreetype: true,
  atomColourPalette: "bw",
  atomNoteColour: [0, 0, 0],
  bondNoteColour: [0, 0, 0],
  // Request a 1.6 pt margin; padAtomLabels accounts for actual Arial metrics.
  additionalAtomLabelPadding: 1.6 / (14.4 / 1.5) - 0.033 * 1.5,
  singleColourWedgeBonds: true,
  useMolBlockWedging: true,
  addStereoAnnotation: true,
  annotationFontScale: 0.6,
} as const;

/** A fixed canvas with room for labels prevents RDKit's flexicanvas fitting from changing scale. */
export function moleculeSvg(
  mol: MoleculeHandle,
  options: Record<string, unknown> = {},
) {
  if (mol.normalize_depiction(0, -1) < 0) {
    mol.set_new_coords();
    mol.normalize_depiction(0, -1);
  }
  const graph: {
    molecules: { conformers: { coords: [number, number][] }[] }[];
  } = JSON.parse(mol.get_json());
  const points = graph.molecules[0].conformers[0].coords;
  const extent = (axis: 0 | 1) => {
    const values = points.map((point) => point[axis]);
    return Math.ceil(
      (Math.max(...values) - Math.min(...values)) *
        moleculeDrawingOptions.scalingFactor +
        80,
    );
  };
  return mol.get_svg_with_highlights(
    JSON.stringify({
      ...moleculeDrawingOptions,
      width: extent(0),
      height: extent(1),
      ...options,
    }),
  );
}

type Point = { x: number; y: number };
type Atom = { z?: number; impHs?: number; chg?: number; isotope?: number };
const reversedLabels: Record<string, string> = {
  "CO₂Me": "MeO₂C",
  "CO₂Et": "EtO₂C",
  "CO₂tBu": "tBuO₂C",
  OMe: "MeO",
  OEt: "EtO",
  "CF₃": "F₃C",
};

/** Place an abbreviation on its attachment glyph using actual font metrics. */
export function labelAbbreviations(
  svg: Document,
  groups: readonly AbbreviatedGroup[],
  atoms: readonly Point[],
  elements: readonly Atom[],
) {
  if (!groups.length) return;
  const context = globalThis.document.createElement("canvas").getContext("2d")!;
  context.font = `${moleculeDrawingOptions.fixedFontSize}px Arial, Helvetica, sans-serif`;
  for (const group of groups) {
    if (group.name === "LnPd") {
      const p = atoms[group.attachment];
      svg
        .querySelectorAll(`text.atom-${group.attachment}`)
        .forEach((node) => node.remove());
      const text = svg.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("class", `atom-${group.attachment} abbreviation-label`);
      text.setAttribute("data-abbreviation", "LnPd");
      text.setAttribute("x", String(p.x - 10));
      text.setAttribute("y", String(p.y + 3.5));
      text.setAttribute(
        "style",
        "font-size:10px;font-family:Arial,Helvetica,sans-serif;fill:#000000;stroke:none",
      );
      text.textContent = "LₙPd";
      svg.documentElement.append(text);
      continue;
    }
    const root = group.atoms[0],
      attachment = group.attachment;
    svg.querySelectorAll(`text.atom-${root}`).forEach((node) => node.remove());
    const element = elements[attachment];
    const symbol = ({ 7: "N", 8: "O", 16: "S" } as Record<number, string>)[
      element.z ?? 6
    ];
    const merge =
      symbol &&
      !element.chg &&
      !element.isotope &&
      groups.filter((item) => item.attachment === attachment).length === 1;
    const atom = merge ? attachment : root;
    const point = atoms[atom];
    const right = atoms[root].x >= atoms[attachment].x;
    let label: string, prefix: string, glyph: string;
    if (merge) {
      const hydrogen = element.impHs
        ? `H${element.impHs > 1 ? String(element.impHs).replace(/[0-9]/g, (c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)]) : ""}`
        : "";
      prefix = right ? "" : group.name + hydrogen;
      glyph = symbol;
      label = right ? symbol + hydrogen + group.name : prefix + symbol;
      svg
        .querySelectorAll(`.bond-${group.bond}`)
        .forEach((node) => node.remove());
    } else {
      label = right ? group.name : (reversedLabels[group.name] ?? group.name);
      glyph = right ? label[0] : label.at(-1)!;
      prefix = right ? "" : label.slice(0, -1);
    }
    svg.querySelectorAll(`text.atom-${atom}`).forEach((node) => node.remove());
    const anchor = context.measureText(glyph);
    const x = point.x - context.measureText(prefix).width - anchor.width / 2;
    const y =
      point.y +
      (anchor.actualBoundingBoxAscent - anchor.actualBoundingBoxDescent) / 2;
    const text = svg.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", `atom-${atom} abbreviation-label`);
    text.setAttribute("data-abbreviation", group.name);
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute(
      "style",
      `font-size:10px;font-family:Arial,Helvetica,sans-serif;fill:#000000;stroke:none`,
    );
    text.textContent = label;
    svg.documentElement.append(text);
  }
}

/** MinimalLib's text metrics differ from Arial. Trim bonds against the actual glyphs. */
export function padAtomLabels(svg: Document, atoms: readonly Point[]) {
  const context = globalThis.document.createElement("canvas").getContext("2d")!;
  type Rect = { left: number; right: number; top: number; bottom: number };
  const rectangles = new Map<number, Rect>();
  for (const text of svg.querySelectorAll<SVGTextElement>(
    "text[class*='atom-']",
  )) {
    const index = Number(
      [...text.classList].find((name) => /^atom-\d+$/.test(name))?.slice(5),
    );
    context.font = `${text.style.fontSize} Arial, Helvetica, sans-serif`;
    const m = context.measureText(text.textContent ?? "");
    const x = Number(text.getAttribute("x")),
      y = Number(text.getAttribute("y"));
    const b = {
      left: x - m.actualBoundingBoxLeft - 1.6,
      right: x + m.actualBoundingBoxRight + 1.6,
      top: y - m.actualBoundingBoxAscent - 1.6,
      bottom: y + m.actualBoundingBoxDescent + 1.6,
    };
    const previous = rectangles.get(index);
    rectangles.set(
      index,
      previous
        ? {
            left: Math.min(previous.left, b.left),
            right: Math.max(previous.right, b.right),
            top: Math.min(previous.top, b.top),
            bottom: Math.max(previous.bottom, b.bottom),
          }
        : b,
    );
  }
  const inside = (p: Point, b: Rect) =>
    p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
  const clip = (p: Point, q: Point, rect: Rect) => {
    const dx = q.x - p.x,
      dy = q.y - p.y;
    const tx =
      dx > 0
        ? (rect.right - p.x) / dx
        : dx < 0
          ? (rect.left - p.x) / dx
          : Infinity;
    const ty =
      dy > 0
        ? (rect.bottom - p.y) / dy
        : dy < 0
          ? (rect.top - p.y) / dy
          : Infinity;
    const t = Math.min(tx, ty);
    return { x: p.x + dx * t, y: p.y + dy * t };
  };
  for (const path of svg.querySelectorAll<SVGPathElement>(
    "path[class*='bond-']",
  )) {
    const indices = [...path.classList]
      .filter((c) => /^atom-\d+$/.test(c))
      .map((c) => Number(c.slice(5)));
    const labelAtoms = indices.filter((i) => rectangles.has(i));
    if (!labelAtoms.length) continue;
    const vertices = [
      ...(path.getAttribute("d") ?? "").matchAll(
        /[ML]\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g,
      ),
    ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    if (
      vertices.length === 2 &&
      labelAtoms.some((i) =>
        vertices.every((p) => inside(p, rectangles.get(i)!)),
      )
    ) {
      path.remove();
      continue;
    }
    let vertex = 0;
    path.setAttribute(
      "d",
      (path.getAttribute("d") ?? "").replace(
        /([ML])\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g,
        (_, command: string, x: string, y: string) => {
          let point = { x: Number(x), y: Number(y) };
          const opposite =
            vertices.length === 2 ? vertices[1 - vertex] : undefined;
          vertex++;
          for (const i of labelAtoms) {
            const rect = rectangles.get(i)!;
            if (inside(point, rect))
              point = clip(
                point,
                opposite ?? atoms[indices.find((other) => other !== i)!],
                rect,
              );
          }
          return `${command} ${point.x},${point.y}`;
        },
      ),
    );
  }
}
