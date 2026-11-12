import type { FigureTextRun } from "../../../shared/chemical-library/geometry.ts";
import { figureTextMetrics, type FigureFontResolver } from "./font-geometry.ts";

/** Chemical prefixes and authored emphasis share the geometry used for wrapping. */
export function figureTextRuns(
  text: string,
  size: number,
  fonts: FigureFontResolver,
): FigureTextRun[] {
  const runs: FigureTextRun[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|\*[^*]+\*|\^\{[^}]+\}|[₀₁₂₃₄₅₆₇₈₉]+|(?<![\p{L}\p{N}])(?:n|s|t|i|sec|tert|cis|trans|syn|anti|R|S|E|Z)-)/gu;
  let cursor = 0;
  const append = (part: string, format = "") => {
    if (!part) return;
    const script = format === "sub" || format === "super";
    const run: FigureTextRun = {
      text: part,
      size: size * (script ? 0.8 : 1),
      weight: format === "bold" ? 700 : 400,
      italic: format === "italic",
      shift: 0,
    };
    if (script) {
      const font = fonts(run, "A").font;
      run.shift =
        format === "sub"
          ? figureTextMetrics(font, run.size).ascent -
            figureTextMetrics(font, size).central
          : -size * 0.6;
    }
    runs.push(run);
  };
  for (const match of text.matchAll(pattern)) {
    append(text.slice(cursor, match.index));
    const part = match[0];
    if (part.startsWith("**")) append(part.slice(2, -2), "bold");
    else if (part.startsWith("*")) append(part.slice(1, -1), "italic");
    else if (part.startsWith("^{")) append(part.slice(2, -1), "super");
    else if (/^[₀₁₂₃₄₅₆₇₈₉]+$/.test(part))
      append(
        [...part].map((ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch))).join(""),
        "sub",
      );
    else append(part, "italic");
    cursor = match.index + part.length;
  }
  append(text.slice(cursor));
  return runs;
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
