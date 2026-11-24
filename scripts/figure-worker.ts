import { parentPort, workerData } from "node:worker_threads";
import { prepareLibraryFigure } from "./figure-preparation.ts";
import { parseFigureStyle } from "../src/ui/library/scene-geometry.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { diagnoseFigure } from "./figure-diagnostics.ts";
import { sha256 } from "../shared/assets.ts";
import {
  stableFigureValue,
  geometryKeyOmit,
} from "./content/figure-proof-cache.ts";
import type {
  Library,
  FigureReference,
  Diagnostic,
} from "../shared/chemical-library/types.ts";
import type { FigureGeometry } from "../shared/chemical-library/geometry.ts";
export type FigureWork =
  | { kind: "prepare"; library: Library; reference: FigureReference }
  | { kind: "diagnose"; geometry: FigureGeometry };
export interface PreparedWorkerResult {
  svg: string;
  geometryBytes: Uint8Array;
  geometryKey: string;
  width: number;
  height: number;
  minimumScale: number;
  diagnostics: Diagnostic[];
}
if (typeof workerData?.css !== "string")
  throw new Error("Figure worker requires chemical style input");
const style = parseFigureStyle(workerData.css);
const encoder = new TextEncoder();
parentPort!.on("message", async (work: FigureWork) => {
  try {
    if (work.kind === "prepare") {
      const geometry = await prepareLibraryFigure(
        work.library,
        work.reference,
        style,
      );
      const svg = geometrySvg(geometry);
      const diagnostics = diagnoseFigure(geometry, style);
      const geometryBytes = encoder.encode(stableFigureValue(geometry));
      const geometryKey = sha256(stableFigureValue(geometry, geometryKeyOmit));
      const value: PreparedWorkerResult = {
        svg,
        geometryBytes,
        geometryKey,
        width: geometry.width,
        height: geometry.height,
        minimumScale: geometry.minimumScale,
        diagnostics,
      };
      parentPort!.postMessage({ ok: true, value }, [geometryBytes.buffer]);
    } else {
      const value = diagnoseFigure(work.geometry, style);
      parentPort!.postMessage({ ok: true, value });
    }
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
