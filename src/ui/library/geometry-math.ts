import type { Point } from "../../../shared/chemical-library/types.ts";
import type {
  FigureBox,
  FigureRect,
  FigureMatrix,
} from "../../../shared/chemical-library/geometry.ts";

export const identityMatrix = (): FigureMatrix => [1, 0, 0, 1, 0, 0];

export function multiplyMatrix(a: FigureMatrix, b: FigureMatrix): FigureMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function inverseMatrix(m: FigureMatrix): FigureMatrix {
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (determinant === 0) throw new Error("Singular figure transform");
  return [
    m[3] / determinant,
    -m[1] / determinant,
    -m[2] / determinant,
    m[0] / determinant,
    (m[2] * m[5] - m[3] * m[4]) / determinant,
    (m[1] * m[4] - m[0] * m[5]) / determinant,
  ];
}

export function transformPoint(p: Point, m: FigureMatrix): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export function pointsBox(points: readonly Point[]): FigureBox | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBoxes(
  boxes: readonly (FigureBox | null)[],
): FigureBox | null {
  return pointsBox(
    boxes.flatMap((b) =>
      b
        ? [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
          ]
        : [],
    ),
  );
}

/** Transform all four corners, including reflected or rotated local boxes. */
export function transformBox(box: FigureBox | null, matrix: FigureMatrix) {
  return (
    box &&
    pointsBox(
      [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x, y: box.y + box.height },
        { x: box.x + box.width, y: box.y + box.height },
      ].map((p) => transformPoint(p, matrix)),
    )
  );
}

export function rectangle(
  x: number,
  y: number,
  width: number,
  height: number,
): FigureRect {
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}
