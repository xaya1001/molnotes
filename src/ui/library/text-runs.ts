import { chemicalTextRuns } from "../../../shared/chemical-text.ts";
import type { FigureTextRun } from "../../../shared/chemical-library/geometry.ts";
import { figureTextMetrics, type FigureFontResolver } from "./font-geometry.ts";

export function figureLabelLines(number?: string, name?: string): string[] {
  const names = name
    ? name.replace(/(?<=[A-Za-z)\]])(?=\d)/g, "\\").split("\n")
    : [];
  if (!number) return names;
  const lines = number.split("\n");
  const labels = number.includes("*")
    ? lines
    : lines.map((line) => `**${line}**`);
  if (names.length)
    labels.splice(
      labels.length - 1,
      1,
      labels.at(-1)! + ": " + names[0],
      ...names.slice(1),
    );
  return labels;
}

/** Chemical prefixes and authored emphasis share the geometry used for wrapping. */
export function figureTextRuns(
  text: string,
  size: number,
  fonts: FigureFontResolver,
): FigureTextRun[] {
  return chemicalTextRuns(text).map(({ text, bold, italic, script }) => {
    const run: FigureTextRun = {
      text,
      size: size * (script ? 0.72 : 1),
      weight: bold ? 700 : 400,
      italic,
      shift: 0,
    };
    if (script) {
      const font = fonts(run, "A").font;
      run.shift =
        script === "sub"
          ? figureTextMetrics(font, run.size).ascent -
            figureTextMetrics(font, size).central
          : -size * 0.6;
    }
    return run;
  });
}

export function wrapFigureText(
  lines: string[],
  textWidth: number,
  measure: (text: string) => number,
) {
  const result: string[] = [];
  for (const text of lines) {
    const tokens: string[] = [];
    for (const part of text.trim().match(/.*?(?:[；，、/;\s]+|$)/gu) ?? []) {
      if (!part) continue;
      const previous = tokens.at(-1);
      // A quantity and its following unit share one line, including
      // temperature ranges such as −20–25 °C.
      if (previous && /\d\s+$/u.test(previous) && /^(?:°|\p{L})/u.test(part))
        tokens[tokens.length - 1] += part;
      else tokens.push(part);
    }
    let line = "";
    for (const token of tokens) {
      if (line && measure(line + token) > textWidth) {
        result.push(line.trim());
        line = token;
      } else line += token;
    }
    if (line) result.push(line.trim());
  }
  return result;
}
