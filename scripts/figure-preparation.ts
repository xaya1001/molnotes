import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { chemicalCardWidths } from "../src/ui/library/card-layout.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import {
  drawnArrows,
  graphPanels,
} from "../shared/chemical-library/figure-layout.ts";
import { compileGraphLayout } from "./figure-route.ts";
import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";
import type {
  Library,
  FigureReference,
} from "../shared/chemical-library/types.ts";

export async function prepareLibraryFigure(
  library: Library,
  reference: FigureReference,
  style: FigureStyle,
) {
  const options = {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style,
  };
  const entry = library[reference.ref];
  if (entry.kind === "figure") {
    const arrows = drawnArrows(entry.graph);
    const cardWidths =
      !reference.frame && !arrows.length && graphPanels(entry.graph).length > 1
        ? chemicalCardWidths
        : undefined;
    const geometry = await prepareFigure(library, reference, {
      ...options,
      cardWidths,
    });
    if (!reference.frame && arrows.length) {
      geometry.cardPlans = [];
      const cards = await compileGraphLayout(library, entry, style, {
        card: reference,
      });
      for (const { graph, width, rows, scale } of cards) {
        const drawing = await prepareFigure(library, reference, {
          ...options,
          graph,
          cardWidth: width,
          cardScale: scale,
        });
        geometry.cardPlans.push({ width, rows, scale, geometry: drawing });
      }
    }
    return geometry;
  }
  return prepareFigure(library, reference, options);
}
