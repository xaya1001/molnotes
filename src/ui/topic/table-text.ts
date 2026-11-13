import { chemicalTextRuns } from "../../../shared/chemical-text.ts";
import type { CSSProperties } from "vue";

/** Long prose stays readable; short labels and individual numeric readings align as values. */
export function tableTextAlign(text: string) {
  return text
    .replaceAll("**", "")
    .split("\n")
    .some((line) => [...line].length > 24)
    ? "start"
    : "center";
}

/** Resolve layout once for the entire column, including rows on other pages. */
export function tableColumnStyle(values: readonly string[]): CSSProperties {
  const prose = values.some((text) => tableTextAlign(text) === "start");
  const words = values.some((text) => /\p{L}/u.test(text));
  return {
    textAlign: prose ? "start" : "center",
    minWidth: prose
      ? "var(--table-prose-width)"
      : words
        ? "var(--table-value-width)"
        : undefined,
    overflowWrap: prose ? "anywhere" : "normal",
  };
}

/** Keep a number with its following unit without changing the stored content. */
export function tableDisplayText(text: string) {
  return text
    .replace(
      /(\d(?:[\d.,]*\d)?)[ \t]+(°C|°F|%|h|min|s|nM|µM|μM|mM|M|mg|µg|μg|g|mL|µL|μL|L)(?=$|[^\p{L}])/gu,
      "$1\u00a0$2",
    )
    .replace(/([≥≤<>~])[ \t]+(?=[+−-]?\d)/g, "$1\u00a0");
}

/** Preserve table grouping while applying the shared chemical typography. */
export function tableTextPieces(text: string) {
  return tableDisplayText(text)
    .split(
      /(\*\*[^*]+\*\*|\n|[≥≤<>~]\u00a0?[+−-]?\d[\d.,]*%?(?:\u00a0[^\s*]+)?|(?<![A-Za-z)\]\d.,])\d[\d.,]*\u00a0[^\s*]+)/,
    )
    .map((part) => ({
      newline: part === "\n",
      quantity:
        /^(?:\d[\d.,]*\u00a0|[≥≤<>~]\u00a0?[+−-]?\d)/.test(part) ||
        (part.startsWith("**") && part.includes("\u00a0")),
      runs: chemicalTextRuns(part),
    }));
}
