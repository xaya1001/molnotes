import { rGroupLabel } from "../../../shared/reaction-scheme.ts";
import { mappedDummies } from "../../../shared/reaction-chemistry.ts";
import { molecule, type ChemistryToolkit } from "./rdkit.ts";
import {
  abbreviatedGroups,
  type MoleculeAbbreviation,
} from "../../../shared/molecule-abbreviations.ts";
import {
  moleculeDrawingOptions,
  moleculeSvg,
  labelAbbreviations,
  padAtomLabels,
} from "./drawing.ts";

type Point = { x: number; y: number };
export function drawMolecule(
  toolkit: ChemistryToolkit,
  smiles: string,
  abbreviations: readonly MoleculeAbbreviation[] = [],
) {
  const mol = molecule(toolkit, smiles);
  try {
    const count = mol.get_num_atoms();
    const groups = abbreviatedGroups(toolkit, mol, abbreviations);
    const folded = new Set(groups.flatMap((group) => group.atoms));
    const hiddenBonds = new Set(groups.flatMap((group) => group.bonds));
    const atomLabels: Record<number, string> = {};
    const rGroups = mappedDummies(mol).filter((group) => group.map);
    for (const { atom } of rGroups) atomLabels[atom] = "R";
    for (const group of groups) {
      for (const atom of group.atoms) atomLabels[atom] = "";
      // Reserve a single attachment glyph; the full abbreviation is placed
      // using the visible bond direction after the folded drawing is removed.
      atomLabels[group.atoms[0]] = "C";
    }
    const markup = moleculeSvg(mol, {
      atomLabels,
      atoms: Array.from({ length: count }, (_, i) => i),
      bonds: [],
      highlightRadius: 0.25,
      atomHighlightsAreCircles: true,
    });
    const document = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (document.querySelector("parsererror"))
      throw new Error("RDKit 结构绘图失败");
    // MinimalLib splits UTF-8 superscripts into separate glyphs. Give it an
    // ASCII label for placement, then let the browser draw the journal label.
    for (const { atom, map } of rGroups) {
      const label = document.querySelector(`text.atom-${atom}`);
      if (label) label.textContent = rGroupLabel(map);
    }
    const points: Point[] = [];
    for (let i = 0; i < count; i++) {
      const ellipse = document.querySelector(`ellipse.atom-${i}`);
      if (!ellipse) throw new Error(`RDKit 缺少原子 ${i} 的坐标`);
      points.push({
        x: Number(ellipse.getAttribute("cx")),
        y: Number(ellipse.getAttribute("cy")),
      });
      ellipse.remove();
    }
    const graph = JSON.parse(mol.get_json());
    const edges: [number, number][] = [];
    for (const bond of graph.molecules[0].bonds) {
      if (
        !Array.isArray(bond.atoms) ||
        bond.atoms.length !== 2 ||
        !bond.atoms.every(
          (i: unknown) =>
            typeof i === "number" && Number.isInteger(i) && i >= 0 && i < count,
        )
      )
        throw new Error("RDKit 键索引无效");
      edges.push([bond.atoms[0], bond.atoms[1]]);
    }
    // Keep the original graph for stereochemistry and indices. Only the
    // declared terminal group's drawing is replaced by its attachment label.
    for (const index of hiddenBonds)
      document
        .querySelectorAll(`.bond-${index}`)
        .forEach((node) => node.remove());
    for (const group of groups)
      for (const index of group.atoms.slice(1))
        document
          .querySelectorAll(`.atom-${index}`)
          .forEach((node) => node.remove());
    // RDKit's untagged corner joins also belong to the folded graph.
    for (const path of document.querySelectorAll<SVGPathElement>(
      "path:not([class])",
    )) {
      const vertices = [
        ...(path.getAttribute("d") ?? "").matchAll(
          /[ML]\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g,
        ),
      ];
      if (vertices.length !== 3) continue;
      const x = Number(vertices[1][1]),
        y = Number(vertices[1][2]);
      if (
        [...folded].some(
          (i) => Math.hypot(points[i].x - x, points[i].y - y) < 0.15,
        )
      )
        path.remove();
    }
    labelAbbreviations(document, groups, points, graph.molecules[0].atoms);
    document.querySelectorAll<SVGTextElement>("text").forEach((node) => {
      node.style.fontFamily = "Arial, Helvetica, sans-serif";
    });
    // RDKit ties wedge width to the multiple-bond offset. ACS specifies
    // 2 pt wedges separately; narrow only their perpendicular coordinates.
    edges.forEach(([a, b], i) => {
      if ((graph.molecules[0].bonds[i].bo ?? 1) !== 1) return;
      const paths = [
        ...document.querySelectorAll<SVGPathElement>(`path.bond-${i}`),
      ];
      const solid = paths.some(
        (path) => path.style.fill && path.style.fill !== "none",
      );
      if (!solid && paths.length < 3) return;
      const start = points[a],
        end = points[b];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!length) return;
      const ux = (end.x - start.x) / length,
        uy = (end.y - start.y) / length;
      const factor = 2 / 14.4 / moleculeDrawingOptions.multipleBondOffset;
      for (const path of paths) {
        path.setAttribute(
          "d",
          (path.getAttribute("d") ?? "").replace(
            /([ML])\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g,
            (_, command: string, x: string, y: string) => {
              const dx = Number(x) - start.x,
                dy = Number(y) - start.y;
              const along = dx * ux + dy * uy,
                across = (-dx * uy + dy * ux) * factor;
              return `${command} ${start.x + along * ux - across * uy},${start.y + along * uy + across * ux}`;
            },
          ),
        );
      }
    });
    padAtomLabels(document, points);
    document.querySelector("rect")?.remove();
    return {
      markup: document.documentElement.innerHTML,
      atoms: points,
      bonds: edges,
      folded,
      graph: graph.molecules[0],
    };
  } finally {
    mol.delete();
  }
}
