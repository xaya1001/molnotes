/** Long prose stays readable; short labels and individual numeric readings align as values. */
export function tableTextAlign(text: string) {
  return text
    .replaceAll("**", "")
    .split("\n")
    .some((line) => [...line].length > 24)
    ? "start"
    : "center";
}

/** Keep a number with its following unit without changing the stored content. */
export function tableDisplayText(text: string) {
  return text.replace(
    /(\d(?:[\d.,]*\d)?)[ \t]+(°C|°F|%|h|min|s|nM|µM|μM|mM|M|mg|µg|μg|g|mL|µL|μL|L)(?=$|[^\p{L}])/gu,
    "$1\u00a0$2",
  );
}
