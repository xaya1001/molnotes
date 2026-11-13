export interface ChemicalTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  script?: "sub" | "super";
}

/** Chemical typography shared by figure labels and table text. */
export function chemicalTextRuns(text: string): ChemicalTextRun[] {
  const runs: ChemicalTextRun[] = [];
  const pattern =
    /\\.|\^\{[^}]*\}|\^(?:\w+(?:,\w+)*|[+\-–‡])|_\{[^}]*\}|_\w|[₀₁₂₃₄₅₆₇₈₉]+|(?<=[A-Za-z)\]])\d+|(?<![A-Za-z])(?:tert|sec|cis|trans|syn|anti|t|n|p|i|m|o|s|R|S|E|Z)-(?=[A-Za-z])|(?<![A-Za-z])(?:dr|ee|er|cat\.|rac)(?![A-Za-z])/gu;
  const append = (
    part: string,
    bold: boolean,
    italic: boolean,
    script?: "sub" | "super",
  ) => {
    if (!part) return;
    const run: ChemicalTextRun = { text: part, bold, italic, script };
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
