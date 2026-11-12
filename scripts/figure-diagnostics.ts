import type { FigureGeometry } from "../shared/chemical-library/geometry.ts";
import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";
import { figureGeometryDiagnostics } from "../src/ui/library/geometry-diagnostics.ts";

/** The desktop proof and creation tools share one explicit viewport scale. */
export function diagnoseFigure(
  geometry: FigureGeometry,
  style: FigureStyle,
  width = 1366,
) {
  return figureGeometryDiagnostics(
    geometry,
    style,
    Math.max(geometry.minimumScale, Math.min(1, (width - 48) / geometry.width)),
  );
}
