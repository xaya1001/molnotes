import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { prepareCardRoutes } from "./figure-card-routes.ts";
import { chemicalCardWidths } from "../src/ui/library/card-layout.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
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
  const geometry = await prepareFigure(library, reference, options);
  const entry = library[reference.ref];
  const routes = await prepareCardRoutes(library, reference, style);
  if (routes) {
    geometry.cardPlans = [];
    for (const { route, width, rows, scale } of routes) {
      const drawing = await prepareFigure(library, reference, {
        ...options,
        cardWidth: width,
        cardScale: scale,
        cardRoute: route,
      });
      geometry.cardPlans.push({ width, rows, scale, geometry: drawing });
    }
  } else if (
    entry.kind === "mechanism" &&
    !reference.frame &&
    entry.frames.length > 1
  ) {
    geometry.cardPlans = [];
    for (const width of chemicalCardWidths) {
      const drawing = await prepareFigure(library, reference, {
        ...options,
        cardWidth: width,
      });
      geometry.cardPlans.push({
        width,
        ...drawing.cardPlan!,
        geometry: drawing,
      });
    }
  }
  return geometry;
}
