import type { Diagnostic, Point } from "./types.ts";

/** SVG's [a b c d e f] affine matrix, in parent coordinates. */
export type FigureMatrix = [number, number, number, number, number, number];
export interface FigureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type FigureRect = FigureBox & {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export interface FigurePaint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  fillRule: "nonzero" | "evenodd";
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  miterLimit: number;
  dashArray?: string;
}
export interface FigureGlyph {
  font: string;
  glyph: number;
  path: string;
  transform: FigureMatrix;
}
export interface FigureTextRun {
  text: string;
  size: number;
  weight: 400 | 700;
  italic: boolean;
  /** Baseline displacement in SVG units, positive downward. */
  shift: number;
}
interface NodeBase {
  attributes: Record<string, string>;
  transform: FigureMatrix;
  paint: FigurePaint;
  /** Local SVG layout bounds; null means no drawable geometry. */
  bounds: FigureBox | null;
}
export type FigureNode = NodeBase &
  (
    | { kind: "group"; children: FigureNode[] }
    | { kind: "path"; d: string }
    | { kind: "ellipse"; center: Point; rx: number; ry: number }
    | { kind: "rect"; box: FigureBox }
    | {
        kind: "text";
        text: string;
        position: Point;
        fontSize: number;
        anchor: "start" | "middle" | "end";
        baseline: "alphabetic" | "central";
        runs: FigureTextRun[];
        advance: number;
        glyphs: FigureGlyph[];
        inkBounds: FigureBox | null;
      }
  );

/** Build cache data. Readers receive the SVG, not this tree or font bytes. */
export interface FigureGeometry {
  format: 1;
  width: number;
  height: number;
  minimumScale: number;
  atomPoints: Record<string, Point>;
  root: FigureNode;
}

/** A viewport-independent, element-addressed observation for render comparison. */
export interface FigureObservation {
  width: number;
  height: number;
  minimumScale: number;
  atoms: Record<string, Point>;
  elements: {
    key: string;
    ids: Record<string, string>;
    bounds: FigureBox;
    path?: string;
    points?: Point[];
    paint: FigurePaint;
  }[];
  diagnostics: Diagnostic[];
}

export interface FigureObservationSet {
  views: Record<string, FigureObservation>;
  failures: Record<string, string>;
}
