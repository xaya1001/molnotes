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
  const runs: FigureTextRun[] = [];
  const pattern =
    /\\.|\^\{[^}]*\}|\^(?:\w+(?:,\w+)*|[+\-–‡])|_\{[^}]*\}|_\w|[₀₁₂₃₄₅₆₇₈₉]+|(?<=[A-Za-z)\]])\d+|(?<![A-Za-z])(?:tert|sec|cis|trans|syn|anti|t|n|p|i|m|o|s|R|S|E|Z)-(?=[A-Za-z])|(?<![A-Za-z])(?:dr|ee|er|cat\.|rac)(?![A-Za-z])/gu;
  const append = (
    part: string,
    bold: boolean,
    italic: boolean,
    script?: "sub" | "super",
  ) => {
    if (!part) return;
    const run: FigureTextRun = {
      text: part,
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
    runs.push(run);
  };
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    const bold = part.startsWith("**"),
      italic = !bold && part.startsWith("*");
    const content = bold
      ? part.slice(2, -2)
      : italic
        ? part.slice(1, -1)
        : part;
    let cursor = 0;
    for (const match of content.matchAll(pattern)) {
      append(content.slice(cursor, match.index), bold, italic);
      const token = match[0];
      if (token.startsWith("\\")) append(token.slice(1), bold, italic);
      else if (token.startsWith("^") || token.startsWith("_"))
        append(
          token[1] === "{" ? token.slice(2, -1) : token.slice(1),
          bold,
          italic,
          token[0] === "^" ? "super" : "sub",
        );
      else if (/^[₀₁₂₃₄₅₆₇₈₉]+$/.test(token))
        append(
          [...token].map((ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch))).join(""),
          bold,
          italic,
          "sub",
        );
      else if (/^\d+$/.test(token)) append(token, bold, italic, "sub");
      else append(token, bold, true);
      cursor = match.index + token.length;
    }
    append(content.slice(cursor), bold, italic);
  }
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
