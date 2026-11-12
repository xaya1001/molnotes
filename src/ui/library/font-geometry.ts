import type { Font } from "fontkit";
import type { Point } from "../../../shared/chemical-library/types.ts";
import type {
  FigureBox,
  FigureGlyph,
  FigureNode,
  FigureTextRun,
} from "../../../shared/chemical-library/geometry.ts";
import { identityMatrix, transformBox, unionBoxes } from "./geometry-math.ts";
import { plainPaint } from "./geometry-tree.ts";

export interface FigureFont {
  id: string;
  font: Font;
}
/** Adapters own font loading; shaping itself has no I/O or DOM dependency. */
export type FigureFontResolver = (
  run: FigureTextRun,
  character: string,
) => FigureFont;

export function shapeFigureText(
  runs: FigureTextRun[],
  resolve: FigureFontResolver,
  at: Point,
  anchor: "start" | "middle" | "end" = "middle",
  baseline: "alphabetic" | "central" = "central",
): Extract<FigureNode, { kind: "text" }> {
  const glyphs: FigureGlyph[] = [];
  const boxes: FigureBox[] = [];
  const inks: (FigureBox | null)[] = [];
  let cursor = 0;
  const first = runs[0];
  const primary = first && resolve(first, "A").font;
  const central =
    primary && baseline === "central"
      ? (((primary.ascent + primary.descent) / primary.unitsPerEm) *
          first.size) /
        2
      : 0;
  for (const run of runs) {
    const chunks: { face: FigureFont; text: string }[] = [];
    for (const character of run.text) {
      const face = resolve(run, character);
      const previous = chunks.at(-1);
      if (previous?.face.id === face.id) previous.text += character;
      else chunks.push({ face, text: character });
    }
    for (const { face, text } of chunks) {
      const scale = run.size / face.font.unitsPerEm;
      const shaped = face.font.layout(text);
      const y = at.y + central + run.shift;
      const start = cursor;
      let vertical = 0;
      shaped.glyphs.forEach((glyph, index) => {
        const position = shaped.positions[index];
        const transform: FigureGlyph["transform"] = [
          scale,
          0,
          0,
          -scale,
          at.x + cursor + position.xOffset * scale,
          y - vertical - position.yOffset * scale,
        ];
        const path = glyph.path.toSVG();
        glyphs.push({ font: face.id, glyph: glyph.id, path, transform });
        if (path) {
          const b = glyph.path.bbox;
          inks.push(
            transformBox(
              {
                x: b.minX,
                y: b.minY,
                width: b.maxX - b.minX,
                height: b.maxY - b.minY,
              },
              transform,
            ),
          );
        }
        cursor += position.xAdvance * scale;
        vertical += position.yAdvance * scale;
      });
      boxes.push({
        x: at.x + start,
        y: y - face.font.ascent * scale,
        width: cursor - start,
        height: (face.font.ascent - face.font.descent) * scale,
      });
    }
  }
  const dx = anchor === "middle" ? -cursor / 2 : anchor === "end" ? -cursor : 0;
  for (const glyph of glyphs) glyph.transform[4] += dx;
  const shifted = (box: FigureBox | null) => box && { ...box, x: box.x + dx };
  return {
    kind: "text",
    attributes: {},
    transform: identityMatrix(),
    paint: plainPaint(),
    text: runs.map((run) => run.text).join(""),
    runs,
    advance: cursor,
    glyphs,
    bounds: shifted(unionBoxes(boxes)),
    inkBounds: shifted(unionBoxes(inks)),
  };
}
