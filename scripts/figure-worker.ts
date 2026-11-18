import { parentPort, workerData } from "node:worker_threads";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { prepareCardRoutes } from "./figure-card-routes.ts";
import { chemicalCardWidths } from "../src/ui/library/card-layout.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { parseFigureStyle } from "../src/ui/library/scene-geometry.ts";
import { diagnoseFigure } from "./figure-diagnostics.ts";
import type {
  Library,
  FigureReference,
} from "../shared/chemical-library/types.ts";
import type { FigureGeometry } from "../shared/chemical-library/geometry.ts";
export type FigureWork =
  | { kind: "prepare"; library: Library; reference: FigureReference }
  | { kind: "diagnose"; geometry: FigureGeometry };
if (typeof workerData?.css !== "string")
  throw new Error("Figure worker requires chemical style input");
const style = parseFigureStyle(workerData.css);
parentPort!.on("message", async (work: FigureWork) => {
  try {
    const value =
      work.kind === "prepare"
        ? await prepare(work.library, work.reference)
        : diagnoseFigure(work.geometry, style);
    parentPort!.postMessage({ ok: true, value });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

async function prepare(library: Library, reference: FigureReference) {
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
