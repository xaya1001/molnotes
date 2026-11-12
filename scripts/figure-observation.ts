import type {
  FigureMatrix,
  FigureObservation,
} from "../shared/chemical-library/geometry.ts";
import type { Point, Diagnostic } from "../shared/chemical-library/types.ts";
import { observationKey } from "../src/ui/library/geometry-observation.ts";
import { transformPath } from "../src/ui/library/path-geometry.ts";
import { plainPaint } from "../src/ui/library/geometry-tree.ts";
import { nativePaint } from "../src/ui/library/native-geometry.ts";

/** Browser-only reference measurement for the migration comparison command. */
export function browserFigureObservation(
  svg: SVGSVGElement,
  atoms: Record<string, Point>,
  minimumScale: number,
  diagnostics: Diagnostic[],
): FigureObservation {
  const outer = svg.getBoundingClientRect();
  const scale = outer.width / svg.viewBox.baseVal.width;
  const inverse = svg.getScreenCTM()!.inverse();
  const counts = new Map<string, number>();
  const elements: FigureObservation["elements"] = [];
  for (const element of svg.querySelectorAll<SVGGraphicsElement>(
    "[data-label],[data-bond],[data-electron-arrow],[data-arrow-head],[data-reaction-arrow],[data-reaction-head],[data-route-edge]",
  )) {
    const ids = Object.fromEntries(
      Object.entries(element.dataset).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const key = observationKey(element.tagName, ids, counts)!;
    const box = element.getBoundingClientRect();
    const m = inverse.multiply(element.getScreenCTM()!);
    const matrix: FigureMatrix = [m.a, m.b, m.c, m.d, m.e, m.f];
    const d = element.getAttribute("d");
    const style = getComputedStyle(element);
    const paint = nativePaint(
      {
        fill: style.fill,
        stroke: style.stroke,
        "stroke-width": style.strokeWidth,
        opacity: style.opacity,
        "fill-opacity": style.fillOpacity,
        "stroke-opacity": style.strokeOpacity,
        "fill-rule": style.fillRule,
        "stroke-linecap": style.strokeLinecap,
        "stroke-linejoin": style.strokeLinejoin,
        "stroke-miterlimit": style.strokeMiterlimit,
        "stroke-dasharray": style.strokeDasharray,
      },
      plainPaint(),
    );
    const bounds = {
      x: (box.x - outer.x) / scale,
      y: (box.y - outer.y) / scale,
      width: box.width / scale,
      height: box.height / scale,
    };
    let points: Point[] | undefined;
    if (element instanceof SVGPathElement) {
      const length = element.getTotalLength();
      const count = Math.max(2, Math.ceil(length / 1.5));
      points = length
        ? Array.from({ length: count + 1 }, (_, i) => {
            const p = element
              .getPointAtLength((length * i) / count)
              .matrixTransform(m);
            return { x: p.x, y: p.y };
          })
        : [];
    }
    elements.push({
      key,
      ids,
      bounds,
      paint,
      ...(d !== null ? { path: transformPath(d, matrix), points } : {}),
    });
  }
  return {
    width: svg.viewBox.baseVal.width,
    height: svg.viewBox.baseVal.height,
    minimumScale,
    atoms,
    elements,
    diagnostics,
  };
}
