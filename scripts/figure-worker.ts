import { parentPort, workerData } from "node:worker_threads";
import { prepareLibraryFigure } from "./figure-preparation.ts";
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
        ? await prepareLibraryFigure(work.library, work.reference, style)
        : diagnoseFigure(work.geometry, style);
    parentPort!.postMessage({ ok: true, value });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
