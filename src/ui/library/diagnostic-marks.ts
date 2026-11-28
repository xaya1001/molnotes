import type {
  Diagnostic,
  Point,
} from "../../../shared/chemical-library/types.ts";
import type {
  FigureBox,
  FigureGeometry,
  FigureObservation,
} from "../../../shared/chemical-library/geometry.ts";
import { unionBoxes } from "./geometry-math.ts";
import { geometryObservation } from "./geometry-observation.ts";

const MARK_PADDING = 3;
const MARK_RADIUS = 4;
const MARK_STROKE_WIDTH = 1.5;
const POINT_CIRCLE_RADIUS = 8;
const ATOM_BOX_HALF = 4;
const BADGE_HEIGHT = 13;
const BADGE_FONT_SIZE = 9;
const MARK_COLOR = "var(--danger, #a3322a)";

const IDENTITY_KEYS = [
  "label",
  "bond",
  "electronArrow",
  "arrowHead",
  "reactionArrow",
  "reactionHead",
  "routeEdge",
  "enclose",
  "chargeOwner",
] as const;

export interface DiagnosticMarkOptions {
  /** Viewport scale used when diagnostics were computed (for scaling `at`). */
  scale?: number;
}

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );

const num = (value: number) => String(Math.round(value * 100) / 100);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveBoxes(
  observation: FigureObservation,
  boxesById: Map<string, FigureBox[]>,
  elements: readonly string[],
): FigureBox | null {
  const matched: FigureBox[] = [];
  for (const id of elements) {
    const direct = boxesById.get(id);
    if (direct) {
      matched.push(...direct);
      continue;
    }
    const atom: Point | undefined = observation.atoms[id];
    if (atom) {
      matched.push({
        x: atom.x - ATOM_BOX_HALF,
        y: atom.y - ATOM_BOX_HALF,
        width: ATOM_BOX_HALF * 2,
        height: ATOM_BOX_HALF * 2,
      });
      continue;
    }
    const prefix = `${id}:`;
    for (const element of observation.elements) {
      if (
        element.ids.bond?.startsWith(prefix) ||
        element.ids.label?.startsWith(prefix)
      )
        matched.push(element.bounds);
    }
  }
  return unionBoxes(matched);
}

function badgeSvg(
  label: string,
  anchorX: number,
  anchorY: number,
  viewWidth: number,
  viewHeight: number,
) {
  const width = Math.max(BADGE_HEIGHT, 8 + label.length * 5);
  const x = clamp(anchorX, 1, Math.max(1, viewWidth - width - 1));
  const y = clamp(anchorY, 1, Math.max(1, viewHeight - BADGE_HEIGHT - 1));
  const cx = x + width / 2;
  const cy = y + BADGE_HEIGHT / 2;
  return (
    `<g class="diagnostic-mark-badge">` +
    `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${BADGE_HEIGHT}" rx="${num(BADGE_HEIGHT / 2)}" ry="${num(BADGE_HEIGHT / 2)}" fill="${MARK_COLOR}"/>` +
    `<text x="${num(cx)}" y="${num(cy)}" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="${BADGE_FONT_SIZE}" font-weight="700" text-anchor="middle" dominant-baseline="central">${escapeXml(label)}</text>` +
    `</g>`
  );
}

export function diagnosticMarksLayer(
  geometry: FigureGeometry | FigureObservation,
  diagnostics: readonly Diagnostic[],
  options: DiagnosticMarkOptions = {},
): string {
  if (!diagnostics.length) return "";
  const observation =
    "root" in geometry ? geometryObservation(geometry) : geometry;
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const boxesById = new Map<string, FigureBox[]>();
  for (const element of observation.elements) {
    for (const key of IDENTITY_KEYS) {
      const id = element.ids[key];
      if (!id) continue;
      const list = boxesById.get(id);
      if (list) list.push(element.bounds);
      else boxesById.set(id, [element.bounds]);
    }
  }
  const items: string[] = [];
  for (let index = 0; index < diagnostics.length; index++) {
    const diagnostic = diagnostics[index];
    const label = String(index + 1);
    const box = resolveBoxes(observation, boxesById, diagnostic.elements);
    if (box) {
      const x = box.x - MARK_PADDING;
      const y = box.y - MARK_PADDING;
      const width = box.width + MARK_PADDING * 2;
      const height = box.height + MARK_PADDING * 2;
      items.push(
        `<g class="diagnostic-mark" data-diagnostic-index="${index}" data-diagnostic-code="${escapeXml(diagnostic.code)}">` +
          `<rect class="diagnostic-mark-shape" x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${MARK_RADIUS}" ry="${MARK_RADIUS}" fill="none" stroke="${MARK_COLOR}" stroke-width="${MARK_STROKE_WIDTH}"/>` +
          badgeSvg(
            label,
            x + width + 2,
            y - BADGE_HEIGHT / 2,
            observation.width,
            observation.height,
          ) +
          `</g>`,
      );
    } else if (diagnostic.at) {
      const cx = diagnostic.at.x / scale;
      const cy = diagnostic.at.y / scale;
      items.push(
        `<g class="diagnostic-mark" data-diagnostic-index="${index}" data-diagnostic-code="${escapeXml(diagnostic.code)}">` +
          `<circle class="diagnostic-mark-shape" cx="${num(cx)}" cy="${num(cy)}" r="${POINT_CIRCLE_RADIUS}" fill="none" stroke="${MARK_COLOR}" stroke-width="${MARK_STROKE_WIDTH}"/>` +
          badgeSvg(
            label,
            cx + POINT_CIRCLE_RADIUS + 2,
            cy - POINT_CIRCLE_RADIUS - BADGE_HEIGHT / 2,
            observation.width,
            observation.height,
          ) +
          `</g>`,
      );
    }
  }
  if (!items.length) return "";
  return `<g class="diagnostic-marks" data-diagnostic-marks="" pointer-events="none">${items.join("")}</g>`;
}

export function withDiagnosticMarks(svg: string, marks: string): string {
  if (!marks) return svg;
  const close = svg.lastIndexOf("</svg>");
  if (close < 0) return svg;
  return svg.slice(0, close) + marks + svg.slice(close);
}
