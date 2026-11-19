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

const openingPunctuation = /[（(「『【《〈“‘]$/u;
const closingPunctuation = /^[）)」。、，；：！？』】》〉”’.,;:!?]/u;

function narrowFigureTokens(
  input: string[],
  width: number,
  measure: (text: string) => number,
) {
  const withPunctuation = (parts: string[], keepChemistry = false) => {
    const joined: string[] = [];
    for (const part of parts) {
      const previous = joined.at(-1)?.trimEnd() ?? "";
      const chemicalPhrase =
        keepChemistry &&
        /[A-Za-z0-9=–—−+α-ωΑ-Ω*]$/u.test(previous) &&
        /^(?:[键碳对端位]|[πσ]\*?(?=$|\s|[，、；：。]))/u.test(part);
      const quantityWithUnit =
        keepChemistry &&
        /(?:^|\s)[+−-]?\d+(?:\.\d+)?$/u.test(previous) &&
        /^[°%％\p{L}]/u.test(part);
      if (
        previous &&
        (openingPunctuation.test(previous) ||
          closingPunctuation.test(part) ||
          chemicalPhrase ||
          quantityWithUnit)
      )
        joined[joined.length - 1] += part;
      else joined.push(part);
    }
    return joined;
  };
  const tokens: string[] = [];
  const hanBreaks = new Set<number>();
  for (const token of withPunctuation(input)) {
    if (measure(token.trim()) <= width) {
      tokens.push(token);
      continue;
    }
    for (const word of withPunctuation(token.match(/\S+\s*/gu) ?? [], true)) {
      const parts =
        measure(word.trim()) <= width
          ? [word]
          : word.split(/(?<=\p{Script=Han})(?=\p{Script=Han})/u);
      for (const [index, part] of parts.entries()) {
        if (index) hanBreaks.add(tokens.length);
        tokens.push(part);
      }
    }
  }
  return { tokens, hanBreaks };
}

export function wrapFigureText(
  lines: string[],
  textWidth: number,
  measure: (text: string) => number,
  options?: { balance?: boolean; breakHan?: boolean },
) {
  const result: string[] = [];
  for (const text of lines) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    const parts: string[] = [];
    for (const part of trimmed.match(/.*?(?:[；，、：。·/;\s]+|$)/gu) ?? []) {
      if (!part) continue;
      const previous = parts.at(-1);
      if (previous && /^·\s*$/u.test(part)) {
        parts[parts.length - 1] += part;
        continue;
      }
      if (
        previous &&
        /\s+$/u.test(previous) &&
        !/[；，、：。·/;]\s*$/u.test(previous)
      ) {
        const body = previous.trimEnd();
        // Keep quantity + unit, CJK-Latin typography spacing, and chemical
        // orbital phrases (such as "C=O π 键" or "O–S 键") on one line.
        if (
          (/\d$/u.test(body) && /^(?:°|\p{L})/u.test(part)) ||
          (/\p{Script=Han}$/u.test(body) && !/^[·/]/u.test(part)) ||
          (/^\p{Script=Han}/u.test(part) && !/[·/]$/u.test(body)) ||
          (/[A-Za-z0-9=–—−+-]$/u.test(body) &&
            /^[πσ](?:\*|\s|$|\p{Script=Han}|[，、；：。])/u.test(part))
        ) {
          parts[parts.length - 1] += part;
          continue;
        }
      }
      parts.push(part);
    }
    const { tokens, hanBreaks } = options?.breakHan
      ? narrowFigureTokens(parts, textWidth, measure)
      : { tokens: parts, hanBreaks: undefined };
    if (options?.balance && tokens.length > 1 && measure(trimmed) > textWidth) {
      let minLines = 1;
      let current = "";
      for (const token of tokens) {
        if (current && measure((current + token).trim()) > textWidth) {
          minLines++;
          current = token;
        } else current += token;
      }
      const n = tokens.length;
      const target = measure(trimmed) / minLines;
      const lineText = (start: number, end: number) =>
        tokens.slice(start, end).join("").trim();
      type LineBreak = {
        han: number;
        maxW: number;
        sumSq: number;
        prev: number;
      };
      const dp: (LineBreak | null)[][] = Array.from(
        { length: minLines + 1 },
        () => Array(n + 1).fill(null),
      );
      dp[0][0] = { han: 0, maxW: 0, sumSq: 0, prev: -1 };
      for (let k = 1; k <= minLines; k++) {
        for (let end = k; end <= n; end++) {
          let best: LineBreak | null = null;
          for (let start = k - 1; start < end; start++) {
            const prior = dp[k - 1][start];
            if (!prior) continue;
            const width = measure(lineText(start, end));
            if (end - start > 1 && width > textWidth) continue;
            const han = prior.han + Number(hanBreaks?.has(start) ?? false);
            const maxW = Math.max(prior.maxW, width);
            const sumSq = prior.sumSq + (width - target) ** 2;
            if (
              !best ||
              han < best.han ||
              (han === best.han &&
                (maxW < best.maxW - 0.5 ||
                  (Math.abs(maxW - best.maxW) <= 0.5 && sumSq < best.sumSq)))
            )
              best = { han, maxW, sumSq, prev: start };
          }
          dp[k][end] = best;
        }
      }
      const balanced: string[] = [];
      let end = n;
      for (let k = minLines; k >= 1; k--) {
        const start = dp[k][end]!.prev;
        balanced.push(lineText(start, end));
        end = start;
      }
      result.push(...balanced.reverse());
      continue;
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
