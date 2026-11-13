import { abbreviationSmarts } from "./molecule-abbreviations.ts";

export interface ChemicalTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  script?: "sub" | "super";
}

const formulaSymbols = [
  ..."H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(
    " ",
  ),
  ...Object.keys(abbreviationSmarts).filter((name) => /^[A-Za-z]+$/.test(name)),
  "Et",
  "Me",
  "Pr",
  "Bu",
];
const formulaSymbol = new RegExp(
  `^(?:${[...new Set(formulaSymbols)].sort((a, b) => b.length - a.length).join("|")})(\\d*)`,
);
const assayIdentifiers = new Set([
  "IC50",
  "EC50",
  "DC50",
  "GI50",
  "CC50",
  "ED50",
  "LD50",
]);

/** Complete formula words alone receive automatic table subscripts. */
export function tableFormulaWords(text: string) {
  return [
    ...text.matchAll(
      /(?:[A-Za-z\p{Script=Greek}0-9_\\()[\]@=#+:%]|(?<=\d)\.(?=\d))+/gu,
    ),
  ].filter((match) => {
    let word = match[0].replace(/\\(.)/g, "$1");
    if (!/\d/.test(word) || assayIdentifiers.has(word)) return false;
    let symbols = 0;
    while (word) {
      const symbol = formulaSymbol.exec(word);
      if (!symbol || symbol[1].length > 2) return false;
      symbols++;
      word = word.slice(symbol[0].length);
    }
    return symbols >= 2;
  });
}

/** Chemical typography shared by figure labels and table text. */
export function chemicalTextRuns(
  text: string,
  context: "figure" | "table" = "figure",
): ChemicalTextRun[] {
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
    const formulas = context === "table" ? tableFormulaWords(content) : [];
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
      else if (/^\d+$/.test(token))
        append(
          token,
          bold,
          italic,
          context === "figure" ||
            formulas.some(
              (word) =>
                match.index >= word.index &&
                match.index < word.index + word[0].length,
            )
            ? "sub"
            : undefined,
        );
      else append(token, bold, true);
      cursor = match.index + token.length;
    }
    append(content.slice(cursor), bold, italic);
  }
  return runs;
}
