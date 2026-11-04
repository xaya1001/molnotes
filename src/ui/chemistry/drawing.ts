import type { MoleculeHandle } from "./rdkit.ts";
// Draw in ACS document units, then use one screen scale for every consumer.
// 14.4 -> 21.6 px bonds, 10 -> 15 px labels, 0.6 -> 0.9 px strokes.
export const moleculeScreenScale = 1.5;
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
  additionalAtomLabelPadding: 0.066,
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
